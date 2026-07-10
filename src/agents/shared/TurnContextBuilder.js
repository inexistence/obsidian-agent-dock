const { buildPromptInteractionContext } = require("../../interaction/LocalSignalExtractor");
const {
  formatMomentSummary,
  selectMomentMemories
} = require("../../continuity/ContinuityPromptFormatter");
const { getPersonaProfile } = require("../../persona/PersonaProfile");
const { buildPromptWithMetadata, buildTurnContextPrompt } = require("../../prompt");
const { planPromptSignals } = require("../../promptSignals");
const { planExpressionPolicy } = require("../../expression/ExpressionPolicyPlanner");
const {
  getExplicitMemorySearch,
  removeMemorySearchDuplicates
} = require("./memorySearch");
const {
  emitContextCompressedNotice,
  emitDeepMemoryNotice,
  emitMemoryNotice
} = require("./memoryNotices");
const { createSignalEvidenceContext } = require("./signalEvidence");

async function buildAgentTurnContext({
  plugin,
  settings,
  prompt,
  conversation,
  cwd,
  onUpdate,
  translate,
  keyPrefix,
  useFullPrompt = true
}) {
  const activeFile = plugin.app.workspace.getActiveFile();
  const activeFilePath = activeFile?.path || "";
  const activeNoteEvidence = await readActiveNoteEvidence(plugin.app, activeFile);
  const memories = await plugin.memoryStore.getRelevantMemories(prompt, settings, {
    activeFilePath,
    workingDirectory: cwd
  });
  const memorySearch = await getExplicitMemorySearch(
    plugin.memoryStore,
    prompt,
    settings,
    onUpdate,
    translate,
    keyPrefix
  );
  const conversationText = Array.isArray(conversation)
    ? conversation.slice(-8).map((message) => message?.content || "").filter(Boolean).join("\n")
    : "";
  const interactionPatternCandidates = typeof plugin.interactionMemoryStore.getPatternCandidateRegistry === "function"
    ? await plugin.interactionMemoryStore.getPatternCandidateRegistry(settings)
    : [];
  const promptSignals = planPromptSignals({
    memories: removeMemorySearchDuplicates(memories, memorySearch.results),
    deepMemories: await plugin.deepMemoryStore.getPromptMemories(prompt, settings, {
      activeFilePath,
      workingDirectory: cwd,
      conversationText
    }),
    memorySearchResults: memorySearch.results,
    memorySearchPerformed: memorySearch.performed,
    interactionStance: await plugin.interactionMemoryStore.getPromptStance(
      settings,
      buildPromptInteractionContext(prompt, conversation)
    ),
    personaProfile: getPersonaProfile(settings),
    workingAffect: plugin.getPromptWorkingAffect(prompt)
  });
  const expressionPolicy = planExpressionPolicy({
    prompt,
    conversationText,
    workingAffect: promptSignals.workingAffect,
    interactionStance: promptSignals.interactionStance,
    assistantStyle: settings.assistantStyle
  });
  const promptResult = await buildPromptResultForTurnContext({
    app: plugin.app,
    settings,
    prompt,
    conversation,
    promptSignals,
    expressionPolicy,
    interactionPatternCandidates,
    useFullPrompt
  });

  emitPromptContextNotices(onUpdate, promptResult, promptSignals, translate, keyPrefix);

  return {
    activeFilePath,
    promptResult,
    promptSignals,
    expressionPolicy,
    interactionPatternCandidates,
    signalEvidenceContext: createSignalEvidenceContext({
      user_message: prompt,
      recalled_memory: formatRecalledMemoryEvidence(promptSignals),
      active_note: activeNoteEvidence
    })
  };
}

async function readActiveNoteEvidence(app, activeFile) {
  if (!activeFile || typeof app?.vault?.cachedRead !== "function") {
    return "";
  }
  try {
    return await app.vault.cachedRead(activeFile);
  } catch {
    return "";
  }
}

function formatRecalledMemoryEvidence(promptSignals) {
  const parts = [];
  for (const item of promptSignals?.memories || []) {
    parts.push(item?.text);
  }
  for (const item of promptSignals?.memorySearchResults || []) {
    parts.push(item?.text);
  }
  for (const item of promptSignals?.deepMemories || []) {
    parts.push(item?.summary, item?.userExcerpt, item?.assistantExcerpt);
  }
  return parts.filter(Boolean).join("\n");
}

async function buildPromptResultForTurnContext({
  app,
  settings,
  prompt,
  conversation,
  promptSignals,
  expressionPolicy,
  interactionPatternCandidates = [],
  useFullPrompt = true
}) {
  const options = {
    workingAffect: promptSignals.workingAffect,
    deepMemories: promptSignals.deepMemories,
    interactionStance: promptSignals.interactionStance,
    personaProfile: promptSignals.personaProfile,
    memories: promptSignals.memories,
    memorySearchResults: promptSignals.memorySearchResults,
    memorySearchPerformed: promptSignals.memorySearchPerformed,
    expressionPolicy,
    interactionPatternCandidates
  };

  if (useFullPrompt) {
    return buildPromptWithMetadata(app, settings, prompt, conversation, options);
  }
  return buildTurnContextPrompt(app, settings, prompt, options);
}

function emitPromptContextNotices(onUpdate, promptResult, promptSignals, translate, keyPrefix) {
  if (promptSignals.memories.length > 0) {
    emitMemoryNotice(onUpdate, promptSignals.memories, translate, keyPrefix);
  }
  const referencedDeepMemories = getReferencedDeepMemories(promptResult, promptSignals);
  if (referencedDeepMemories.length > 0) {
    emitDeepMemoryNotice(onUpdate, referencedDeepMemories, translate, keyPrefix);
  }
  if (promptResult.context.compressed) {
    emitContextCompressedNotice(onUpdate, promptResult.context, translate, keyPrefix);
  }
}

function getReferencedDeepMemories(promptResult, promptSignals) {
  const prompt = String(promptResult?.prompt || "");
  const omittedSections = Array.isArray(promptResult?.context?.omittedSections)
    ? promptResult.context.omittedSections
    : [];
  if (!prompt || omittedSections.includes("assistant_continuity")) {
    return [];
  }
  return selectMomentMemories(promptSignals?.deepMemories)
    .filter((item) => item?.summary && prompt.includes(formatMomentSummary(item)));
}

function emitDebugPromptActivity(onUpdate, promptResult, settings, translate) {
  if (!settings?.debugActivity || !promptResult?.prompt) {
    return;
  }

  onUpdate({
    kind: "activity",
    title: translate("timeline.turnPrompt.title"),
    summary: translate("timeline.turnPrompt.summary", {
      chars: promptResult.prompt.length
    }),
    detail: promptResult.prompt,
    persist: false
  });
}

module.exports = {
  buildAgentTurnContext,
  buildPromptResultForTurnContext,
  emitDebugPromptActivity,
  emitPromptContextNotices,
  _test: {
    formatRecalledMemoryEvidence,
    getReferencedDeepMemories,
    readActiveNoteEvidence
  }
};
