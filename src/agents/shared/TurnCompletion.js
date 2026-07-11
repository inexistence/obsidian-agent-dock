const {
  formatInvalidAgentDockSignalActivity,
  formatAgentDockSignalNotice,
  formatAgentDockReflectionNotice
} = require("./agentSignals");
const {
  buildDeepMemoryAuditItems,
  buildInteractionMemoryAuditItems,
  buildMemoryUpdateAuditItems,
  formatDeepMemoryUpdateSummary,
  formatInteractionMemoryUpdateKind,
  formatInteractionMemoryUpdateSummary,
  formatInteractionMemoryUpdateTitle,
  formatMemoryUpdateSummary
} = require("./captureNotices");
const { mergeSignalEvidenceContexts } = require("./signalEvidence");

async function captureTurnContinuity(plugin, turn, settings, onUpdate, options) {
  const { keyPrefix, translate } = options;
  await captureOrdinaryMemory(plugin, turn, settings, onUpdate, keyPrefix, translate);
  await captureInteractionMemory(plugin, turn, settings, onUpdate, keyPrefix, translate);
  await captureDeepMemory(plugin, turn, settings, onUpdate, keyPrefix, translate);
}

async function captureOrdinaryMemory(plugin, turn, settings, onUpdate, keyPrefix, translate) {
  const tr = (key, params) => translate(settings, key, params);
  try {
    const saved = await plugin.memoryStore.captureTurn(turn, settings);
    if (saved.length > 0) {
      onUpdate({
        kind: "notice",
        noticeType: "memory_updated",
        insertBeforeLastContent: true,
        title: tr(`${keyPrefix}.memoryUpdated.title`),
        summary: formatMemoryUpdateSummary(settings, keyPrefix, translate, saved),
        auditItems: buildMemoryUpdateAuditItems(saved, settings, keyPrefix, translate)
      });
    }
  } catch (error) {
    console.warn("Agent Dock could not update memory:", error);
    onUpdate({
      kind: "notice",
      noticeType: "memory_skipped",
      insertBeforeLastContent: true,
      title: tr(`${keyPrefix}.memorySkipped.title`),
      summary: tr(`${keyPrefix}.memorySkipped.summary`)
    });
  }
}

async function captureInteractionMemory(plugin, turn, settings, onUpdate, keyPrefix, translate) {
  const tr = (key, params) => translate(settings, key, params);
  try {
    const result = await plugin.interactionMemoryStore.captureTurn(turn, settings);
    if (result.closedEpisodes.length > 0) {
      onUpdate({
        kind: formatInteractionMemoryUpdateKind(result),
        noticeType: "interaction_memory_updated",
        insertBeforeLastContent: true,
        title: formatInteractionMemoryUpdateTitle(settings, keyPrefix, translate, result),
        summary: formatInteractionMemoryUpdateSummary(settings, keyPrefix, translate, result),
        auditItems: buildInteractionMemoryAuditItems(result, settings, keyPrefix, translate)
      });
    }
  } catch (error) {
    console.warn("Agent Dock could not update interaction memory:", error);
    onUpdate({
      kind: "notice",
      noticeType: "interaction_memory_skipped",
      insertBeforeLastContent: true,
      title: tr(`${keyPrefix}.interactionMemorySkipped.title`),
      summary: tr(`${keyPrefix}.interactionMemorySkipped.summary`)
    });
  }
}

async function captureDeepMemory(plugin, turn, settings, onUpdate, keyPrefix, translate) {
  const tr = (key, params) => translate(settings, key, params);
  try {
    const saved = await plugin.deepMemoryStore.captureTurn(turn, settings);
    if (saved.length > 0) {
      onUpdate({
        kind: "notice",
        noticeType: "deep_memory_updated",
        insertBeforeLastContent: true,
        title: tr(`${keyPrefix}.deepMemoryUpdated.title`),
        summary: formatDeepMemoryUpdateSummary(settings, keyPrefix, translate, saved),
        auditItems: buildDeepMemoryAuditItems(saved, settings, keyPrefix, translate)
      });
    }
  } catch (error) {
    console.warn("Agent Dock could not update deep memory:", error);
    onUpdate({
      kind: "notice",
      noticeType: "deep_memory_skipped",
      insertBeforeLastContent: true,
      title: tr(`${keyPrefix}.deepMemorySkipped.title`),
      summary: tr(`${keyPrefix}.deepMemorySkipped.summary`)
    });
  }
}

function emitAgentDockSignalNotices(signals, settings, keyPrefix, translate, onUpdate, reflectionFilter, signalEvidenceContext) {
  const reflectionNotice = formatAgentDockReflectionNotice(
    signals.filter((signal) => !reflectionFilter?.hasEmitted(signal)),
    settings,
    keyPrefix,
    translate
  );
  if (reflectionNotice) {
    reflectionNotice.signalEvidenceContext = signalEvidenceContext;
    onUpdate(reflectionNotice);
  }
  for (const signal of signals.filter((item) => item?.envelope !== "reflection_v1")) {
    const notice = formatAgentDockSignalNotice(signal, settings, keyPrefix, translate);
    if (notice) {
      onUpdate(notice);
    }
  }
}

function appendToolResultEvidence(existing, update) {
  return mergeSignalEvidenceContexts(
    { tool_result: existing },
    { tool_result: [update?.title, update?.summary, update?.detail].filter(Boolean).join("\n") }
  ).tool_result;
}

function emitInvalidAgentDockSignalActivity(signalResult, onUpdate) {
  const activity = formatInvalidAgentDockSignalActivity(signalResult);
  if (activity) {
    onUpdate(activity);
  }
}

function getPreviousAssistantResponse(conversation) {
  if (!Array.isArray(conversation)) {
    return "";
  }
  for (let index = conversation.length - 2; index >= 0; index -= 1) {
    const message = conversation[index];
    if (message?.role === "assistant" && message.content) {
      return message.content;
    }
  }
  return "";
}

module.exports = {
  appendToolResultEvidence,
  captureTurnContinuity,
  emitAgentDockSignalNotices,
  emitInvalidAgentDockSignalActivity,
  getPreviousAssistantResponse
};
