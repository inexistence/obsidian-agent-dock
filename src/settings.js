const { MODE_OPTIONS } = require("./modes");
const { DEFAULT_LANGUAGE, normalizeLanguage } = require("./i18n");

const CUSTOM_ASSISTANT_STYLE_MAX_CHARS = 4000;

const ASSISTANT_STYLE_OPTIONS = {
  concise: {
    label: "Concise",
    description: "Direct and economical. Leads with the answer or action taken, with only necessary explanation."
  },
  collaborative: {
    label: "Collaborative",
    description: "Warm, capable, and practical. Shares brief progress, makes decisions, and grounds the final answer in what was done."
  },
  teaching: {
    label: "Teaching",
    description: "Patient and explanatory. Explains important choices, local concepts, tradeoffs, and useful examples."
  },
  review: {
    label: "Review",
    description: "Code-review posture. Prioritizes bugs, regressions, data loss, privacy or security risks, and missing verification."
  },
  custom: {
    label: "Custom",
    description: "Uses your own style guidance below as tone and collaboration preference."
  }
};

const DEFAULT_SETTINGS = {
  language: DEFAULT_LANGUAGE,
  agentId: "codex",
  codexPath: "/opt/homebrew/bin/codex",
  args: "exec {{prompt}}",
  interactiveArgs: "",
  mode: "readOnly",
  workingDirectory: "",
  assistantStyle: "collaborative",
  customAssistantStyle: "",
  includeActiveNote: true,
  debugActivity: false,
  activeNoteMaxChars: 6000,
  contextLimitChars: 258000,
  persistChatHistory: true,
  maxPersistedSessions: 20,
  maxPersistedMessagesPerSession: 200,
  memoryEnabled: true,
  memoryAutoCapture: true,
  memoryMaxItems: 200,
  memoryMaxPromptItems: 12,
  memoryMaxPromptChars: 8000
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

  settings.language = normalizeLanguage(settings.language);

  if (!settings.agentId) {
    settings.agentId = DEFAULT_SETTINGS.agentId;
  }

  if (!ASSISTANT_STYLE_OPTIONS[settings.assistantStyle]) {
    settings.assistantStyle = DEFAULT_SETTINGS.assistantStyle;
  }
  settings.customAssistantStyle = truncateString(
    normalizeString(settings.customAssistantStyle),
    CUSTOM_ASSISTANT_STYLE_MAX_CHARS
  );

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
  settings.memoryEnabled = settings.memoryEnabled !== false;
  settings.memoryAutoCapture = settings.memoryAutoCapture !== false;
  settings.memoryMaxItems = normalizePositiveInteger(
    settings.memoryMaxItems,
    DEFAULT_SETTINGS.memoryMaxItems
  );
  settings.memoryMaxPromptItems = normalizePositiveInteger(
    settings.memoryMaxPromptItems,
    DEFAULT_SETTINGS.memoryMaxPromptItems
  );
  settings.memoryMaxPromptChars = normalizePositiveInteger(
    settings.memoryMaxPromptChars,
    DEFAULT_SETTINGS.memoryMaxPromptChars
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

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function truncateString(value, maxChars) {
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

module.exports = {
  ASSISTANT_STYLE_OPTIONS,
  CUSTOM_ASSISTANT_STYLE_MAX_CHARS,
  DEFAULT_SETTINGS,
  normalizePluginData,
  normalizeSettings
};
