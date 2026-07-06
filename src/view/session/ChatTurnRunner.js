const {
  appendTimelineContent,
  appendTimelineReasoning,
  consolidateTimelineContent,
  replaceTimelineFinalContent
} = require("../timeline/timeline");

function createUserMessage(prompt, createdAt) {
  return {
    role: "user",
    content: prompt,
    createdAt,
    timeline: [{ kind: "message", text: prompt }]
  };
}

function createAssistantMessage(createdAt, agentId) {
  return {
    role: "assistant",
    agentId: String(agentId || ""),
    content: "",
    timeline: [],
    isLoading: true,
    createdAt
  };
}

async function runChatTurn({
  session,
  prompt,
  agentLabel,
  agentId,
  runAgent,
  translate,
  touchSession,
  onBeforeAgentRun,
  onTurnStarted,
  onTurnUpdate,
  onTurnFinished,
  onComposerChanged,
  updateWorkingAffect,
  settleAffectDisplay,
  persistChatSessions,
  notify
}) {
  const now = Date.now();
  session.messages.push(createUserMessage(prompt, now));
  const assistantMessage = createAssistantMessage(now, agentId);
  session.messages.push(assistantMessage);

  const run = {
    abortController: new AbortController(),
    assistantMessage
  };
  session.currentRun = run;
  let turnStatus = "success";

  try {
    if (onBeforeAgentRun) {
      onBeforeAgentRun(session, assistantMessage);
    }
    touchSession(session);
    onTurnStarted(session, assistantMessage);
    persistChatSessions({ immediate: true });

    const conversation = session.messages.slice(0, -1);
    await runAgent(prompt, (update) => {
      if (assistantMessage.isComplete || session.currentRun !== run) {
        return;
      }

      if (update.kind === "content") {
        assistantMessage.content += update.text;
        appendTimelineContent(assistantMessage, update.text);
      } else if (update.kind === "reasoning") {
        appendTimelineReasoning(assistantMessage, update);
      } else if (update.kind === "tool" && update.toolCallId) {
        mergeToolTimelineUpdate(assistantMessage, update);
      } else {
        assistantMessage.timeline.push(update);
      }
      onTurnUpdate(session, assistantMessage);
    }, conversation, {
      signal: run.abortController.signal,
      sessionId: session.id,
      dockSession: session
    });

    if (!assistantMessage.content.trim()) {
      assistantMessage.content = translate("view.agentFinishedEmpty", { agent: agentLabel });
    }
    finalizeAssistantMessage(assistantMessage);
    await tryUpdateWorkingAffect(updateWorkingAffect, {
      sessionId: session.id,
      prompt,
      response: assistantMessage.content,
      success: true
    }, {
      session,
      assistantMessage
    });
    touchSession(session);
    onTurnFinished(session, { final: false, status: turnStatus });
  } catch (error) {
    const wasStopped = error.name === "AbortError";
    turnStatus = wasStopped ? "stopped" : "failed";
    const errorText = wasStopped
      ? translate("view.agentStopped", { agent: agentLabel })
      : [
          translate("view.agentRunFailed", { agent: agentLabel }),
          "",
          error.message,
          "",
          translate("view.agentRunFailedHint")
        ].join("\n");
    finalizeAssistantMessage(assistantMessage, {
      content: errorText,
      replaceContent: true
    });
    if (!wasStopped) {
      await tryUpdateWorkingAffect(updateWorkingAffect, {
        sessionId: session.id,
        prompt,
        response: errorText,
        success: false
      }, {
        session,
        assistantMessage
      });
    } else {
      await trySettleAffectDisplay(settleAffectDisplay, {
        session,
        assistantMessage
      });
    }
    touchSession(session);
    onTurnFinished(session, { final: false, status: turnStatus });
    notify(wasStopped ? "agentStopped" : "agentCommandFailed", session);
  } finally {
    if (session.currentRun === run) {
      session.currentRun = null;
    }
    onTurnFinished(session, { final: true, status: turnStatus });
    onComposerChanged(session);
    await persistChatSessions({ immediate: true });
  }
}

async function tryUpdateWorkingAffect(updateWorkingAffect, turn, context = {}) {
  if (!updateWorkingAffect) {
    return;
  }

  try {
    await updateWorkingAffect(turn, context);
  } catch (error) {
    console.warn("Agent Dock could not update affect continuity:", error);
  }
}

async function trySettleAffectDisplay(settleAffectDisplay, context = {}) {
  if (!settleAffectDisplay) {
    return;
  }

  try {
    await settleAffectDisplay(context);
  } catch (error) {
    console.warn("Agent Dock could not settle affect display:", error);
  }
}

function finalizeAssistantMessage(message, options = {}) {
  if (options.content !== undefined) {
    message.content = options.content;
  }
  if (options.replaceContent) {
    replaceTimelineFinalContent(message, message.content);
  }
  consolidateTimelineContent(message);
  message.isLoading = false;
  message.isComplete = true;
}

function mergeToolTimelineUpdate(assistantMessage, update) {
  const existing = findLastToolTimelineEntry(assistantMessage.timeline, update.toolCallId);
  if (!existing) {
    assistantMessage.timeline.push(update);
    return;
  }

  existing.title = update.title || existing.title;
  if (update.summary) {
    existing.summary = update.summary;
  }
  if (update.detail) {
    existing.detail = existing.detail
      ? `${existing.detail}\n\n${update.detail}`
      : update.detail;
  }
}

function findLastToolTimelineEntry(timeline, toolCallId) {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const entry = timeline[index];
    if (entry?.kind === "tool" && entry.toolCallId === toolCallId) {
      return entry;
    }
  }
  return null;
}

module.exports = {
  runChatTurn
};
