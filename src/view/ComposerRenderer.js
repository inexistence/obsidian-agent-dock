const { setIcon } = require("obsidian");

const { MODE_OPTIONS, getModeDescription, getModeLabel } = require("../modes");
const { DEFAULT_SETTINGS } = require("../settings");

function renderComposerContent(composer, options) {
  const {
    plugin,
    draft,
    getActiveSession,
    handleMentionKeydown,
    replaceObsidianLinksInInput,
    updateContextStatus,
    updateMentionChips,
    updateMentionSuggestions,
    hideMentionSuggestions,
    onDraftChanged,
    submit,
    cancelActiveSession,
    translate,
    addGlobalPointerListener,
    removeGlobalPointerListener
  } = options;

  const shell = composer.createDiv({ cls: "codex-dock__composer-shell" });
  const inputWrap = shell.createDiv({ cls: "codex-dock__input-wrap" });
  const mentionChipsEl = inputWrap.createDiv({
    cls: "codex-dock__mention-chips",
    attr: {
      "aria-label": translate("composer.referencedFiles")
    }
  });
  const inputEl = inputWrap.createEl("textarea", {
    cls: "codex-dock__input",
    attr: {
      rows: "4",
      spellcheck: "false",
      placeholder: translate("composer.placeholder")
    }
  });
  inputEl.value = draft || "";
  const mentionMenuEl = shell.createDiv({ cls: "codex-dock__mention-menu" });

  inputEl.addEventListener("keydown", (event) => {
    if (handleMentionKeydown(event)) {
      return;
    }
    const isComposing = event.isComposing || event.keyCode === 229;
    if (event.key === "Enter" && !event.shiftKey && !isComposing) {
      event.preventDefault();
      submit();
    }
  });
  inputEl.addEventListener("input", () => {
    if (replaceObsidianLinksInInput()) {
      return;
    }
    const session = getActiveSession();
    if (session) {
      session.draft = inputEl.value;
      onDraftChanged(session);
    }
    updateContextStatus();
    updateMentionChips();
    updateMentionSuggestions();
  });
  inputEl.addEventListener("click", updateMentionSuggestions);
  inputEl.addEventListener("blur", () => {
    window.setTimeout(hideMentionSuggestions, 120);
  });
  inputEl.addEventListener("paste", () => {
    window.setTimeout(replaceObsidianLinksInInput, 0);
  });

  const composerBar = shell.createDiv({ cls: "codex-dock__composer-bar" });
  const leftTools = composerBar.createDiv({ cls: "codex-dock__composer-tools" });
  const activeNoteButton = leftTools.createEl("button", {
    cls: "codex-dock__composer-icon-button",
    attr: {
      type: "button"
    }
  });
  const updateActiveNoteButton = () => {
    const isIncluded = plugin.settings.includeActiveNote;
    activeNoteButton.empty();
    setIcon(activeNoteButton, isIncluded ? "file-check-2" : "file-plus-2");
    activeNoteButton.toggleClass("is-active", isIncluded);
    activeNoteButton.setAttr("aria-pressed", String(isIncluded));
    activeNoteButton.setAttr(
      "aria-label",
      translate(isIncluded ? "composer.activeNoteIncluded" : "composer.activeNoteExcluded")
    );
    activeNoteButton.setAttr(
      "title",
      translate(isIncluded ? "composer.activeNoteIncluded" : "composer.activeNoteExcluded")
    );
  };
  updateActiveNoteButton();
  activeNoteButton.addEventListener("click", async () => {
    plugin.settings.includeActiveNote = !plugin.settings.includeActiveNote;
    updateActiveNoteButton();
    await plugin.saveSettings();
    updateContextStatus();
  });

  const modePill = leftTools.createEl("details", { cls: "codex-dock__mode-pill" });
  const modeSummary = modePill.createEl("summary", {
    cls: "codex-dock__mode-summary",
    attr: {
      "aria-label": translate("composer.mode"),
      title: getModeDescription(plugin.settings.mode, DEFAULT_SETTINGS.mode, translate)
    }
  });
  const modeIcon = modeSummary.createSpan({ cls: "codex-dock__mode-icon", attr: { "aria-hidden": "true" } });
  setIcon(modeIcon, "shield");
  const modeLabel = modeSummary.createSpan({
    cls: "codex-dock__mode-label",
    text: getModeLabel(plugin.settings.mode, DEFAULT_SETTINGS.mode, translate)
  });
  const modeChevron = modeSummary.createSpan({ cls: "codex-dock__mode-chevron", attr: { "aria-hidden": "true" } });
  setIcon(modeChevron, "chevron-down");

  const modeMenu = modePill.createDiv({ cls: "codex-dock__mode-menu", attr: { role: "menu" } });
  const closeModeMenu = (event) => {
    if (!modePill.contains(event.target)) {
      modePill.removeAttribute("open");
      removeGlobalPointerListener(closeModeMenu);
    }
  };
  modePill.addEventListener("toggle", () => {
    if (modePill.open) {
      window.setTimeout(() => {
        if (modePill.isConnected && modePill.open) {
          addGlobalPointerListener(closeModeMenu);
        }
      }, 0);
    } else {
      removeGlobalPointerListener(closeModeMenu);
    }
  });
  for (const [value, option] of Object.entries(MODE_OPTIONS)) {
    const optionButton = modeMenu.createEl("button", {
      cls: "codex-dock__mode-option",
      text: getModeLabel(value, DEFAULT_SETTINGS.mode, translate),
      attr: {
        type: "button",
        role: "menuitemradio",
        "aria-checked": String(value === plugin.settings.mode),
        title: getModeDescription(value, DEFAULT_SETTINGS.mode, translate)
      }
    });
    optionButton.toggleClass("is-selected", value === plugin.settings.mode);
    optionButton.addEventListener("click", async () => {
      plugin.settings.mode = value;
      modeLabel.setText(getModeLabel(value, DEFAULT_SETTINGS.mode, translate));
      modeSummary.setAttr("title", getModeDescription(value, DEFAULT_SETTINGS.mode, translate));
      for (const button of modeMenu.querySelectorAll(".codex-dock__mode-option")) {
        const isSelected = button === optionButton;
        button.classList.toggle("is-selected", isSelected);
        button.setAttribute("aria-checked", String(isSelected));
      }
      modePill.removeAttribute("open");
      await plugin.saveSettings();
      updateContextStatus();
    });
  }

  const rightTools = composerBar.createDiv({ cls: "codex-dock__composer-status" });
  const contextStatusEl = rightTools.createDiv({ cls: "codex-dock__context-status" });

  const sendButton = rightTools.createEl("button", {
    cls: "codex-dock__send",
    attr: { type: "button" }
  });
  if (getActiveSession()?.currentRun) {
    sendButton.setAttr("aria-label", translate("composer.stopAgent"));
    sendButton.setAttr("title", translate("composer.stopAgent"));
    setIcon(sendButton, "square");
    sendButton.addEventListener("click", cancelActiveSession);
  } else {
    sendButton.setAttr("aria-label", translate("composer.sendMessage"));
    sendButton.setAttr("title", translate("composer.sendMessage"));
    setIcon(sendButton, "arrow-up");
    sendButton.addEventListener("click", submit);
  }

  return {
    contextStatusEl,
    inputEl,
    mentionChipsEl,
    mentionMenuEl
  };
}

module.exports = {
  renderComposerContent
};
