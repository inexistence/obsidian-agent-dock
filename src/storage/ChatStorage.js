const { normalizePath } = require("obsidian");
const { normalizeProviderState, serializeProviderState } = require("./providerState");
const { redactSensitiveText } = require("./sensitiveText");
const { ensureLocalDataPath, getLegacyPluginPath, getLocalDataPath } = require("./localDataPath");
const { writeJsonAtomically } = require("./atomicJson");

const CHAT_STATE_VERSION = 2;
const SESSION_DIR_NAME = "sessions";
const PERSISTED_TIMELINE_KINDS = new Set(["message", "content", "reasoning", "tool", "error", "notice", "activity"]);
const PERSISTED_TIMELINE_STRING_FIELDS = ["text", "title", "summary", "detail", "toolCallId", "toolType", "noticeType"];
const PERSISTED_TIMELINE_TEXT_LIMITS = {
  title: 300,
  summary: 1000,
  detail: 12000,
  toolCallId: 200,
  toolType: 80,
  noticeType: 80
};
const TRUNCATED_TEXT_MARKER = "\n\n[Persisted timeline detail truncated]";

class ChatStorage {
  constructor(plugin) {
    this.plugin = plugin;
    this.adapter = plugin.app.vault.adapter;
    this.baseDir = getLocalDataPath(plugin, SESSION_DIR_NAME);
    this.legacyBaseDir = getLegacyPluginPath(plugin, SESSION_DIR_NAME);
  }

  async loadSessions(chatState, settings) {
    if (!settings.persistChatHistory) {
      return {
        activeSessionId: "",
        sessions: []
      };
    }

    const sessions = [];
    for (const entry of chatState.sessionIndex || []) {
      const session = await this.loadSession(entry.id, entry);
      if (session) {
        sessions.push(session);
      }
    }

    return {
      activeSessionId: chatState.activeSessionId,
      sessions
    };
  }

  async saveSessions(sessionState, settings) {
    if (!settings.persistChatHistory) {
      await this.deleteAllSessions();
      this.plugin.chatState = {
        activeSessionId: "",
        sessionIndex: []
      };
      await this.plugin.savePluginData();
      return;
    }

    await this.ensureSessionDir();
    const limitedSessions = limitSessions(sessionState.sessions, settings);
    const sessionIndex = [];
    const keepFileNames = new Set(limitedSessions.map((session) => `${safeFileName(session.id)}.json`));

    for (const session of limitedSessions) {
      const persistedSession = serializeSession(session, settings);
      sessionIndex.push(toSessionIndexEntry(persistedSession));
      await this.writeJson(this.getSessionPath(session.id), persistedSession);
    }

    this.plugin.chatState = {
      activeSessionId: limitedSessions.some((session) => session.id === sessionState.activeSessionId)
        ? sessionState.activeSessionId
        : limitedSessions[0]?.id || "",
      sessionIndex
    };
    await this.plugin.savePluginData();
    await this.pruneSessionFiles(keepFileNames);
  }

  async deleteSession(sessionId) {
    const paths = [
      this.getSessionPath(sessionId),
      this.getLegacySessionPath(sessionId)
    ];
    for (const path of paths) {
      try {
        if (await this.adapter.exists(path)) {
          await this.adapter.remove(path);
        }
      } catch (error) {
        console.warn(`Agent Dock could not delete persisted session ${sessionId}:`, error);
      }
    }
  }

  async deleteAllSessions() {
    await this.pruneSessionFiles(new Set());
    await this.pruneSessionFiles(new Set(), this.legacyBaseDir);
  }

  async loadSession(sessionId, indexEntry) {
    try {
      const raw = await this.readSessionFile(sessionId);
      return normalizePersistedSession(JSON.parse(raw), indexEntry);
    } catch (error) {
      console.warn(`Agent Dock could not load persisted session ${sessionId}:`, error);
      return normalizePersistedSession(indexEntry, indexEntry);
    }
  }

  async ensureSessionDir() {
    await ensureLocalDataPath(this.plugin, this.adapter, this.baseDir);
  }

  async pruneSessionFiles(keepFileNames, baseDir = this.baseDir) {
    let listing;
    try {
      if (!await this.adapter.exists(baseDir)) {
        return;
      }
      listing = await this.adapter.list(baseDir);
    } catch (error) {
      console.warn("Agent Dock could not list persisted sessions:", error);
      return;
    }

    for (const filePath of listing.files || []) {
      const fileName = filePath.split("/").pop() || "";
      if (!fileName.endsWith(".json")) {
        continue;
      }
      if (keepFileNames.has(fileName)) {
        continue;
      }
      try {
        await this.deletePastedImageCacheForSessionFile(filePath);
        await this.adapter.remove(filePath);
      } catch (error) {
        console.warn(`Agent Dock could not prune persisted session ${fileName}:`, error);
      }
    }
  }

