const { buildPromptInteractionContext } = require("../../interaction/LocalSignalExtractor");
const { buildPromptWithMetadata, buildTurnContextPrompt } = require("../../prompt");
const { planPromptSignals } = require("../../promptSignals");
const {
  getExplicitMemorySearch,
  removeMemorySearchDuplicates
} = require("./memorySearch");
const {
  emitContextCompressedNotice,
  emitMemoryNotice
} = require("./memoryNotices");

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
  const activeFilePath = plugin.app.workspace.getActiveFile()?.path || "";
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
  const promptSignals = planPromptSignals({
    memories: removeMemorySearchDuplicates(memories, memorySearch.results),
    memorySearchResults: memorySearch.results,
    memorySearchPerformed: memorySearch.performed,
    interactionStance: await plugin.interactionMemoryStore.getPromptStance(
      settings,
      buildPromptInteractionContext(prompt, conversation)
    ),
    workingAffect: plugin.getPromptWorkingAffect(prompt)
  });
  const promptResult = await buildPromptResultForTurnContext({
    app: plugin.app,
    settings,
    prompt,
    conversation,
    promptSignals,
    useFullPrompt
  });

  emitPromptContextNotices(onUpdate, promptResult, promptSignals, translate, keyPrefix);

  return {
    activeFilePath,
    promptResult,
    promptSignals
  };
}

async function buildPromptResultForTurnContext({
  app,
  settings,
  prompt,
  conversation,
  promptSignals,
  useFullPrompt = true
}) {
  const options = {
    workingAffect: promptSignals.workingAffect,
    interactionStance: promptSignals.interactionStance,
    memories: promptSignals.memories,
    memorySearchResults: promptSignals.memorySearchResults,
    memorySearchPerformed: promptSignals.memorySearchPerformed
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
  if (promptResult.context.compressed) {
    emitContextCompressedNotice(onUpdate, promptResult.context, translate, keyPrefix);
  }
}

module.exports = {
  buildAgentTurnContext,
  buildPromptResultForTurnContext,
  emitPromptContextNotices
};
