const { Notice, PluginSettingTab, Setting } = require("obsidian");

const { AGENT_OPTIONS } = require("./agents/AgentRegistry");
const { LANGUAGE_OPTIONS, t } = require("./i18n");
const { MODE_OPTIONS } = require("./modes");
const {
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
    const tr = (key, params) => t(this.plugin.settings, key, params);
    containerEl.empty();
    containerEl.createEl("h2", { text: tr("settings.heading") });
    containerEl.createEl("h3", { text: tr("settings.basic.heading") });

    new Setting(containerEl)
      .setName(tr("settings.language.name"))
      .setDesc(tr("settings.language.desc"))
      .addDropdown((dropdown) => {
        for (const [id, option] of Object.entries(LANGUAGE_OPTIONS)) dropdown.addOption(id, option.label);
        dropdown.setValue(this.plugin.settings.language).onChange(async (value) => {
          this.plugin.settings.language = value;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(tr("settings.agentProvider.name"))
      .setDesc(tr("settings.agentProvider.desc"))
      .addDropdown((dropdown) => {
        for (const [id, option] of Object.entries(AGENT_OPTIONS)) dropdown.addOption(id, option.label);
        dropdown.setValue(this.plugin.settings.agentId).onChange(async (value) => {
          const result = await this.plugin.switchAgentProvider(value);
          if (result.blocked) new Notice(tr("notice.agentStillWorking", { agent: result.agentLabel }));
          this.display();
        });
      });

    if (this.plugin.settings.agentId === "codex") {
      addTextSetting(containerEl, tr("settings.codexPath.name"), tr("settings.codexPath.desc"),
        this.plugin.settings.codexPath, DEFAULT_SETTINGS.codexPath, async (value) => {
          this.plugin.settings.codexPath = value.trim() || DEFAULT_SETTINGS.codexPath;
          await this.plugin.saveSettings();
        });
    } else {
      addTextSetting(containerEl, tr("settings.cursorPath.name"), tr("settings.cursorPath.desc"),
        this.plugin.settings.cursorPath, DEFAULT_SETTINGS.cursorPath, async (value) => {
          this.plugin.settings.cursorPath = value.trim() || DEFAULT_SETTINGS.cursorPath;
          await this.plugin.saveSettings();
        });
    }

    new Setting(containerEl)
      .setName(tr("settings.diagnose.name"))
      .setDesc(tr("settings.diagnose.desc"))
      .addButton((button) => button.setButtonText(tr("settings.diagnose.button")).onClick(async () => {
        button.setDisabled(true);
        const result = await this.plugin.diagnoseAgent();
        button.setDisabled(false);
        new Notice(result.ok
          ? tr("settings.diagnose.ok", {
              version: result.version || result.executablePath,
              auth: tr(`onboarding.auth.${result.authStatus || "unknown"}`),
              message: result.message
            })
          : tr("settings.diagnose.failed", { message: result.message }));
      }));

    addTextSetting(containerEl, tr("settings.workingDirectory.name"), tr("settings.workingDirectory.desc"),
      this.plugin.settings.workingDirectory, "/path/to/project", async (value) => {
        this.plugin.settings.workingDirectory = value.trim();
        await this.plugin.saveSettings();
      });

    new Setting(containerEl)
      .setName(tr("settings.defaultMode.name"))
      .setDesc(tr("settings.defaultMode.desc"))
      .addDropdown((dropdown) => {
        for (const id of Object.keys(MODE_OPTIONS)) dropdown.addOption(id, tr(`mode.${id}.label`));
        dropdown.setValue(this.plugin.settings.mode).onChange(async (value) => {
          if (value === "workspaceWrite" && !await confirmWorkspaceWrite(this.plugin, tr)) {
            dropdown.setValue("readOnly");
            return;
          }
          this.plugin.settings.mode = value;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
        });
      });

    containerEl.createEl("h3", { text: tr("settings.response.heading") });
    addTextSetting(containerEl, tr("settings.assistantDisplayName.name"), tr("settings.assistantDisplayName.desc"),
      this.plugin.settings.assistantDisplayName, tr("view.aiAssistant"), async (value) => {
        this.plugin.settings.assistantDisplayName = value.trim().slice(0, ASSISTANT_DISPLAY_NAME_MAX_CHARS);
        await this.plugin.saveSettings();
        this.plugin.refreshOpenViews();
      });

    new Setting(containerEl)
      .setName(tr("settings.assistantStyle.name"))
      .setDesc(tr("settings.assistantStyle.desc"))
      .addDropdown((dropdown) => {
        for (const id of Object.keys(ASSISTANT_STYLE_OPTIONS)) dropdown.addOption(id, tr(`assistantStyle.${id}.label`));
        dropdown.setValue(this.plugin.settings.assistantStyle).onChange(async (value) => {
          this.plugin.settings.assistantStyle = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (this.plugin.settings.assistantStyle === "custom") {
      addTextAreaSetting(containerEl, tr("settings.customAssistantStyle.name"),
        tr("settings.customAssistantStyle.desc", { max: CUSTOM_ASSISTANT_STYLE_MAX_CHARS }),
        this.plugin.settings.customAssistantStyle, async (value) => {
          this.plugin.settings.customAssistantStyle = value.slice(0, CUSTOM_ASSISTANT_STYLE_MAX_CHARS);
          await this.plugin.saveSettings();
        });
    }

    new Setting(containerEl)
      .setName(tr("settings.showToneCapsule.name"))
      .setDesc(tr("settings.showToneCapsule.desc"))
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.showToneCapsule).onChange(async (value) => {
        this.plugin.settings.showToneCapsule = value;
        await this.plugin.saveSettings();
        this.plugin.refreshOpenViews();
      }));

    containerEl.createEl("h3", { text: tr("settings.conversation.heading") });
    addToggleSetting(containerEl, tr("settings.persistChatHistory.name"), tr("settings.persistChatHistory.desc"),
      this.plugin.settings.persistChatHistory, async (value) => {
        this.plugin.settings.persistChatHistory = value;
        if (!value) await this.plugin.clearPersistedChatHistory();
        else await this.plugin.saveSettings();
      });
    addNumberSetting(containerEl, tr("settings.maxPersistedSessions.name"), tr("settings.maxPersistedSessions.desc"),
      this.plugin.settings.maxPersistedSessions, DEFAULT_SETTINGS.maxPersistedSessions, async (value) => {
        this.plugin.settings.maxPersistedSessions = value;
        await this.plugin.saveSettings();
      });
    addNumberSetting(containerEl, tr("settings.maxPersistedMessagesPerSession.name"), tr("settings.maxPersistedMessagesPerSession.desc"),
      this.plugin.settings.maxPersistedMessagesPerSession, DEFAULT_SETTINGS.maxPersistedMessagesPerSession, async (value) => {
        this.plugin.settings.maxPersistedMessagesPerSession = value;
        await this.plugin.saveSettings();
      });

    containerEl.createEl("h3", { text: tr("settings.advanced.heading") });
    if (this.plugin.settings.agentId === "codex") {
      addTextSetting(containerEl, tr("settings.args.name"), tr("settings.args.desc"),
        this.plugin.settings.args, DEFAULT_SETTINGS.args, async (value) => {
          this.plugin.settings.args = value.trim() || DEFAULT_SETTINGS.args;
          await this.plugin.saveSettings();
        });
    } else {
      addTextSetting(containerEl, tr("settings.cursorExtraArgs.name"), tr("settings.cursorExtraArgs.desc"),
        this.plugin.settings.cursorExtraArgs, "", async (value) => {
          this.plugin.settings.cursorExtraArgs = value.trim();
          await this.plugin.saveSettings();
        });
      new Setting(containerEl)
        .setName(tr("settings.cursorPermissionPolicy.name"))
        .setDesc(tr("settings.cursorPermissionPolicy.desc"))
        .addDropdown((dropdown) => dropdown
          .addOption("allow-once", tr("settings.cursorPermissionPolicy.allowOnce"))
          .addOption("allow-always", tr("settings.cursorPermissionPolicy.allowAlways"))
          .addOption("reject-once", tr("settings.cursorPermissionPolicy.rejectOnce"))
          .setValue(this.plugin.settings.cursorPermissionPolicy)
          .onChange(async (value) => {
            this.plugin.settings.cursorPermissionPolicy = value;
            await this.plugin.saveSettings();
          }));
    }
    addNumberSetting(containerEl, tr("settings.contextLimitChars.name"), tr("settings.contextLimitChars.desc"),
      this.plugin.settings.contextLimitChars, DEFAULT_SETTINGS.contextLimitChars, async (value) => {
        this.plugin.settings.contextLimitChars = value;
        await this.plugin.saveSettings();
      });
    addToggleSetting(containerEl, tr("settings.debugActivity.name"), tr("settings.debugActivity.desc"),
      this.plugin.settings.debugActivity, async (value) => {
        this.plugin.settings.debugActivity = value;
        await this.plugin.saveSettings();
        this.plugin.refreshOpenViews();
      });
  }
}

async function confirmWorkspaceWrite(plugin, translate) {
  if (plugin.settings.workspaceWriteAcknowledged) return true;
  if (!window.confirm(translate("confirm.workspaceWrite"))) return false;
  plugin.settings.workspaceWriteAcknowledged = true;
  await plugin.saveSettings();
  return true;
}

function addTextSetting(container, name, desc, value, placeholder, onChange) {
  new Setting(container).setName(name).setDesc(desc).addText((text) => text
    .setPlaceholder(placeholder).setValue(String(value || "")).onChange(onChange));
}

function addTextAreaSetting(container, name, desc, value, onChange) {
  new Setting(container).setName(name).setDesc(desc).addTextArea((text) => text
    .setValue(String(value || "")).onChange(onChange));
}

function addToggleSetting(container, name, desc, value, onChange) {
  new Setting(container).setName(name).setDesc(desc).addToggle((toggle) => toggle.setValue(Boolean(value)).onChange(onChange));
}

function addNumberSetting(container, name, desc, value, fallback, onChange) {
  new Setting(container).setName(name).setDesc(desc).addText((text) => text
    .setValue(String(value)).setPlaceholder(String(fallback)).onChange(async (raw) => {
      const parsed = Number.parseInt(raw, 10);
      await onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback);
    }));
}

module.exports = { AgentDockSettingTab, confirmWorkspaceWrite };
