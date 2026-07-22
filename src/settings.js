const { MODE_OPTIONS } = require("./modes");
const { DEFAULT_LANGUAGE, normalizeLanguage } = require("./i18n");
const { expandHomePath } = require("./cli/paths");

const CUSTOM_ASSISTANT_STYLE_MAX_CHARS = 4000;
const ASSISTANT_DISPLAY_NAME_MAX_CHARS = 80;

const ASSISTANT_STYLE_OPTIONS = {
  concise: {
    label: "Concise",
    description: "Direct and economical. Lead with the answer or action taken."
  },
  collaborative: {
    label: "Collaborative",
    description: "Warm, capable, and practical. Share brief progress and concrete outcomes."
  },
  teaching: {
    label: "Teaching",
    description: "Patient and explanatory. Clarify important choices and concepts."
  },
  review: {
    label: "Review",
    description: "Prioritize correctness, risks, regressions, and missing verification."
  },
  custom: {
    label: "Custom",
    description: "Use the custom response-style guidance below."
  }
};

const DEFAULT_SETTINGS = {
  language: DEFAULT_LANGUAGE,
  agentId: "codex",
  codexPath: "/opt/homebrew/bin/codex",
  args: "exec {{prompt}}",
  cursorPath: "~/.local/bin/agent",
  cursorExtraArgs: "",
  cursorPermissionPolicy: "allow-once",
  mode: "readOnly",
  workingDirectory: "",
  assistantDisplayName: "",
  assistantStyle: "collaborative",
  customAssistantStyle: "",
  showToneCapsule: true,
  debugActivity: false,
  contextLimitChars: 258000,
  persistChatHistory: true,
  maxPersistedSessions: 20,
  maxPersistedMessagesPerSession: 200,
  onboardingCompleted: false,
  workspaceWriteAcknowledged: false
};

function normalizeSettings(savedSettings) {
  const saved = savedSettings && typeof savedSettings === "object" ? savedSettings : {};
  const settings = Object.assign({}, DEFAULT_SETTINGS);

  settings.language = normalizeLanguage(saved.language);
  settings.agentId = saved.agentId === "cursor" ? "cursor" : "codex";
  settings.codexPath = normalizeString(saved.codexPath || saved.command).trim() || DEFAULT_SETTINGS.codexPath;
  settings.args = normalizeString(saved.args).trim() || DEFAULT_SETTINGS.args;
  settings.cursorPath = expandHomePath(normalizeString(saved.cursorPath) || DEFAULT_SETTINGS.cursorPath);
  settings.cursorExtraArgs = normalizeString(saved.cursorExtraArgs);
  settings.cursorPermissionPolicy = normalizeCursorPermissionPolicy(saved.cursorPermissionPolicy);
  settings.workspaceWriteAcknowledged = saved.workspaceWriteAcknowledged === true;
  settings.mode = saved.mode === "workspaceWrite" && !settings.workspaceWriteAcknowledged
    ? DEFAULT_SETTINGS.mode
    : MODE_OPTIONS[saved.mode] ? saved.mode : DEFAULT_SETTINGS.mode;
  settings.workingDirectory = normalizeString(saved.workingDirectory).trim();
  settings.assistantDisplayName = truncateString(
    normalizeString(saved.assistantDisplayName).trim(),
    ASSISTANT_DISPLAY_NAME_MAX_CHARS
  );
  settings.assistantStyle = ASSISTANT_STYLE_OPTIONS[saved.assistantStyle]
    ? saved.assistantStyle
    : DEFAULT_SETTINGS.assistantStyle;
  settings.customAssistantStyle = truncateString(
    normalizeString(saved.customAssistantStyle),
    CUSTOM_ASSISTANT_STYLE_MAX_CHARS
  );
  settings.showToneCapsule = saved.showToneCapsule !== false;
  settings.debugActivity = saved.debugActivity === true;
  settings.contextLimitChars = normalizePositiveInteger(saved.contextLimitChars, DEFAULT_SETTINGS.contextLimitChars);
  settings.persistChatHistory = saved.persistChatHistory !== false;
  settings.maxPersistedSessions = normalizePositiveInteger(saved.maxPersistedSessions, DEFAULT_SETTINGS.maxPersistedSessions);
  settings.maxPersistedMessagesPerSession = normalizePositiveInteger(
    saved.maxPersistedMessagesPerSession,
    DEFAULT_SETTINGS.maxPersistedMessagesPerSession
  );
  settings.onboardingCompleted = saved.onboardingCompleted === true;
  return settings;
}

function normalizePluginData(savedData) {
  const source = savedData && savedData.schemaVersion >= 2
    ? savedData
    : { settings: savedData };
  return {
    schemaVersion: 3,
    settings: normalizeSettings(source.settings),
    chatState: normalizeChatState(source.chatState)
  };
}

function normalizeChatState(savedState) {
  const state = savedState && typeof savedState === "object" ? savedState : {};
  return {
    activeSessionId: typeof state.activeSessionId === "string" ? state.activeSessionId : "",
    sessionIndex: Array.isArray(state.sessionIndex)
      ? state.sessionIndex.map(normalizeSessionIndexEntry).filter(Boolean)
      : []
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
    hasUnreadCompletion: entry.hasUnreadCompletion === true,
    unreadTurnStatus: normalizeUnreadTurnStatus(entry.unreadTurnStatus, entry.hasUnreadCompletion),
    createdAt: normalizeTimestamp(entry.createdAt),
    updatedAt: normalizeTimestamp(entry.updatedAt)
  };
}

function normalizeUnreadTurnStatus(status, hasUnreadCompletion) {
  if (status === "success" || status === "failed" || status === "stopped") {
    return status;
  }
  return hasUnreadCompletion === true ? "success" : "";
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function truncateString(value, maxChars) {
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function normalizeCursorPermissionPolicy(value) {
  return value === "allow-always" || value === "reject-once" ? value : "allow-once";
}

module.exports = {
  ASSISTANT_DISPLAY_NAME_MAX_CHARS,
  ASSISTANT_STYLE_OPTIONS,
  CUSTOM_ASSISTANT_STYLE_MAX_CHARS,
  DEFAULT_SETTINGS,
  normalizePluginData,
  normalizeSettings
};
