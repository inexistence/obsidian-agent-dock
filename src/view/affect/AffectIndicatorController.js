const { Notice } = require("obsidian");

const { DEFAULT_WORKING_AFFECT } = require("../../affect/WorkingAffectStore");

class AffectIndicatorController {
  constructor(options) {
    this.plugin = options.plugin;
    this.translate = options.translate;
    this.addGlobalPointerListener = options.addGlobalPointerListener;
    this.removeGlobalPointerListener = options.removeGlobalPointerListener;
    this.indicatorEl = null;
    this.panelCloseListener = null;
    this.changeAnimationTimer = null;
    this.changeAnimationFrame = null;
  }

  setElement(indicatorEl) {
    this.indicatorEl = indicatorEl;
  }

  render(options = {}) {
    if (!this.indicatorEl) {
      return;
    }

    this.clearPanelCloseListener();
    this.indicatorEl.empty();
    if (
      !this.plugin.settings.affectShowIndicator
      || !this.plugin.settings.affectEnabled
      || !this.plugin.settings.affectCrossSessionEnabled
    ) {
      this.indicatorEl.addClass("is-empty");
      return;
    }
    const affect = this.plugin.getWorkingAffect() || this.getDefaultState();
    this.indicatorEl.removeClass("is-empty");

    const label = this.getStateLabel(affect.label);
    const strength = affect.isDefault
      ? this.translate("affect.strength.default")
      : this.getStrengthLabel(affect.strength);
    const age = affect.isDefault
      ? this.translate("affect.age.notUpdated")
      : this.formatAge(affect.ageMinutes);
    const title = this.translate("affect.tooltip", { label, strength, age });
    const details = this.indicatorEl.createEl("details", { cls: "codex-dock__affect" });
    const summary = details.createEl("summary", {
      cls: "codex-dock__affect-summary",
      attr: {
        "aria-label": this.translate("affect.open"),
        title
      }
    });
    summary.createSpan({ cls: "codex-dock__affect-pulse", attr: { "aria-hidden": "true" } });
    summary.createSpan({ cls: "codex-dock__affect-label", text: label });

    const panel = details.createDiv({ cls: "codex-dock__affect-panel" });
    panel.createDiv({
      cls: "codex-dock__affect-panel-title",
      text: this.translate("affect.panelTitle")
    });
    this.renderRow(panel, "affect.row.tone", label);
    this.renderRow(panel, "affect.row.warmth", this.getLevelLabel(affect.warmth));
    this.renderRow(panel, "affect.row.focus", this.getLevelLabel(affect.focus));
    this.renderRow(panel, "affect.row.tension", this.getLevelLabel(affect.tension));
    this.renderRow(panel, "affect.row.continuity", strength);
    this.renderRow(panel, "affect.row.updated", age);
    panel.createDiv({
      cls: "codex-dock__affect-note",
      text: this.translate("affect.boundary")
    });

    const resetButton = panel.createEl("button", {
      cls: "codex-dock__affect-reset",
      text: this.translate("affect.reset"),
      attr: { type: "button" }
    });
    resetButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await this.plugin.resetWorkingAffect();
        new Notice(this.translate("settings.resetAffect.done"));
        this.render();
      } catch (error) {
        console.warn("Agent Dock could not reset affect continuity:", error);
        new Notice(this.translate("notice.resetAffectFailed"));
      }
    });

    const closeAffectPanel = (event) => {
      if (!details.contains(event.target)) {
        details.removeAttribute("open");
        this.clearPanelCloseListener();
      }
    };
    details.addEventListener("toggle", () => {
      if (details.open) {
        window.setTimeout(() => {
          if (details.isConnected && details.open) {
            this.clearPanelCloseListener();
            this.panelCloseListener = closeAffectPanel;
            this.addGlobalPointerListener(closeAffectPanel);
          }
        }, 0);
      } else {
        this.clearPanelCloseListener();
      }
    });

    if (options.changed) {
      this.playChangeAnimation();
    }
  }

  playChangeAnimation() {
    if (!this.indicatorEl) {
      return;
    }
    this.clearChangeAnimation();
    this.changeAnimationFrame = window.requestAnimationFrame(() => {
      // Wait two frames so the rebuilt indicator has a stable pre-animation state.
      this.changeAnimationFrame = window.requestAnimationFrame(() => {
        this.changeAnimationFrame = null;
        this.indicatorEl?.addClass("is-changing");
        this.changeAnimationTimer = window.setTimeout(() => {
          this.indicatorEl?.removeClass("is-changing");
          this.changeAnimationTimer = null;
        }, 1800);
      });
    });
  }

  clearChangeAnimation() {
    if (this.changeAnimationFrame) {
      window.cancelAnimationFrame(this.changeAnimationFrame);
      this.changeAnimationFrame = null;
    }
    if (this.changeAnimationTimer) {
      window.clearTimeout(this.changeAnimationTimer);
      this.changeAnimationTimer = null;
    }
    this.indicatorEl?.removeClass("is-changing");
  }

  hasVisibleShift(previousAffect, nextAffect) {
    if (!this.plugin.settings.affectEnabled || !this.plugin.settings.affectCrossSessionEnabled || !nextAffect) {
      return false;
    }

    const previousLabel = previousAffect?.label || "";
    const nextLabel = nextAffect.label || "";
    const labelChanged = nextLabel && previousLabel && nextLabel !== previousLabel;
    const movedNoticeably = previousAffect && (
      Math.abs((nextAffect.warmth || 0) - (previousAffect.warmth || 0)) >= 0.22 ||
      Math.abs((nextAffect.focus || 0) - (previousAffect.focus || 0)) >= 0.22 ||
      Math.abs((nextAffect.tension || 0) - (previousAffect.tension || 0)) >= 0.18 ||
      Math.abs((nextAffect.valence || 0) - (previousAffect.valence || 0)) >= 0.24
    );

    if (!labelChanged && !movedNoticeably) {
      return false;
    }

    return true;
  }

  describePromptNotice(prompt) {
    const promptAffect = this.plugin.getPromptWorkingAffect(prompt);
    if (!promptAffect?.transient) {
      return null;
    }

    const label = promptAffect.label || "";
    if (!label) {
      return null;
    }

    return {
      rawLabel: label,
      noticeKey: "affect.promptNotice",
      kind: "affect_prompt",
      label: this.getToneLabel(label),
      strength: this.getStrengthLabel(promptAffect.strength),
      affect: promptAffect
    };
  }

  clearPanelCloseListener(options = {}) {
    if (!this.panelCloseListener) {
      return;
    }
    if (options.detach !== false) {
      this.removeGlobalPointerListener(this.panelCloseListener);
    }
    this.panelCloseListener = null;
  }

  renderRow(containerEl, labelKey, value) {
    const row = containerEl.createDiv({ cls: "codex-dock__affect-row" });
    row.createSpan({ cls: "codex-dock__affect-row-label", text: this.translate(labelKey) });
    row.createSpan({ cls: "codex-dock__affect-row-value", text: value });
  }

  getDefaultState() {
    return Object.assign({}, DEFAULT_WORKING_AFFECT, {
      strength: 0,
      ageMinutes: 0,
      isDefault: true
    });
  }

  getLabel(label) {
    const key = `affect.label.${label || "steady"}`;
    const translated = this.translate(key);
    return translated === key ? this.translate("affect.label.steady") : translated;
  }

  getStateLabel(label) {
    return this.getLabelPart(label, "state");
  }

  getToneLabel(label) {
    return this.getLabelPart(label, "tone");
  }

  getLabelPart(label, part) {
    const value = this.getLabel(label);
    const pieces = value.split("/").map((piece) => piece.trim()).filter(Boolean);
    if (pieces.length < 2) {
      return value;
    }
    return part === "tone" ? pieces[1] : pieces[0];
  }

  getLevelLabel(value) {
    if (value >= 0.75) {
      return this.translate("affect.level.high");
    }
    if (value >= 0.4) {
      return this.translate("affect.level.medium");
    }
    return this.translate("affect.level.low");
  }

  getStrengthLabel(value) {
    if (value >= 0.66) {
      return this.translate("affect.strength.high");
    }
    if (value >= 0.28) {
      return this.translate("affect.strength.medium");
    }
    return this.translate("affect.strength.low");
  }

  formatAge(ageMinutes) {
    const minutes = Math.max(0, Math.round(ageMinutes || 0));
    if (minutes < 1) {
      return this.translate("affect.age.justNow");
    }
    if (minutes < 60) {
      return this.translate("affect.age.minutes", { count: minutes });
    }
    return this.translate("affect.age.hours", { count: Math.round(minutes / 60) });
  }
}

module.exports = {
  AffectIndicatorController
};
