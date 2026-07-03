const { MODE_OPTIONS } = require("./modes");

const DEFAULT_SETTINGS = {
  agentId: "codex",
  codexPath: "/opt/homebrew/bin/codex",
  args: "exec {{prompt}}",
  interactiveArgs: "",
  mode: "readOnly",
  workingDirectory: "",
  includeActiveNote: true,
  debugActivity: false,
  activeNoteMaxChars: 6000,
  contextLimitChars: 258000
};

function normalizeSettings(savedSettings) {
  const settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings || {});

  if (savedSettings && savedSettings.command && !savedSettings.codexPath) {
    settings.codexPath = savedSettings.command;
  }

  if (settings.mode === "ask") {
    settings.mode = "readOnly";
  }

  if (!MODE_OPTIONS[settings.mode]) {
    settings.mode = DEFAULT_SETTINGS.mode;
  }

  if (!settings.agentId) {
    settings.agentId = DEFAULT_SETTINGS.agentId;
  }

  settings.activeNoteMaxChars = normalizePositiveInteger(
    settings.activeNoteMaxChars,
    DEFAULT_SETTINGS.activeNoteMaxChars
  );
  settings.contextLimitChars = normalizePositiveInteger(
    settings.contextLimitChars,
    DEFAULT_SETTINGS.contextLimitChars
  );

  delete settings.command;
  return settings;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeSettings
};
