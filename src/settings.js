const { MODE_OPTIONS } = require("./modes");
const { DEFAULT_LANGUAGE, normalizeLanguage } = require("./i18n");
const { expandHomePath } = require("./cli/paths");
const { normalizeAffectState } = require("./affect/WorkingAffectStore");

const CUSTOM_ASSISTANT_STYLE_MAX_CHARS = 4000;
const ASSISTANT_DISPLAY_NAME_MAX_CHARS = 80;
const AFFECT_HALF_LIFE_MINUTES_MIN = 5;
const AFFECT_HALF_LIFE_MINUTES_MAX = 1440;

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
  cursorPath: "~/.local/bin/agent",
  cursorExtraArgs: "",
  cursorInteractiveArgs: "",
  cursorPermissionPolicy: "allow-once",
  mode: "readOnly",
  workingDirectory: "",
  assistantDisplayName: "",
  assistantStyle: "collaborative",
  customAssistantStyle: "",
  debugActivity: false,
  contextLimitChars: 258000,
  persistChatHistory: true,
  maxPersistedSessions: 20,
  maxPersistedMessagesPerSession: 200,
  memoryEnabled: true,
  memoryAutoCapture: true,
  memoryAgentSearchEnabled: true,
  memoryMaxItems: 200,
  memoryMaxPromptItems: 12,
  memoryMaxPromptChars: 8000,
  agentProfileEnabled: true,
  agentProfileAutoCapture: true,
  agentProfileMaxPromptTraits: 6,
  agentProfileMinEvidence: 2,
  agentProfileHalfLifeDays: 30,
  affectEnabled: true,
  affectCrossSessionEnabled: true,
  affectRestoreAfterRestart: true,
  affectShowIndicator: true,
  affectSensitivity: "normal",
  affectHalfLifeMinutes: 45
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
  settings.assistantDisplayName = truncateString(
    normalizeString(settings.assistantDisplayName).trim(),
    ASSISTANT_DISPLAY_NAME_MAX_CHARS
  );

  if (!settings.agentId) {
    settings.agentId = DEFAULT_SETTINGS.agentId;
  }

  settings.cursorPath = expandHomePath(normalizeString(settings.cursorPath) || DEFAULT_SETTINGS.cursorPath);
  settings.cursorExtraArgs = normalizeString(settings.cursorExtraArgs);
  settings.cursorInteractiveArgs = normalizeString(settings.cursorInteractiveArgs);
  settings.cursorPermissionPolicy = normalizeCursorPermissionPolicy(
    settings.cursorPermissionPolicy,
    DEFAULT_SETTINGS.cursorPermissionPolicy
  );

  if (!ASSISTANT_STYLE_OPTIONS[settings.assistantStyle]) {
    settings.assistantStyle = DEFAULT_SETTINGS.assistantStyle;
  }
  settings.customAssistantStyle = truncateString(
    normalizeString(settings.customAssistantStyle),
    CUSTOM_ASSISTANT_STYLE_MAX_CHARS
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
  settings.memoryAgentSearchEnabled = settings.memoryAgentSearchEnabled !== false;
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
  settings.agentProfileEnabled = settings.agentProfileEnabled !== false;
  settings.agentProfileAutoCapture = settings.agentProfileAutoCapture !== false;
  settings.agentProfileMaxPromptTraits = normalizePositiveInteger(
    settings.agentProfileMaxPromptTraits,
    DEFAULT_SETTINGS.agentProfileMaxPromptTraits
  );
  settings.agentProfileMinEvidence = normalizePositiveInteger(
    settings.agentProfileMinEvidence,
    DEFAULT_SETTINGS.agentProfileMinEvidence
  );
  settings.agentProfileHalfLifeDays = normalizePositiveInteger(
    settings.agentProfileHalfLifeDays,
    DEFAULT_SETTINGS.agentProfileHalfLifeDays
  );
  settings.affectEnabled = settings.affectEnabled !== false;
  settings.affectCrossSessionEnabled = settings.affectCrossSessionEnabled !== false;
  settings.affectRestoreAfterRestart = settings.affectRestoreAfterRestart !== false;
  settings.affectShowIndicator = settings.affectShowIndicator !== false;
  settings.affectSensitivity = normalizeAffectSensitivity(
    settings.affectSensitivity,
    DEFAULT_SETTINGS.affectSensitivity
  );
  settings.affectHalfLifeMinutes = normalizePositiveInteger(
    settings.affectHalfLifeMinutes,
    DEFAULT_SETTINGS.affectHalfLifeMinutes
  );
  settings.affectHalfLifeMinutes = clampNumber(
    settings.affectHalfLifeMinutes,
    AFFECT_HALF_LIFE_MINUTES_MIN,
    AFFECT_HALF_LIFE_MINUTES_MAX
  );

  delete settings.command;
  delete settings.includeActiveNote;
  delete settings.activeNoteMaxChars;
  return settings;
}

function normalizePluginData(savedData) {
  if (savedData && savedData.schemaVersion >= 2) {
    return {
      schemaVersion: 2,
      settings: normalizeSettings(savedData.settings),
      chatState: normalizeChatState(savedData.chatState),
      affectState: normalizeAffectState(savedData.affectState)
    };
  }

  return {
    schemaVersion: 2,
    settings: normalizeSettings(savedData),
    chatState: normalizeChatState(null),
    affectState: normalizeAffectState(null)
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

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeString(value) {
  return typeof value === "string" ? value : "";
}

function truncateString(value, maxChars) {
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function normalizeCursorPermissionPolicy(value, fallback) {
  if (value === "allow-once" || value === "allow-always" || value === "reject-once") {
    return value;
  }
  return fallback;
}

function normalizeAffectSensitivity(value, fallback) {
  if (value === "low" || value === "normal" || value === "high") {
    return value;
  }
  return fallback;
}

module.exports = {
  AFFECT_HALF_LIFE_MINUTES_MAX,
  AFFECT_HALF_LIFE_MINUTES_MIN,
  ASSISTANT_DISPLAY_NAME_MAX_CHARS,
  ASSISTANT_STYLE_OPTIONS,
  CUSTOM_ASSISTANT_STYLE_MAX_CHARS,
  DEFAULT_SETTINGS,
  normalizePluginData,
  normalizeSettings
};
