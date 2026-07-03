const { PluginSettingTab, Setting } = require("obsidian");

const { AGENT_OPTIONS } = require("./agents/AgentRegistry");
const { DEFAULT_SETTINGS } = require("./settings");

class AgentDockSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Agent Dock" });

    new Setting(containerEl)
      .setName("Agent provider")
      .setDesc("Adapter used by the dock. More providers can be added without changing the UI.")
      .addDropdown((dropdown) => {
        for (const [id, option] of Object.entries(AGENT_OPTIONS)) {
          dropdown.addOption(id, option.label);
        }
        dropdown
          .setValue(this.plugin.settings.agentId)
          .onChange(async (value) => {
            this.plugin.settings.agentId = value;
            this.plugin.refreshAgent();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Codex executable path")
      .setDesc("Full path to the Codex CLI executable. GUI apps often cannot find shell commands by name.")
      .addText((text) => text
        .setPlaceholder("/opt/homebrew/bin/codex")
        .setValue(this.plugin.settings.codexPath)
        .onChange(async (value) => {
          this.plugin.settings.codexPath = value.trim() || DEFAULT_SETTINGS.codexPath;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Arguments")
      .setDesc("Use {{prompt}} where the prompt should be inserted.")
      .addText((text) => text
        .setPlaceholder("exec {{prompt}}")
        .setValue(this.plugin.settings.args)
        .onChange(async (value) => {
          this.plugin.settings.args = value.trim() || DEFAULT_SETTINGS.args;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Interactive arguments")
      .setDesc("Optional arguments used when opening the full agent TUI in Terminal.")
      .addText((text) => text
        .setPlaceholder("--sandbox workspace-write")
        .setValue(this.plugin.settings.interactiveArgs)
        .onChange(async (value) => {
          this.plugin.settings.interactiveArgs = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Working directory")
      .setDesc("Defaults to the vault folder.")
      .addText((text) => text
        .setPlaceholder("/path/to/project")
        .setValue(this.plugin.settings.workingDirectory)
        .onChange(async (value) => {
          this.plugin.settings.workingDirectory = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Include active note")
      .setDesc("Send the current note content along with your request.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.includeActiveNote)
        .onChange(async (value) => {
          this.plugin.settings.includeActiveNote = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Debug activity")
      .setDesc("Show streamed reasoning summaries, tool calls, command output, stderr, and raw events under each response.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.debugActivity)
        .onChange(async (value) => {
          this.plugin.settings.debugActivity = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Active note character limit")
      .setDesc("Prevents very large notes from overwhelming the command.")
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.activeNoteMaxChars))
        .setValue(String(this.plugin.settings.activeNoteMaxChars))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.activeNoteMaxChars = Number.isFinite(parsed) && parsed > 0
            ? parsed
            : DEFAULT_SETTINGS.activeNoteMaxChars;
          await this.plugin.saveSettings();
        }));
  }
}

module.exports = {
  AgentDockSettingTab
};
