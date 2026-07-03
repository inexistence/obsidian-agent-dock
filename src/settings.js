const { MODE_OPTIONS } = require("./modes");

const DEFAULT_SETTINGS = {
  agentId: "codex",
  codexPath: "/opt/homebrew/bin/codex",
  args: "exec {{prompt}}",
  interactiveArgs: "",
  mode: "ask",
  workingDirectory: "",
  includeActiveNote: true,
  debugActivity: false,
  activeNoteMaxChars: 6000
};

function normalizeSettings(savedSettings) {
  const settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings || {});

  if (savedSettings && savedSettings.command && !savedSettings.codexPath) {
    settings.codexPath = savedSettings.command;
  }

  if (!MODE_OPTIONS[settings.mode]) {
    settings.mode = DEFAULT_SETTINGS.mode;
  }

  if (!settings.agentId) {
    settings.agentId = DEFAULT_SETTINGS.agentId;
  }

  delete settings.command;
  return settings;
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeSettings
};
