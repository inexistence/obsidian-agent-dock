const { Notice, PluginSettingTab, Setting } = require("obsidian");

const { AGENT_OPTIONS } = require("./agents/AgentRegistry");
const { LANGUAGE_OPTIONS, t } = require("./i18n");
const {
  AFFECT_HALF_LIFE_MINUTES_MAX,
  AFFECT_HALF_LIFE_MINUTES_MIN,
  ASSISTANT_DISPLAY_NAME_MAX_CHARS,
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
            const result = await this.plugin.switchAgentProvider(value);
            if (result.blocked) {
              new Notice(translate("notice.agentStillWorking", { agent: result.agentLabel }));
            }
            this.display();
          });
      });

    if (this.plugin.settings.agentId === "codex") {
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
    }

    if (this.plugin.settings.agentId === "cursor") {
      new Setting(containerEl)
        .setName(translate("settings.cursorPath.name"))
        .setDesc(translate("settings.cursorPath.desc"))
        .addText((text) => text
          .setPlaceholder("~/.local/bin/agent")
          .setValue(this.plugin.settings.cursorPath)
          .onChange(async (value) => {
            this.plugin.settings.cursorPath = value.trim() || DEFAULT_SETTINGS.cursorPath;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName(translate("settings.cursorExtraArgs.name"))
        .setDesc(translate("settings.cursorExtraArgs.desc"))
        .addText((text) => text
          .setPlaceholder("--api-key $CURSOR_API_KEY")
          .setValue(this.plugin.settings.cursorExtraArgs)
          .onChange(async (value) => {
            this.plugin.settings.cursorExtraArgs = value.trim();
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName(translate("settings.cursorInteractiveArgs.name"))
        .setDesc(translate("settings.cursorInteractiveArgs.desc"))
        .addText((text) => text
          .setPlaceholder("")
          .setValue(this.plugin.settings.cursorInteractiveArgs)
          .onChange(async (value) => {
            this.plugin.settings.cursorInteractiveArgs = value.trim();
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName(translate("settings.cursorPermissionPolicy.name"))
        .setDesc(translate("settings.cursorPermissionPolicy.desc"))
        .addDropdown((dropdown) => {
          dropdown
            .addOption("allow-once", translate("settings.cursorPermissionPolicy.allowOnce"))
            .addOption("allow-always", translate("settings.cursorPermissionPolicy.allowAlways"))
            .addOption("reject-once", translate("settings.cursorPermissionPolicy.rejectOnce"))
            .setValue(this.plugin.settings.cursorPermissionPolicy)
            .onChange(async (value) => {
              this.plugin.settings.cursorPermissionPolicy = value || DEFAULT_SETTINGS.cursorPermissionPolicy;
              await this.plugin.saveSettings();
            });
        });
    }

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
      .setName(translate("settings.assistantDisplayName.name"))
      .setDesc(translate("settings.assistantDisplayName.desc"))
      .addText((text) => text
        .setPlaceholder(translate("view.aiAssistant"))
        .setValue(this.plugin.settings.assistantDisplayName)
        .onChange(async (value) => {
          this.plugin.settings.assistantDisplayName = value
            .trim()
            .slice(0, ASSISTANT_DISPLAY_NAME_MAX_CHARS);
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
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
      .setName(translate("settings.debugActivity.name"))
      .setDesc(translate("settings.debugActivity.desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.debugActivity)
        .onChange(async (value) => {
          this.plugin.settings.debugActivity = value;
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

    containerEl.createEl("h3", { text: translate("settings.affect.heading") });

    new Setting(containerEl)
      .setName(translate("settings.affectEnabled.name"))
      .setDesc(translate("settings.affectEnabled.desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.affectEnabled)
        .onChange(async (value) => {
          this.plugin.settings.affectEnabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.affectCrossSessionEnabled.name"))
      .setDesc(translate("settings.affectCrossSessionEnabled.desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.affectCrossSessionEnabled)
        .onChange(async (value) => {
          this.plugin.settings.affectCrossSessionEnabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.affectRestoreAfterRestart.name"))
      .setDesc(translate("settings.affectRestoreAfterRestart.desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.affectRestoreAfterRestart)
        .onChange(async (value) => {
          this.plugin.settings.affectRestoreAfterRestart = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.affectShowIndicator.name"))
      .setDesc(translate("settings.affectShowIndicator.desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.affectShowIndicator)
        .onChange(async (value) => {
          this.plugin.settings.affectShowIndicator = value;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
        }));

    new Setting(containerEl)
      .setName(translate("settings.affectSensitivity.name"))
      .setDesc(translate("settings.affectSensitivity.desc"))
      .addDropdown((dropdown) => dropdown
        .addOption("low", translate("settings.affectSensitivity.low"))
        .addOption("normal", translate("settings.affectSensitivity.normal"))
        .addOption("high", translate("settings.affectSensitivity.high"))
        .setValue(this.plugin.settings.affectSensitivity)
        .onChange(async (value) => {
          this.plugin.settings.affectSensitivity = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.affectHalfLifeMinutes.name"))
      .setDesc(translate("settings.affectHalfLifeMinutes.desc"))
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.affectHalfLifeMinutes))
        .setValue(String(this.plugin.settings.affectHalfLifeMinutes))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.affectHalfLifeMinutes = Number.isFinite(parsed) && parsed > 0
            ? Math.min(AFFECT_HALF_LIFE_MINUTES_MAX, Math.max(AFFECT_HALF_LIFE_MINUTES_MIN, parsed))
            : DEFAULT_SETTINGS.affectHalfLifeMinutes;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.resetAffect.name"))
      .setDesc(translate("settings.resetAffect.desc"))
      .addButton((button) => button
        .setButtonText(translate("settings.resetAffect.button"))
        .onClick(async () => {
          await this.plugin.resetWorkingAffect();
          new Notice(translate("settings.resetAffect.done"));
        }));

    containerEl.createEl("h3", { text: translate("settings.agentProfile.heading") });

    new Setting(containerEl)
      .setName(translate("settings.agentProfileEnabled.name"))
      .setDesc(translate("settings.agentProfileEnabled.desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.agentProfileEnabled)
        .onChange(async (value) => {
          this.plugin.settings.agentProfileEnabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.agentProfileAutoCapture.name"))
      .setDesc(translate("settings.agentProfileAutoCapture.desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.agentProfileAutoCapture)
        .onChange(async (value) => {
          this.plugin.settings.agentProfileAutoCapture = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.agentProfileMaxPromptTraits.name"))
      .setDesc(translate("settings.agentProfileMaxPromptTraits.desc"))
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.agentProfileMaxPromptTraits))
        .setValue(String(this.plugin.settings.agentProfileMaxPromptTraits))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.agentProfileMaxPromptTraits = Number.isFinite(parsed) && parsed > 0
            ? parsed
            : DEFAULT_SETTINGS.agentProfileMaxPromptTraits;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.agentProfileMinEvidence.name"))
      .setDesc(translate("settings.agentProfileMinEvidence.desc"))
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.agentProfileMinEvidence))
        .setValue(String(this.plugin.settings.agentProfileMinEvidence))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.agentProfileMinEvidence = Number.isFinite(parsed) && parsed > 0
            ? parsed
            : DEFAULT_SETTINGS.agentProfileMinEvidence;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.agentProfileHalfLifeDays.name"))
      .setDesc(translate("settings.agentProfileHalfLifeDays.desc"))
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.agentProfileHalfLifeDays))
        .setValue(String(this.plugin.settings.agentProfileHalfLifeDays))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          this.plugin.settings.agentProfileHalfLifeDays = Number.isFinite(parsed) && parsed > 0
            ? parsed
            : DEFAULT_SETTINGS.agentProfileHalfLifeDays;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(translate("settings.clearAgentProfile.name"))
      .setDesc(translate("settings.clearAgentProfile.desc"))
      .addButton((button) => button
        .setButtonText(translate("settings.clearAgentProfile.button"))
        .setWarning()
        .onClick(async () => {
          if (!window.confirm(translate("settings.clearAgentProfile.confirm"))) {
            return;
          }
          await this.plugin.clearAgentProfile();
          new Notice(translate("settings.clearAgentProfile.done"));
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
      .setName(translate("settings.memoryAgentSearchEnabled.name"))
      .setDesc(translate("settings.memoryAgentSearchEnabled.desc"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.memoryAgentSearchEnabled)
        .onChange(async (value) => {
          this.plugin.settings.memoryAgentSearchEnabled = value;
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
