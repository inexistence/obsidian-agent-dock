const { buildPromptWithMetadata, buildTurnContextPrompt } = require("../../prompt");

async function buildAgentTurnContext({
  plugin,
  settings,
  prompt,
  conversation,
  onUpdate,
  translate,
  useFullPrompt = true
}) {
  const activeFilePath = plugin.app.workspace.getActiveFile()?.path || "";
  const promptResult = useFullPrompt
    ? await buildPromptWithMetadata(plugin.app, settings, prompt, conversation)
    : await buildTurnContextPrompt(plugin.app, settings, prompt);
  emitContextCompressedNotice(onUpdate, promptResult, translate);
  return { activeFilePath, promptResult };
}

async function buildPromptResultForTurnContext({ app, settings, prompt, conversation, useFullPrompt = true }) {
  return useFullPrompt
    ? buildPromptWithMetadata(app, settings, prompt, conversation)
    : buildTurnContextPrompt(app, settings, prompt);
}

function emitContextCompressedNotice(onUpdate, promptResult, translate) {
  if (!promptResult?.context?.compressed || typeof onUpdate !== "function") {
    return;
  }
  onUpdate({
    kind: "notice",
    noticeType: "context_compressed",
    title: translate("notice.contextCompressed.title"),
    summary: translate("notice.contextCompressed.summary", {
      original: promptResult.context.originalChars,
      current: promptResult.context.promptChars
    })
  });
}

function emitDebugPromptActivity(onUpdate, promptResult, settings, translate) {
  if (!settings?.debugActivity || !promptResult?.prompt) {
    return;
  }
  onUpdate({
    kind: "activity",
    title: translate("timeline.turnPrompt.title"),
    summary: translate("timeline.turnPrompt.summary", { chars: promptResult.prompt.length }),
    detail: promptResult.prompt,
    persist: false
  });
}

module.exports = {
  buildAgentTurnContext,
  buildPromptResultForTurnContext,
  emitDebugPromptActivity
};
