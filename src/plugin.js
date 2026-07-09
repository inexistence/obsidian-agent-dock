const { Notice, Plugin } = require("obsidian");

const { AGENT_OPTIONS, createAgent } = require("./agents/AgentRegistry");
const {
  getEffectiveWorkingAffect,
  getPromptWorkingAffect,
  normalizeAffectState,
  resetAffectState,
  updateWorkingAffect
} = require("./affect/WorkingAffectStore");
const { DeepMemoryStore } = require("./deepMemory/DeepMemoryStore");
const { VIEW_TYPE_AGENT_DOCK } = require("./constants");
const { t } = require("./i18n");
const { InteractionMemoryStore } = require("./interaction/InteractionMemoryStore");
const { normalizePluginData } = require("./settings");
const { AgentDockSettingTab } = require("./settingsTab");
const { ChatStorage } = require("./storage/ChatStorage");
const { MemoryStore } = require("./storage/MemoryStore");
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
    this.affectState = this.settings.affectRestoreAfterRestart
      ? pluginData.affectState
      : resetAffectState(this.settings);
    this.chatSaveTimer = null;
    this.pendingChatSessionState = null;
    this.chatSaveInFlight = false;
    this.chatSaveRequested = false;
    this.chatSaveFailureNotified = false;
    this.chatStorage = new ChatStorage(this);
    this.memoryStore = new MemoryStore(this);
    this.interactionMemoryStore = new InteractionMemoryStore(this);
    this.deepMemoryStore = new DeepMemoryStore(this);
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
      chatState: this.chatState,
      affectState: normalizeAffectState(this.affectState)
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

  async clearMemory() {
    await this.memoryStore.clearMemory();
  }

  async clearInteractionMemory() {
    await this.interactionMemoryStore.clearMemory();
  }

  async clearDeepMemory() {
    await this.deepMemoryStore.clearMemory();
  }

  getWorkingAffect() {
    return getEffectiveWorkingAffect(this.settings, this.affectState);
  }

  getPromptWorkingAffect(prompt) {
    return getPromptWorkingAffect(this.settings, this.affectState, prompt);
  }

  async updateWorkingAffect(turn) {
    this.affectState = updateWorkingAffect(this.affectState, this.settings, turn);
    await this.savePluginData();
  }

  async resetWorkingAffect() {
    this.affectState = resetAffectState(this.settings);
    await this.savePluginData();
    this.refreshOpenViews();
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
