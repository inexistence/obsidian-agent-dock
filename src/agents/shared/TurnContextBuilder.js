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
const { buildMemoryRecallPacket } = require("../../storage/MemoryRecallPacket");
const { getPreviousAnswerMemoryTrace } = require("./memoryTrace");
const { formatCollaborationOmissionsPrompt } = require("../../storage/MemoryOmissionPlanner");

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
    activeFileContent: activeNoteEvidence,
    workingDirectory: cwd
  });
  const memorySearch = await getExplicitMemorySearch(
    plugin.memoryStore,
    prompt,
    settings,
    onUpdate,
    translate,
    keyPrefix,
    {
      activeFilePath,
      activeFileContent: activeNoteEvidence
    }
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
  const automaticPacket = buildMemoryRecallPacket(promptSignals.memories, settings, {
    refPrefix: "M"
  });
  const explicitPacket = buildMemoryRecallPacket(promptSignals.memorySearchResults, Object.assign({}, settings, {
    memoryMaxPromptItems: 5,
    memoryMaxPromptChars: 3000
  }), {
    explicit: true,
    refPrefix: "S"
  });
  promptSignals.memories = automaticPacket.items;
  promptSignals.memorySearchResults = explicitPacket.items;
  const memoryRecallManifest = Object.assign({}, automaticPacket.manifest, explicitPacket.manifest);
  const memoryTrace = await getPreviousAnswerMemoryTrace(
    plugin.memoryStore,
    prompt,
    conversation
  );
  const collaborationOmissions = typeof plugin.memoryStore.getCollaborationOmissions === "function"
    ? await plugin.memoryStore.getCollaborationOmissions(settings, {
      activeFilePath,
      activeFileContent: activeNoteEvidence
    })
    : [];
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
    memoryTracePrompt: memoryTrace?.prompt || "",
    collaborationOmissions,
    useFullPrompt
  });
  const referencedDeepMemories = getReferencedDeepMemories(promptResult, promptSignals);
  if (referencedDeepMemories.length > 0 && typeof plugin.deepMemoryStore.markRecalled === "function") {
    await plugin.deepMemoryStore.markRecalled(referencedDeepMemories, Date.now());
  }
  if (
    collaborationOmissions.length > 0
    && isPromptSectionIncluded(promptResult, "collaboration_omissions")
    && typeof plugin.memoryStore.markOmissionsNotified === "function"
  ) {
    try {
      await plugin.memoryStore.markOmissionsNotified(collaborationOmissions, Date.now());
    } catch (error) {
      console.warn("Agent Dock could not update collaboration follow-up cooldown:", error);
    }
  }

  emitPromptContextNotices(
    onUpdate,
    promptResult,
    promptSignals,
    translate,
    keyPrefix,
    referencedDeepMemories
  );
  emitCollaborationOmissionNotice(
    onUpdate,
    promptResult,
    collaborationOmissions,
    translate,
    keyPrefix
  );
  emitMemoryProvenanceMetadata(onUpdate, memoryRecallManifest);

  return {
    activeFilePath,
    promptResult,
    promptSignals,
    expressionPolicy,
    interactionPatternCandidates,
    memoryRecallManifest,
    memoryTrace,
    collaborationOmissions,
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
  memoryTracePrompt = "",
  collaborationOmissions = [],
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
    interactionPatternCandidates,
    memoryTracePrompt,
    collaborationOmissions
  };

  if (useFullPrompt) {
    return buildPromptWithMetadata(app, settings, prompt, conversation, options);
  }
  return buildTurnContextPrompt(app, settings, prompt, options);
}

function isPromptSectionIncluded(promptResult, sectionName) {
  return !((promptResult?.context?.omittedSections || []).includes(sectionName))
    && !((promptResult?.context?.truncatedSections || []).includes(sectionName))
    && String(promptResult?.prompt || "").includes("Local collaboration follow-up signals:");
}

function emitCollaborationOmissionNotice(onUpdate, promptResult, omissions, translate, keyPrefix) {
  if (!isPromptSectionIncluded(promptResult, "collaboration_omissions") || omissions.length === 0) {
    return;
  }
  onUpdate({
    kind: "notice",
    noticeType: "collaboration_omissions",
    title: translate(`${keyPrefix}.collaborationOmissions.title`),
    summary: translate(`${keyPrefix}.collaborationOmissions.summary`, { count: omissions.length }),
    detail: formatCollaborationOmissionsPrompt(omissions)
  });
}

function emitMemoryProvenanceMetadata(onUpdate, manifest) {
  if (typeof onUpdate !== "function") {
    return;
  }
  const available = Object.entries(manifest || {}).map(([ref, item]) => ({
    ref,
    memoryId: item.memoryId
  }));
  if (available.length === 0) {
    return;
  }
  onUpdate({
    internalOnly: true,
    memoryProvenance: {
      available,
      claimedUsedRefs: []
    }
  });
}

function emitPromptContextNotices(onUpdate, promptResult, promptSignals, translate, keyPrefix, referencedDeepMemories = null) {
  if (promptSignals.memories.length > 0) {
    emitMemoryNotice(onUpdate, promptSignals.memories, translate, keyPrefix);
  }
  const referenced = referencedDeepMemories || getReferencedDeepMemories(promptResult, promptSignals);
  if (referenced.length > 0) {
    emitDeepMemoryNotice(onUpdate, referenced, translate, keyPrefix);
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
