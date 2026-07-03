const { Notice, PluginSettingTab, Setting } = require("obsidian");

const { AGENT_OPTIONS } = require("./agents/AgentRegistry");
const { LANGUAGE_OPTIONS, t } = require("./i18n");
const {
  ASSISTANT_STYLE_OPTIONS,
  CUSTOM_ASSISTANT_STYLE_MAX_CHARS,
  DEFAULT_SETTINGS
} = require("./settings");

class AgentDockSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const translate = (key, params) => t(this.plugin.settings, key, params);
    containerEl.empty();
    containerEl.createEl("h2", { text: translate("settings.heading") });

    new Setting(containerEl)
      .setName(translate("settings.language.name"))
      .setDesc(translate("settings.language.desc"))
      .addDropdown((dropdown) => {
        for (const [id, option] of Object.entries(LANGUAGE_OPTIONS)) {
          dropdown.addOption(id, option.label);
        }
        dropdown
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName(translate("settings.agentProvider.name"))
      .setDesc(translate("settings.agentProvider.desc"))
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
      .setName(translate("settings.codexPath.name"))
      .setDesc(translate("settings.codexPath.desc"))
      .addText((text) => text
        .setPlaceholder("/opt/homebrew/bin/codex")
        .setValue(this.plugin.settings.codexPath)
        .onChange(async (value) => {
          this.plugin.settings.codexPath = value.trim() || DEFAULT_SETTINGS.codexPath;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.args.name"))
      .setDesc(translate("settings.args.desc"))
      .addText((text) => text
        .setPlaceholder("exec {{prompt}}")
        .setValue(this.plugin.settings.args)
        .onChange(async (value) => {
          this.plugin.settings.args = value.trim() || DEFAULT_SETTINGS.args;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.interactiveArgs.name"))
      .setDesc(translate("settings.interactiveArgs.desc"))
      .addText((text) => text
        .setPlaceholder("--sandbox workspace-write")
        .setValue(this.plugin.settings.interactiveArgs)
        .onChange(async (value) => {
          this.plugin.settings.interactiveArgs = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.workingDirectory.name"))
      .setDesc(translate("settings.workingDirectory.desc"))
      .addText((text) => text
        .setPlaceholder("/path/to/project")
        .setValue(this.plugin.settings.workingDirectory)
        .onChange(async (value) => {
          this.plugin.settings.workingDirectory = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.assistantStyle.name"))
      .setDesc(formatAssistantStyleDescription(this.plugin.settings.assistantStyle, translate))
      .addDropdown((dropdown) => {
        for (const [id, option] of Object.entries(ASSISTANT_STYLE_OPTIONS)) {
          dropdown.addOption(id, translate(`assistantStyle.${id}.label`));
        }
        dropdown
          .setValue(this.plugin.settings.assistantStyle)
          .onChange(async (value) => {
            this.plugin.settings.assistantStyle = ASSISTANT_STYLE_OPTIONS[value]
              ? value
              : DEFAULT_SETTINGS.assistantStyle;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.assistantStyle === "custom") {
      new Setting(containerEl)
        .setName(translate("settings.customAssistantStyle.name"))
        .setDesc(translate("settings.customAssistantStyle.desc", { max: CUSTOM_ASSISTANT_STYLE_MAX_CHARS }))
        .addTextArea((text) => {
          text
            .setPlaceholder(translate("settings.customAssistantStyle.placeholder"))
            .setValue(this.plugin.settings.customAssistantStyle)
            .onChange(async (value) => {
              this.plugin.settings.customAssistantStyle = value
                .trim()
                .slice(0, CUSTOM_ASSISTANT_STYLE_MAX_CHARS);
              await this.plugin.saveSettings();
            });
          text.inputEl.rows = 5;
          text.inputEl.addClass("agent-dock-settings-textarea");
        });
    }

    new Setting(containerEl)
      .setName(translate("settings.includeActiveNote.name"))
      .setDesc(translate("settings.includeActiveNote.desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.includeActiveNote)
        .onChange(async (value) => {
          this.plugin.settings.includeActiveNote = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.debugActivity.name"))
      .setDesc(translate("settings.debugActivity.desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.debugActivity)
        .onChange(async (value) => {
          this.plugin.settings.debugActivity = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.activeNoteMaxChars.name"))
      .setDesc(translate("settings.activeNoteMaxChars.desc"))
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
      .setName(translate("settings.contextLimitChars.name"))
      .setDesc(translate("settings.contextLimitChars.desc"))
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
      .setName(translate("settings.persistChatHistory.name"))
      .setDesc(translate("settings.persistChatHistory.desc"))
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
      .setName(translate("settings.maxPersistedSessions.name"))
      .setDesc(translate("settings.maxPersistedSessions.desc"))
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
      .setName(translate("settings.maxPersistedMessagesPerSession.name"))
      .setDesc(translate("settings.maxPersistedMessagesPerSession.desc"))
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

    containerEl.createEl("h3", { text: translate("settings.memory.heading") });

    new Setting(containerEl)
      .setName(translate("settings.memoryEnabled.name"))
      .setDesc(translate("settings.memoryEnabled.desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.memoryEnabled)
        .onChange(async (value) => {
          this.plugin.settings.memoryEnabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.memoryAutoCapture.name"))
      .setDesc(translate("settings.memoryAutoCapture.desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.memoryAutoCapture)
        .onChange(async (value) => {
          this.plugin.settings.memoryAutoCapture = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.memoryMaxPromptChars.name"))
      .setDesc(translate("settings.memoryMaxPromptChars.desc"))
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
      .setName(translate("settings.memoryMaxItems.name"))
      .setDesc(translate("settings.memoryMaxItems.desc"))
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
      .setName(translate("settings.clearMemory.name"))
      .setDesc(translate("settings.clearMemory.desc"))
      .addButton((button) => button
        .setButtonText(translate("settings.clearMemory.button"))
        .setWarning()
        .onClick(async () => {
          if (!window.confirm(translate("settings.clearMemory.confirm"))) {
            return;
          }
          await this.plugin.clearMemory();
          new Notice(translate("settings.clearMemory.done"));
        }));
  }
}

function formatAssistantStyleDescription(style, translate) {
  const styleKey = ASSISTANT_STYLE_OPTIONS[style] ? style : DEFAULT_SETTINGS.assistantStyle;
  const description = translate(`assistantStyle.${styleKey}.description`);
  return translate("settings.assistantStyle.desc", { description });
}

module.exports = {
  AgentDockSettingTab
};
