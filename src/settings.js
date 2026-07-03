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
  contextLimitChars: 258000,
  persistChatHistory: true,
  maxPersistedSessions: 20,
  maxPersistedMessagesPerSession: 200
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
  settings.persistChatHistory = settings.persistChatHistory !== false;
  settings.maxPersistedSessions = normalizePositiveInteger(
    settings.maxPersistedSessions,
    DEFAULT_SETTINGS.maxPersistedSessions
  );
  settings.maxPersistedMessagesPerSession = normalizePositiveInteger(
    settings.maxPersistedMessagesPerSession,
    DEFAULT_SETTINGS.maxPersistedMessagesPerSession
  );

  delete settings.command;
  return settings;
}

function normalizePluginData(savedData) {
  if (savedData && savedData.schemaVersion >= 2) {
    return {
      schemaVersion: 2,
      settings: normalizeSettings(savedData.settings),
      chatState: normalizeChatState(savedData.chatState)
    };
  }

  return {
    schemaVersion: 2,
    settings: normalizeSettings(savedData),
    chatState: normalizeChatState(null)
  };
}

function normalizeChatState(savedState) {
  const state = savedState && typeof savedState === "object" ? savedState : {};
  const sessionIndex = Array.isArray(state.sessionIndex)
    ? state.sessionIndex.map(normalizeSessionIndexEntry).filter(Boolean)
    : [];

  return {
    activeSessionId: typeof state.activeSessionId === "string" ? state.activeSessionId : "",
    sessionIndex
  };
}

function normalizeSessionIndexEntry(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id) {
    return null;
  }

  return {
    id: entry.id,
    title: typeof entry.title === "string" && entry.title ? entry.title : "Chat",
    isUntitled: entry.isUntitled === true,
    createdAt: normalizeTimestamp(entry.createdAt),
    updatedAt: normalizeTimestamp(entry.updatedAt)
  };
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizePluginData,
  normalizeSettings
};
