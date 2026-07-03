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
    const session = {
      id: `session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: `Chat ${this.sessions.length + 1}`,
      isUntitled: true,
      currentRun: null,
      draft: "",
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
}

module.exports = {
  SessionStore
};
