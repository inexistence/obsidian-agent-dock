const { appendTimelineContent } = require("../timeline/timeline");

function createUserMessage(prompt, createdAt) {
  return {
    role: "user",
    content: prompt,
    createdAt,
    timeline: [{ kind: "message", text: prompt }]
  };
}

function createAssistantMessage(createdAt) {
  return {
    role: "assistant",
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
  runAgent,
  translate,
  touchSession,
  onTurnStarted,
  onTurnUpdate,
  onTurnFinished,
  onComposerChanged,
  persistChatSessions,
  notify
}) {
  const now = Date.now();
  session.messages.push(createUserMessage(prompt, now));
  const assistantMessage = createAssistantMessage(now);
  session.messages.push(assistantMessage);

  const run = {
    abortController: new AbortController(),
    assistantMessage
  };
  session.currentRun = run;
  touchSession(session);
  onTurnStarted(session, assistantMessage);
  persistChatSessions({ immediate: true });

  try {
    const conversation = session.messages.slice(0, -1);
    await runAgent(prompt, (update) => {
      if (assistantMessage.isComplete || session.currentRun !== run) {
        return;
      }

      if (update.kind === "content") {
        assistantMessage.content += update.text;
        appendTimelineContent(assistantMessage, update.text);
      } else {
        assistantMessage.timeline.push(update);
      }
      onTurnUpdate(session, assistantMessage);
    }, conversation, {
      signal: run.abortController.signal,
      sessionId: session.id
    });

    completeAssistantMessage(assistantMessage);
    if (!assistantMessage.content.trim()) {
      const emptyText = translate("view.agentFinishedEmpty", { agent: agentLabel });
      assistantMessage.content = emptyText;
      appendTimelineContent(assistantMessage, emptyText);
    }
    touchSession(session);
    onTurnFinished(session);
  } catch (error) {
    completeAssistantMessage(assistantMessage);
    const wasStopped = error.name === "AbortError";
    const errorText = wasStopped
      ? translate("view.agentStopped", { agent: agentLabel })
      : [
          translate("view.agentRunFailed", { agent: agentLabel }),
          "",
          error.message,
          "",
          translate("view.agentRunFailedHint")
        ].join("\n");
    assistantMessage.content = errorText;
    appendTimelineContent(assistantMessage, errorText);
    touchSession(session);
    onTurnFinished(session);
    notify(wasStopped ? "agentStopped" : "agentCommandFailed");
  } finally {
    if (session.currentRun === run) {
      session.currentRun = null;
    }
    onTurnFinished(session);
    onComposerChanged(session);
    await persistChatSessions({ immediate: true });
  }
}

function completeAssistantMessage(message) {
  message.isLoading = false;
  message.isComplete = true;
}

module.exports = {
  runChatTurn
};
