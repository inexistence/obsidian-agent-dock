const { Modal, Notice, Setting } = require("obsidian");

const { AGENT_OPTIONS } = require("../agents/AgentRegistry");

class OnboardingModal extends Modal {
  constructor(app, plugin, translate) {
    super(app);
    this.plugin = plugin;
    this.translate = translate;
  }

  onOpen() {
    const { contentEl } = this;
    this.connectionTestPassed = false;
    contentEl.addClass("codex-dock__onboarding");
    contentEl.createEl("h2", { text: this.translate("onboarding.title") });
    contentEl.createEl("p", { text: this.translate("onboarding.intro") });

    new Setting(contentEl)
      .setName(this.translate("settings.agentProvider.name"))
      .setDesc(this.translate("onboarding.providerDesc"))
      .addDropdown((dropdown) => {
        for (const [id, option] of Object.entries(AGENT_OPTIONS)) dropdown.addOption(id, option.label);
        dropdown.setValue(this.plugin.settings.agentId).onChange(async (value) => {
          await this.plugin.switchAgentProvider(value);
          this.connectionTestPassed = false;
          this.finishButton?.setDisabled(true);
          status.setText("");
          status.removeClass("is-success");
          status.removeClass("is-error");
        });
      });

    const status = contentEl.createDiv({ cls: "codex-dock__onboarding-status" });
    new Setting(contentEl)
      .setName(this.translate("onboarding.check.name"))
      .setDesc(this.translate("onboarding.check.desc"))
      .addButton((button) => button.setButtonText(this.translate("onboarding.check.button")).onClick(async () => {
        button.setDisabled(true);
        const result = await this.plugin.diagnoseAgent();
        button.setDisabled(false);
        status.setText(result.ok
          ? this.translate("onboarding.check.ok", {
              version: result.version || result.executablePath,
              auth: this.translate(`onboarding.auth.${result.authStatus || "unknown"}`),
              message: result.message
            })
          : this.translate("onboarding.check.failed", { message: result.message }));
        status.toggleClass("is-success", result.ok);
        status.toggleClass("is-error", !result.ok);
      }));

    new Setting(contentEl)
      .setName(this.translate("onboarding.test.name"))
      .setDesc(this.translate("onboarding.test.desc"))
      .addButton((button) => button.setButtonText(this.translate("onboarding.test.button")).onClick(async () => {
        button.setDisabled(true);
        const result = await this.plugin.testAgentConnection();
        button.setDisabled(false);
        this.connectionTestPassed = result.ok;
        this.finishButton?.setDisabled(!result.ok);
        new Notice(this.translate(result.ok ? "onboarding.test.ok" : "onboarding.test.failed", { message: result.message }));
      }));

    contentEl.createEl("p", { cls: "codex-dock__onboarding-privacy", text: this.translate("onboarding.privacy") });
    new Setting(contentEl).addButton((button) => {
      this.finishButton = button;
      button
        .setCta()
        .setDisabled(true)
        .setButtonText(this.translate("onboarding.finish"))
        .onClick(async () => {
          if (!this.connectionTestPassed) return;
          this.plugin.settings.onboardingCompleted = true;
          await this.plugin.saveSettings();
          this.close();
        });
    });
  }

  onClose() {
    this.finishButton = null;
    this.contentEl.empty();
  }
}

module.exports = { OnboardingModal };
