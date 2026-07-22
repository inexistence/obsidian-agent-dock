const { Notice, Plugin } = require("obsidian");

const { AGENT_OPTIONS, createAgent, diagnoseAgent } = require("./agents/AgentRegistry");
const { VIEW_TYPE_AGENT_DOCK } = require("./constants");
const { t } = require("./i18n");
const { normalizePluginData } = require("./settings");
const { AgentDockSettingTab } = require("./settingsTab");
const { ChatStorage } = require("./storage/ChatStorage");
const { ChatSaveCoordinator } = require("./storage/ChatSaveCoordinator");
const { AgentDockView } = require("./view/AgentDockView");
const {
  cleanupExpiredPastedImages,
  deletePastedImagePaths
} = require("./view/reference/ClipboardImageReference");

module.exports = class AgentDockPlugin extends Plugin {
  async onload() {
    const pluginData = normalizePluginData(await this.loadData());
    this.settings = pluginData.settings;
    this.chatState = pluginData.chatState;
    this.chatSaveTimer = null;
    this.pendingChatSessionState = null;
    this.chatSaveFailureNotified = false;
    this.chatStorage = new ChatStorage(this);
    this.chatSaveCoordinator = new ChatSaveCoordinator((state) => this.writeChatSessions(state));
    await this.cleanupPastedImageCache();
    this.refreshAgent();

    this.registerView(
      VIEW_TYPE_AGENT_DOCK,
      (leaf) => new AgentDockView(leaf, this)
    );

    this.addRibbonIcon("bot", t(this.settings, "command.openDock"), () => this.activateView());
    this.addCommand({
      id: "open-agent-dock",
      name: t(this.settings, "command.openDock"),
      callback: () => this.activateView()
    });
    this.addSettingTab(new AgentDockSettingTab(this.app, this));
  }

  async onunload() {
    await this.flushChatSessions();
    this.agent?.cancelAll?.();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_AGENT_DOCK);
  }

  refreshAgent() {
    this.agent?.cancelAll?.();
    this.agent = createAgent(this);
  }

  async saveSettings() {
    await this.savePluginData();
  }

  async savePluginData() {
    await this.saveData({
      schemaVersion: 3,
      settings: this.settings,
      chatState: this.chatState
    });
  }

  async loadChatSessions() {
    return this.chatStorage.loadSessions(this.chatState, this.settings);
  }

  scheduleSaveChatSessions(sessionState, delay = 750) {
    this.pendingChatSessionState = sessionState;
    if (this.chatSaveTimer) {
      window.clearTimeout(this.chatSaveTimer);
    }
    this.chatSaveTimer = window.setTimeout(() => {
      this.chatSaveTimer = null;
      this.saveChatSessions(this.pendingChatSessionState);
    }, delay);
  }

  async flushChatSessions() {
    if (this.chatSaveTimer) {
      window.clearTimeout(this.chatSaveTimer);
      this.chatSaveTimer = null;
    }
    await this.chatSaveCoordinator.flush(this.pendingChatSessionState);
  }

  async saveChatSessions(sessionState) {
    if (!sessionState) {
      return;
    }

    this.pendingChatSessionState = sessionState;
    return this.chatSaveCoordinator.request(sessionState);
  }

  async writeChatSessions(sessionState) {
    try {
      await this.chatStorage.saveSessions(sessionState, this.settings);
      this.chatSaveFailureNotified = false;
    } catch (error) {
      console.warn("Agent Dock could not save chat history:", error);
      if (!this.chatSaveFailureNotified) {
        this.chatSaveFailureNotified = true;
        new Notice(t(this.settings, "notice.saveChatHistoryFailed"));
      }
    }
  }

  async deletePersistedSession(sessionId) {
    await this.chatStorage.deleteSession(sessionId);
  }

  async cleanupPastedImageCache() {
    try {
      await cleanupExpiredPastedImages(this.app);
    } catch (error) {
      console.warn("Agent Dock could not clean pasted image cache:", error);
    }
  }

  async deletePastedImageCacheFiles(paths) {
    try {
      await deletePastedImagePaths(this.app, paths);
    } catch (error) {
      console.warn("Agent Dock could not delete pasted image cache files:", error);
    }
  }

  async clearPersistedChatHistory() {
    await this.chatStorage.deleteAllSessions();
    this.chatState = {
      activeSessionId: "",
      sessionIndex: []
    };
    await this.savePluginData();
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_DOCK);
    let leaf = leaves[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_AGENT_DOCK, active: true });
    }

    this.app.workspace.revealLeaf(leaf);
  }

  async runAgent(prompt, onUpdate, conversation, options) {
    return this.agent.run(prompt, onUpdate, conversation, options);
  }

  async diagnoseAgent(agentId = this.settings.agentId) {
    return diagnoseAgent(this, agentId);
  }

  async testAgentConnection() {
    const previousMode = this.settings.mode;
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 20000);
    this.settings.mode = "readOnly";
    try {
      const output = await this.agent.run(
        "Connection test only. Do not inspect or modify files. Reply with exactly: Agent Dock ready.",
        () => {},
        [],
        { signal: abortController.signal }
      );
      return {
        ok: /agent dock ready/i.test(String(output || "")),
        message: String(output || "").trim() || "No response."
      };
    } catch (error) {
      return {
        ok: false,
        message: error.name === "AbortError"
          ? "Connection test timed out. Check authentication, ACP health, and local permissions."
          : error.message || String(error)
      };
    } finally {
      window.clearTimeout(timeoutId);
      this.settings.mode = previousMode;
    }
  }

  async switchAgentProvider(agentId, options = {}) {
    if (!AGENT_OPTIONS[agentId] || agentId === this.settings.agentId) {
      return { changed: false };
    }

    const views = this.getOpenAgentDockViews();
    if (views.some((view) => view.hasRunningSession())) {
      return {
        changed: false,
        blocked: true,
        agentLabel: this.agent.label
      };
    }

    const fromAgent = this.agent.label;
    this.settings.agentId = agentId;
    this.refreshAgent();
    await this.saveSettings();
    const toAgent = this.agent.label;

    const sourceView = views.includes(options.sourceView)
      ? options.sourceView
      : views[0] || null;
    if (sourceView) {
      await sourceView.recordProviderSwitch(fromAgent, toAgent);
    }
    this.refreshOpenViews({ exceptView: sourceView });
    return { changed: true, fromAgent, toAgent };
  }

  getOpenAgentDockViews() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_DOCK)
      .map((leaf) => leaf.view)
      .filter((view) => view instanceof AgentDockView);
  }

  refreshOpenViews(options = {}) {
    for (const view of this.getOpenAgentDockViews()) {
      if (view === options.exceptView) {
        continue;
      }
      view.render();
    }
  }
};
