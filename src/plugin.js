const { Plugin } = require("obsidian");

const { createAgent } = require("./agents/AgentRegistry");
const { VIEW_TYPE_AGENT_DOCK } = require("./constants");
const { normalizeSettings } = require("./settings");
const { AgentDockSettingTab } = require("./settingsTab");
const { AgentDockView } = require("./view/AgentDockView");

module.exports = class AgentDockPlugin extends Plugin {
  async onload() {
    this.settings = normalizeSettings(await this.loadData());
    this.refreshAgent();

    this.registerView(
      VIEW_TYPE_AGENT_DOCK,
      (leaf) => new AgentDockView(leaf, this)
    );

    this.addRibbonIcon("bot", "Open Agent Dock", () => this.activateView());
    this.addCommand({
      id: "open-agent-dock",
      name: "Open Agent Dock",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "open-interactive-agent",
      name: "Open interactive agent in Terminal",
      callback: () => this.openInteractiveAgent()
    });

    this.addSettingTab(new AgentDockSettingTab(this.app, this));
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_AGENT_DOCK);
  }

  refreshAgent() {
    this.agent = createAgent(this);
  }

  async saveSettings() {
    await this.saveData(this.settings);
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

  async runAgent(prompt, onUpdate, conversation) {
    return this.agent.run(prompt, onUpdate, conversation);
  }

  async openInteractiveAgent() {
    return this.agent.openInteractive();
  }
};
