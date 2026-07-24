const assert = require("assert");

const { withModel } = require("../src/cli/args");
const { _test: cursorAgentTest } = require("../src/agents/cursor/CursorAgent");
const { _test: codexModelCatalogTest } = require("../src/agents/codex/ModelCatalog");
const { normalizeProviderState, serializeProviderState } = require("../src/storage/providerState");

assert.deepStrictEqual(
  withModel(["exec", "{{prompt}}"], "gpt-5.3-codex"),
  ["--model", "gpt-5.3-codex", "exec", "{{prompt}}"],
  "Codex must receive the selected model before its exec subcommand"
);
assert.deepStrictEqual(
  codexModelCatalogTest.normalizeCatalog([
    { model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", description: "", hidden: false, isDefault: true },
    { model: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", description: "", hidden: false, isDefault: false }
  ], "gpt-5.6-terra"),
  {
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "" }
    ],
    defaultModel: "gpt-5.6-terra",
    defaultLabel: "GPT-5.6 Terra"
  },
  "the effective Codex configuration must override the catalog default"
);
assert.deepStrictEqual(
  cursorAgentTest.parseCursorModels("Available models\n\nauto - Auto (current, default)\ngpt-5.3-codex - Codex 5.3\n"),
  {
    models: [
      { id: "auto", label: "Auto", description: "" },
      { id: "gpt-5.3-codex", label: "Codex 5.3", description: "" }
    ],
    defaultModel: "auto",
    defaultLabel: "Auto"
  },
  "Cursor catalog parsing must preserve IDs and mark the reported default"
);
assert.deepStrictEqual(
  codexModelCatalogTest.normalizeCatalog([
    { model: "gpt-5.6", displayName: "GPT-5.6", description: "", hidden: false, isDefault: true },
    { model: "internal", displayName: "Internal", description: "", hidden: true, isDefault: false }
  ], ""),
  {
    models: [{ id: "gpt-5.6", label: "GPT-5.6", description: "" }],
    defaultModel: "gpt-5.6",
    defaultLabel: "GPT-5.6"
  },
  "Codex catalog must hide non-picker entries and expose its default"
);
assert.deepStrictEqual(
  withModel(["exec", "{{prompt}}"], ""),
  ["exec", "{{prompt}}"],
  "an empty Codex model must retain the CLI default"
);
assert.deepStrictEqual(
  cursorAgentTest.buildCursorArgs({ cursorExtraArgs: "--api-key key" }, "composer-1"),
  ["--api-key", "key", "--model", "composer-1"],
  "Cursor must receive the selected model before its acp subcommand"
);
assert.deepStrictEqual(
  serializeProviderState({
    codex: { model: "gpt-5.3-codex" },
    cursor: { acpSessionId: "session-1", model: "composer-1" }
  }),
  {
    codex: { model: "gpt-5.3-codex" },
    cursor: { acpSessionId: "session-1", model: "composer-1" }
  },
  "the selected model must persist with its chat session"
);
assert.deepStrictEqual(
  normalizeProviderState({ codex: { model: "  gpt-5.3-codex  " } }),
  { codex: { model: "gpt-5.3-codex" } }
);

console.log("model selection tests passed");
