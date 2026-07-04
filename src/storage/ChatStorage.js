const { normalizePath } = require("obsidian");
const { normalizeProviderState, serializeProviderState } = require("./providerState");

const CHAT_STATE_VERSION = 1;
const SESSION_DIR_NAME = "sessions";

class ChatStorage {
  constructor(plugin) {
    this.plugin = plugin;
    this.adapter = plugin.app.vault.adapter;
    const pluginDir = plugin.manifest.dir || `.obsidian/plugins/${plugin.manifest.id}`;
    this.baseDir = normalizePath(`${pluginDir}/${SESSION_DIR_NAME}`);
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

    await this.pruneSessionFiles(keepFileNames);

    this.plugin.chatState = {
      activeSessionId: limitedSessions.some((session) => session.id === sessionState.activeSessionId)
        ? sessionState.activeSessionId
        : limitedSessions[0]?.id || "",
      sessionIndex
    };
    await this.plugin.savePluginData();
  }

  async deleteSession(sessionId) {
    const path = this.getSessionPath(sessionId);
    try {
      if (await this.adapter.exists(path)) {
        await this.adapter.remove(path);
      }
    } catch (error) {
      console.warn(`Agent Dock could not delete persisted session ${sessionId}:`, error);
    }
  }

  async deleteAllSessions() {
    await this.pruneSessionFiles(new Set());
  }

  async loadSession(sessionId, indexEntry) {
    try {
      const raw = await this.adapter.read(this.getSessionPath(sessionId));
      return normalizePersistedSession(JSON.parse(raw), indexEntry);
    } catch (error) {
      console.warn(`Agent Dock could not load persisted session ${sessionId}:`, error);
      return normalizePersistedSession(indexEntry, indexEntry);
    }
  }

  async ensureSessionDir() {
    if (await this.adapter.exists(this.baseDir)) {
      return;
    }
    await this.adapter.mkdir(this.baseDir);
  }

  async pruneSessionFiles(keepFileNames) {
    let listing;
    try {
      if (!await this.adapter.exists(this.baseDir)) {
        return;
      }
      listing = await this.adapter.list(this.baseDir);
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
        await this.adapter.remove(filePath);
      } catch (error) {
        console.warn(`Agent Dock could not prune persisted session ${fileName}:`, error);
      }
    }
  }

  async writeJson(path, value) {
    await this.adapter.write(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  getSessionPath(sessionId) {
    return normalizePath(`${this.baseDir}/${safeFileName(sessionId)}.json`);
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
    createdAt: normalizeTimestamp(session.createdAt, now),
    updatedAt: normalizeTimestamp(session.updatedAt, now),
    messages,
    providerState: serializeProviderState(session.providerState)
  };
}

function serializeMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  const content = String(message.content || "");
  if (!content && message.role === "assistant") {
    return null;
  }

  return {
    role: message.role,
    content,
    createdAt: normalizeTimestamp(message.createdAt, Date.now())
  };
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
    createdAt: normalizeTimestamp(source.createdAt, indexEntry?.createdAt || Date.now()),
    updatedAt: normalizeTimestamp(source.updatedAt, indexEntry?.updatedAt || Date.now()),
    messages,
    providerState: normalizeProviderState(source.providerState)
  };
}

function normalizePersistedMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  const content = String(message.content || "");
  if (!content) {
    return null;
  }

  return {
    role: message.role,
    content,
    timeline: [{ kind: message.role === "assistant" ? "content" : "message", text: content }],
    createdAt: normalizeTimestamp(message.createdAt, Date.now()),
    isComplete: true,
    isLoading: false
  };
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
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function safeFileName(value) {
  return String(value || "session").replace(/[^A-Za-z0-9._-]/g, "_");
}

function normalizeTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

module.exports = {
  ChatStorage
};
