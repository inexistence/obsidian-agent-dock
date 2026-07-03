const { Notice, PluginSettingTab, Setting } = require("obsidian");

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

    new Setting(containerEl)
      .setName("Context character limit")
      .setDesc("Maximum prompt size before older conversation history is compressed. Default is 258k characters.")
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.contextLimitChars))
        .setValue(String(this.plugin.settings.contextLimitChars))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.contextLimitChars = Number.isFinite(parsed) && parsed > 0
            ? parsed
            : DEFAULT_SETTINGS.contextLimitChars;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Persist chat history")
      .setDesc("Restore conversations after Obsidian restarts. Message bodies are stored as per-session JSON files in the plugin folder.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.persistChatHistory)
        .onChange(async (value) => {
          this.plugin.settings.persistChatHistory = value;
          if (!value) {
            await this.plugin.clearPersistedChatHistory();
            return;
          }
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Persisted session limit")
      .setDesc("Maximum number of recent conversations kept on disk.")
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.maxPersistedSessions))
        .setValue(String(this.plugin.settings.maxPersistedSessions))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.maxPersistedSessions = Number.isFinite(parsed) && parsed > 0
            ? parsed
            : DEFAULT_SETTINGS.maxPersistedSessions;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Persisted messages per session")
      .setDesc("Maximum number of recent messages kept for each conversation.")
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.maxPersistedMessagesPerSession))
        .setValue(String(this.plugin.settings.maxPersistedMessagesPerSession))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.maxPersistedMessagesPerSession = Number.isFinite(parsed) && parsed > 0
            ? parsed
            : DEFAULT_SETTINGS.maxPersistedMessagesPerSession;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl("h3", { text: "Memory" });

    new Setting(containerEl)
      .setName("Enable memory")
      .setDesc("Use local memories from previous chats when building prompts.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.memoryEnabled)
        .onChange(async (value) => {
          this.plugin.settings.memoryEnabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Automatic memory extraction")
      .setDesc("Automatically save concise local memories after successful agent replies.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.memoryAutoCapture)
        .onChange(async (value) => {
          this.plugin.settings.memoryAutoCapture = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Memory prompt character limit")
      .setDesc("Maximum characters of relevant memory added to a prompt.")
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.memoryMaxPromptChars))
        .setValue(String(this.plugin.settings.memoryMaxPromptChars))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.memoryMaxPromptChars = Number.isFinite(parsed) && parsed > 0
            ? parsed
            : DEFAULT_SETTINGS.memoryMaxPromptChars;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Memory item limit")
      .setDesc("Maximum number of automatic memories kept on disk.")
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.memoryMaxItems))
        .setValue(String(this.plugin.settings.memoryMaxItems))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.memoryMaxItems = Number.isFinite(parsed) && parsed > 0
            ? parsed
            : DEFAULT_SETTINGS.memoryMaxItems;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Clear memory")
      .setDesc("Delete all automatically saved local memories.")
      .addButton((button) => button
        .setButtonText("Clear")
        .setWarning()
        .onClick(async () => {
          if (!window.confirm("Clear all Agent Dock memories?")) {
            return;
          }
          await this.plugin.clearMemory();
          new Notice("Agent Dock memory cleared.");
        }));
  }
}

module.exports = {
  AgentDockSettingTab
};
