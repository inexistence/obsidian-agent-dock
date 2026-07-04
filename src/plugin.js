const { Notice, Plugin } = require("obsidian");

const { createAgent } = require("./agents/AgentRegistry");
const { VIEW_TYPE_AGENT_DOCK } = require("./constants");
const { t } = require("./i18n");
const { normalizePluginData } = require("./settings");
const { AgentDockSettingTab } = require("./settingsTab");
const { ChatStorage } = require("./storage/ChatStorage");
const { MemoryStore } = require("./storage/MemoryStore");
const { AgentDockView } = require("./view/AgentDockView");

module.exports = class AgentDockPlugin extends Plugin {
  async onload() {
    const pluginData = normalizePluginData(await this.loadData());
    this.settings = pluginData.settings;
    this.chatState = pluginData.chatState;
    this.chatSaveTimer = null;
    this.pendingChatSessionState = null;
    this.chatSaveInFlight = false;
    this.chatSaveRequested = false;
    this.chatSaveFailureNotified = false;
    this.chatStorage = new ChatStorage(this);
    this.memoryStore = new MemoryStore(this);
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
    this.addCommand({
      id: "open-interactive-agent",
      name: t(this.settings, "command.openInteractive"),
      callback: () => this.openInteractiveAgent()
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
      schemaVersion: 2,
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
    if (this.pendingChatSessionState) {
      await this.saveChatSessions(this.pendingChatSessionState);
    }
  }

  async saveChatSessions(sessionState) {
    if (!sessionState) {
      return;
    }

    this.pendingChatSessionState = sessionState;
    if (this.chatSaveInFlight) {
      this.chatSaveRequested = true;
      return;
    }

    this.chatSaveInFlight = true;
    try {
      do {
        this.chatSaveRequested = false;
        try {
          await this.chatStorage.saveSessions(this.pendingChatSessionState, this.settings);
          this.chatSaveFailureNotified = false;
        } catch (error) {
          console.warn("Agent Dock could not save chat history:", error);
          if (!this.chatSaveFailureNotified) {
            this.chatSaveFailureNotified = true;
            new Notice(t(this.settings, "notice.saveChatHistoryFailed"));
          }
          this.chatSaveRequested = false;
        }
      } while (this.chatSaveRequested);
    } finally {
      this.chatSaveInFlight = false;
    }
  }

  async deletePersistedSession(sessionId) {
    await this.chatStorage.deleteSession(sessionId);
  }

  async clearPersistedChatHistory() {
    await this.chatStorage.deleteAllSessions();
    this.chatState = {
      activeSessionId: "",
      sessionIndex: []
    };
    await this.savePluginData();
  }

  async clearMemory() {
    await this.memoryStore.clearMemory();
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

  async openInteractiveAgent() {
    return this.agent.openInteractive();
  }

  refreshOpenViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_DOCK)) {
      const view = leaf.view;
      if (view instanceof AgentDockView) {
        view.render();
      }
    }
  }
};