  async deletePastedImageCacheForSessionFile(filePath) {
    if (typeof this.plugin.deletePastedImageCacheFiles !== "function") {
      return;
    }

    try {
      const raw = await this.adapter.read(filePath);
      const session = JSON.parse(raw);
      await this.plugin.deletePastedImageCacheFiles(normalizePastedImagePaths(session?.pastedImagePaths));
    } catch (error) {
      console.warn(`Agent Dock could not clean pasted image cache for ${filePath}:`, error);
    }
  }

  async writeJson(path, value) {
    await writeJsonAtomically(this.adapter, path, value);
  }

  getSessionPath(sessionId) {
    return normalizePath(`${this.baseDir}/${safeFileName(sessionId)}.json`);
  }

  getLegacySessionPath(sessionId) {
    return normalizePath(`${this.legacyBaseDir}/${safeFileName(sessionId)}.json`);
  }

  async readSessionFile(sessionId) {
    const path = this.getSessionPath(sessionId);
    if (await this.adapter.exists(path)) {
      return this.adapter.read(path);
    }
    return this.adapter.read(this.getLegacySessionPath(sessionId));
  }
}

function serializeSession(session, settings) {
  const now = Date.now();
  const messages = Array.isArray(session.messages)
    ? session.messages
      .map(serializeMessage)
      .filter(Boolean)
      .slice(-settings.maxPersistedMessagesPerSession)
    : [];

  return {
    version: CHAT_STATE_VERSION,
    id: session.id,
    title: session.title || "Chat",
    isUntitled: session.isUntitled === true,
    draft: String(session.draft || ""),
    hasUnreadCompletion: session.hasUnreadCompletion === true,
    unreadTurnStatus: normalizeUnreadTurnStatus(session.unreadTurnStatus, session.hasUnreadCompletion),
    createdAt: normalizeTimestamp(session.createdAt, now),
    updatedAt: normalizeTimestamp(session.updatedAt, now),
    messages,
    providerState: serializeProviderState(session.providerState),
    pastedImagePaths: normalizePastedImagePaths(session.pastedImagePaths)
  };
}

function serializeMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }
  if (!isPersistableMessageRole(message.role)) {
    return null;
  }

  const content = String(message.content || "");
  if (!content && message.role === "assistant") {
    return null;
  }

  const serialized = {
    id: normalizeMessageId(message.id, message.role, message.createdAt),
    role: message.role,
    content,
    createdAt: normalizeTimestamp(message.createdAt, Date.now())
  };
  if (message.role === "assistant") {
    const timeline = serializeTimeline(message.timeline, message.role, content);
    if (timeline.length > 0) {
      serialized.timeline = timeline;
    }
    if (message.agentLabel) {
      serialized.agentLabel = String(message.agentLabel);
    }
    if (message.agentId) {
      serialized.agentId = String(message.agentId);
    }
  }
  if (message.role === "system") {
    serialized.kind = String(message.kind || "notice");
    if (message.providerSwitch && typeof message.providerSwitch === "object") {
      serialized.providerSwitch = {
        from: String(message.providerSwitch.from || ""),
        to: String(message.providerSwitch.to || "")
      };
    }
  }
  return serialized;
}

function normalizePersistedSession(rawSession, indexEntry) {
  const source = rawSession && typeof rawSession === "object" ? rawSession : {};
  const id = typeof source.id === "string" && source.id
    ? source.id
    : indexEntry?.id || "";

  if (!id) {
    return null;
  }

  const messages = Array.isArray(source.messages)
    ? source.messages.map(normalizePersistedMessage).filter(Boolean)
    : [];

  return {
    id,
    title: typeof source.title === "string" && source.title ? source.title : indexEntry?.title || "Chat",
    isUntitled: source.isUntitled === true || indexEntry?.isUntitled === true,
    currentRun: null,
    draft: typeof source.draft === "string" ? source.draft : "",
    hasUnreadCompletion: source.hasUnreadCompletion === true || indexEntry?.hasUnreadCompletion === true,
    unreadTurnStatus: normalizeUnreadTurnStatus(source.unreadTurnStatus || indexEntry?.unreadTurnStatus, source.hasUnreadCompletion || indexEntry?.hasUnreadCompletion),
    createdAt: normalizeTimestamp(source.createdAt, indexEntry?.createdAt || Date.now()),
    updatedAt: normalizeTimestamp(source.updatedAt, indexEntry?.updatedAt || Date.now()),
    messages,
    providerState: normalizeProviderState(source.providerState),
    pastedImagePaths: normalizePastedImagePaths(source.pastedImagePaths)
  };
}

function normalizePersistedMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }
  if (!isPersistableMessageRole(message.role)) {
    return null;
  }

  const content = String(message.content || "");
  if (!content) {
    return null;
  }

  const normalized = {
    id: normalizeMessageId(message.id, message.role, message.createdAt),
    role: message.role,
    content,
    timeline: normalizePersistedTimeline(message.timeline, message.role, content),
    createdAt: normalizeTimestamp(message.createdAt, Date.now()),
    isComplete: true,
    isLoading: false
  };
  if (message.role === "assistant") {
    normalized.agentLabel = typeof message.agentLabel === "string" ? message.agentLabel : "";
    normalized.agentId = typeof message.agentId === "string" ? message.agentId : "";
  }
  if (message.role === "system") {
    normalized.kind = typeof message.kind === "string" ? message.kind : "notice";
    if (message.providerSwitch && typeof message.providerSwitch === "object") {
      normalized.providerSwitch = {
        from: String(message.providerSwitch.from || ""),
        to: String(message.providerSwitch.to || "")
      };
    }
  }
  return normalized;
}

function normalizeMessageId(value, role, createdAt) {
  if (typeof value === "string" && value) {
    return value;
  }
  const timestamp = normalizeTimestamp(createdAt, Date.now()).toString(36);
  const content = `${role || "message"}:${timestamp}`;
  return `msg-legacy-${Buffer.from(content).toString("base64").replace(/[^a-z0-9]/gi, "").slice(0, 18)}`;
}

function isPersistableMessageRole(role) {
  return role === "user" || role === "assistant" || role === "system";
}

function getRestoredTimeline(role, content) {
  if (role === "assistant") {
    return [{ kind: "content", text: content }];
  }
  if (role === "user") {
    return [{ kind: "message", text: content }];
  }
  return [];
}

function serializeTimeline(timeline, role, content) {
  return normalizePersistedTimeline(timeline, role, content);
}

function normalizePersistedTimeline(timeline, role, content) {
  const normalized = Array.isArray(timeline)
    ? timeline.map(normalizeTimelineEntry).filter(Boolean)
    : [];

  if (role === "assistant") {
    if (normalized.some((entry) => entry.kind === "content")) {
      return normalized;
    }
    return content ? [{ kind: "content", text: content }] : normalized;
  }

  if (role === "user") {
    return normalized.length > 0 ? normalized : getRestoredTimeline(role, content);
  }

  return [];
}

function normalizeTimelineEntry(entry) {
  if (!entry || typeof entry !== "object" || !PERSISTED_TIMELINE_KINDS.has(entry.kind)) {
    return null;
  }
  if (entry.persist === false) {
    return null;
  }

  const normalized = { kind: entry.kind };
  for (const field of PERSISTED_TIMELINE_STRING_FIELDS) {
    if (entry[field] !== undefined && entry[field] !== null) {
      normalized[field] = normalizeTimelineStringField(field, entry[field]);
    }
  }
  if (Array.isArray(entry.paths)) {
    normalized.paths = [...new Set(entry.paths.map((path) => String(path || "").trim()).filter(Boolean))].slice(0, 20);
  }
  if (entry.kind === "reasoning" && entry.discrete !== undefined) {
    normalized.discrete = entry.discrete === true;
  }

  if ((entry.kind === "message" || entry.kind === "content") && !normalized.text) {
    return null;
  }

  return normalized;
}

function normalizeTimelineStringField(field, value) {
  const text = String(value);
  if (field === "text") {
    return text;
  }

  return truncatePersistedTimelineText(redactSensitiveText(text), PERSISTED_TIMELINE_TEXT_LIMITS[field]);
}

function truncatePersistedTimelineText(text, limit) {
  const normalized = String(text || "");
  const maxLength = Number(limit);
  if (!Number.isFinite(maxLength) || maxLength <= 0 || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}${TRUNCATED_TEXT_MARKER}`;
}

function limitSessions(sessions, settings) {
  return [...sessions]
    .sort((left, right) => normalizeTimestamp(right.updatedAt, 0) - normalizeTimestamp(left.updatedAt, 0))
    .slice(0, settings.maxPersistedSessions)
    .reverse();
}

function toSessionIndexEntry(session) {
  return {
    id: session.id,
    title: session.title,
    isUntitled: session.isUntitled,
    hasUnreadCompletion: session.hasUnreadCompletion === true,
    unreadTurnStatus: normalizeUnreadTurnStatus(session.unreadTurnStatus, session.hasUnreadCompletion),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function normalizeUnreadTurnStatus(status, hasUnreadCompletion) {
  if (status === "success" || status === "failed" || status === "stopped") {
    return status;
  }
  return hasUnreadCompletion === true ? "success" : "";
}

function safeFileName(value) {
  return String(value || "session").replace(/[^A-Za-z0-9._-]/g, "_");
}

function normalizeTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function normalizePastedImagePaths(paths) {
  if (!Array.isArray(paths)) {
    return [];
  }
  const seen = new Set();
  return paths
    .map((path) => String(path || "").trim())
    .filter(Boolean)
    .filter((path) => {
      if (seen.has(path)) {
        return false;
      }
      seen.add(path);
      return true;
    });
}

module.exports = {
  ChatStorage
};
