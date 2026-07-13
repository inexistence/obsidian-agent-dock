const {
  appendTimelineContent,
  appendTimelineReasoning,
  consolidateTimelineContent,
  replaceAllTimelineContent,
  replaceTimelineFinalContent
} = require("../timeline/timeline");
const {
  mergeSignalEvidenceContexts,
  normalizeAgentDockSignals
} = require("../../agents/shared/signalEvidence");

function createUserMessage(prompt, createdAt) {
  return {
    id: createMessageId("user"),
    role: "user",
    content: prompt,
    createdAt,
    timeline: [{ kind: "message", text: prompt }]
  };
}

function createAssistantMessage(createdAt, agentId) {
  return {
    id: createMessageId("assistant"),
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
  updateTurnVisualAffect,
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
    const userMessage = conversation[conversation.length - 1];
    const finalContent = await runAgent(prompt, (update) => {
      if (assistantMessage.isComplete || session.currentRun !== run) {
        return;
      }

      const structuredSignals = Array.isArray(update.agentDockSignals)
        ? update.agentDockSignals
        : update.agentDockSignal ? [update.agentDockSignal] : [];
      if (structuredSignals.length > 0) {
        assistantMessage.agentDockSignals = normalizeAgentDockSignals(
          (assistantMessage.agentDockSignals || []).concat(structuredSignals)
        );
      }
      if (update.signalEvidenceContext) {
        assistantMessage.signalEvidenceContext = mergeSignalEvidenceContexts(
          assistantMessage.signalEvidenceContext,
          update.signalEvidenceContext
        );
      }
      if (update.memoryProvenance) {
        assistantMessage.memoryProvenance = mergeMemoryProvenance(
          assistantMessage.memoryProvenance,
          update.memoryProvenance
        );
      }
      if (update.internalOnly === true) {
        onTurnUpdate(session, assistantMessage);
        return;
      }

      if (update.kind === "content") {
        assistantMessage.content += update.text;
        appendTimelineContent(assistantMessage, update.text);
      } else if (update.kind === "reasoning") {
        appendTimelineReasoning(assistantMessage, update);
      } else if (update.kind === "tool" && update.toolCallId) {
        mergeToolTimelineUpdate(assistantMessage, update);
      } else if (update.noticeGroupId) {
        mergeGroupedNoticeTimelineUpdate(assistantMessage, update);
      } else if (update.insertBeforeLastContent) {
        insertTimelineUpdateBeforeLastContent(assistantMessage.timeline, update);
      } else {
        assistantMessage.timeline.push(update);
      }
      if (updateTurnVisualAffect) {
        updateTurnVisualAffect(assistantMessage, update);
      }
      onTurnUpdate(session, assistantMessage);
    }, conversation, {
      signal: run.abortController.signal,
      sessionId: session.id,
      dockSession: session,
      userMessageId: userMessage?.id || "",
      assistantMessageId: assistantMessage.id
    });

    if (typeof finalContent === "string" && finalContent !== assistantMessage.content) {
      assistantMessage.content = finalContent;
      replaceTimelineFinalContent(assistantMessage, assistantMessage.content);
    }
    if (!assistantMessage.content.trim()) {
      assistantMessage.content = translate("view.agentFinishedEmpty", { agent: agentLabel });
    }
    finalizeAssistantMessage(assistantMessage);
    onTurnFinished(session, { final: false, status: turnStatus, holdFinalStatus: true });
    await tryUpdateWorkingAffect(updateWorkingAffect, {
      sessionId: session.id,
      prompt,
      response: assistantMessage.content,
      agentDockSignals: assistantMessage.agentDockSignals || [],
      signalEvidenceContext: assistantMessage.signalEvidenceContext,
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
    onTurnFinished(session, { final: false, status: turnStatus, holdFinalStatus: true });
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

function mergeMemoryProvenance(existing, incoming) {
  const left = existing && typeof existing === "object" ? existing : {};
  const right = incoming && typeof incoming === "object" ? incoming : {};
  const availableByRef = new Map();
  for (const item of [...(left.available || []), ...(right.available || [])]) {
    if (item?.ref) {
      availableByRef.set(item.ref, Object.assign({}, availableByRef.get(item.ref), item));
    }
  }
  return {
    available: Array.from(availableByRef.values()).slice(0, 12),
    claimedUsedRefs: [...new Set([
      ...(left.claimedUsedRefs || []),
      ...(right.claimedUsedRefs || [])
    ])].slice(0, 12)
  };
}

function createMessageId(role) {
  return `msg-${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
    replaceAllTimelineContent(message, message.content);
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
  if (update.toolType) {
    existing.toolType = update.toolType;
  }
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

function mergeGroupedNoticeTimelineUpdate(assistantMessage, update) {
  const existing = findGroupedNoticeTimelineEntry(
    assistantMessage.timeline,
    update.noticeGroupId
  );
  if (!existing) {
    insertGroupedTimelineUpdate(assistantMessage.timeline, update);
    return;
  }

  const existingCount = Number(existing.noticeItemCount) || 0;
  const updateCount = Number(update.noticeItemCount) || 0;
  if (updateCount < existingCount) {
    return;
  }
  Object.assign(existing, update);
}

function insertGroupedTimelineUpdate(timeline, update) {
  if (update.insertBeforeLastContent) {
    insertTimelineUpdateBeforeLastContent(timeline, update);
    return;
  }
  timeline.push(update);
}

function insertTimelineUpdateBeforeLastContent(timeline, update) {
  const contentIndex = findLastTimelineContentIndex(timeline);
  if (contentIndex === -1) {
    timeline.push(update);
    return;
  }
  timeline.splice(contentIndex, 0, update);
}

function findLastTimelineContentIndex(timeline) {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (timeline[index]?.kind === "content") {
      return index;
    }
  }
  return -1;
}

function findGroupedNoticeTimelineEntry(timeline, noticeGroupId) {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const entry = timeline[index];
    if (entry?.noticeGroupId === noticeGroupId) {
      return entry;
    }
  }
  return null;
}

module.exports = {
  runChatTurn
};
