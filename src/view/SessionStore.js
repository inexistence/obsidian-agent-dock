class SessionStore {
  constructor() {
    this.sessions = [];
    this.activeSessionId = "";
  }

  ensureActiveSession() {
    if (this.sessions.length === 0) {
      return this.createSession();
    }

    const existing = this.getActiveSession();
    if (existing) {
      return existing;
    }

    this.activeSessionId = this.sessions[0].id;
    return this.sessions[0];
  }

  createSession() {
    const now = Date.now();
    const session = {
      id: `session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: `Chat ${this.sessions.length + 1}`,
      isUntitled: true,
      currentRun: null,
      draft: "",
      createdAt: now,
      updatedAt: now,
      messages: []
    };
    this.sessions.push(session);
    this.activeSessionId = session.id;
    return session;
  }

  getActiveSession() {
    return this.sessions.find((session) => session.id === this.activeSessionId) || null;
  }

  getSession(sessionId) {
    return this.sessions.find((session) => session.id === sessionId) || null;
  }

  maybeNameSession(session, prompt) {
    if (!session.isUntitled) {
      return;
    }

    const compact = prompt.replace(/\s+/g, " ").trim();
    session.title = compact.length > 28 ? `${compact.slice(0, 28)}...` : compact || session.title;
    session.isUntitled = false;
    this.touchSession(session);
  }

  deleteSession(sessionId) {
    const deletedIndex = this.sessions.findIndex((entry) => entry.id === sessionId);
    if (deletedIndex === -1) {
      return false;
    }

    this.sessions.splice(deletedIndex, 1);

    if (this.sessions.length === 0) {
      this.createSession();
    } else if (this.activeSessionId === sessionId) {
      const nextIndex = Math.min(deletedIndex, this.sessions.length - 1);
      this.activeSessionId = this.sessions[nextIndex].id;
    }

    return true;
  }

  loadState(state) {
    const sessions = Array.isArray(state?.sessions) ? state.sessions : [];
    this.sessions = sessions.map(normalizeSession).filter(Boolean);
    this.activeSessionId = typeof state?.activeSessionId === "string" ? state.activeSessionId : "";
    this.ensureActiveSession();
  }

  toState() {
    return {
      activeSessionId: this.activeSessionId,
      sessions: this.sessions
    };
  }

  touchSession(session) {
    if (session) {
      session.updatedAt = Date.now();
    }
  }
}

function normalizeSession(session) {
  if (!session || typeof session !== "object" || typeof session.id !== "string" || !session.id) {
    return null;
  }

  return {
    id: session.id,
    title: typeof session.title === "string" && session.title ? session.title : "Chat",
    isUntitled: session.isUntitled === true,
    currentRun: null,
    draft: typeof session.draft === "string" ? session.draft : "",
    createdAt: normalizeTimestamp(session.createdAt),
    updatedAt: normalizeTimestamp(session.updatedAt),
    messages: Array.isArray(session.messages) ? session.messages.map(normalizeMessage).filter(Boolean) : []
  };
}

function normalizeMessage(message) {
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
    timeline: Array.isArray(message.timeline)
      ? message.timeline
      : [{ kind: message.role === "assistant" ? "content" : "message", text: content }],
    isLoading: false,
    isComplete: true,
    createdAt: normalizeTimestamp(message.createdAt)
  };
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

module.exports = {
  SessionStore
};
