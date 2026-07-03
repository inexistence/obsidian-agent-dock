const { setIcon } = require("obsidian");

const { MODE_OPTIONS, getModeDescription } = require("../modes");
const { DEFAULT_SETTINGS } = require("../settings");

function renderComposerContent(composer, options) {
  const {
    plugin,
    draft,
    getActiveSession,
    handleMentionKeydown,
    replaceObsidianLinksInInput,
    updateContextStatus,
    updateMentionSuggestions,
    hideMentionSuggestions,
    onDraftChanged,
    submit,
    cancelActiveSession,
    addGlobalPointerListener,
    removeGlobalPointerListener
  } = options;

  const shell = composer.createDiv({ cls: "codex-dock__composer-shell" });
  const inputEl = shell.createEl("textarea", {
    cls: "codex-dock__input",
    attr: {
      rows: "4",
      placeholder: "Ask the agent about this vault or the active note..."
    }
  });
  inputEl.value = draft || "";
  const mentionMenuEl = shell.createDiv({ cls: "codex-dock__mention-menu" });

  inputEl.addEventListener("keydown", (event) => {
    if (handleMentionKeydown(event)) {
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
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
      type: "button",
      "aria-label": "Toggle active note context",
      title: "Toggle active note context"
    }
  });
  setIcon(activeNoteButton, "plus");
  activeNoteButton.toggleClass("is-active", plugin.settings.includeActiveNote);
  activeNoteButton.addEventListener("click", async () => {
    plugin.settings.includeActiveNote = !plugin.settings.includeActiveNote;
    activeNoteButton.toggleClass("is-active", plugin.settings.includeActiveNote);
    await plugin.saveSettings();
    updateContextStatus();
  });

  const modePill = leftTools.createEl("details", { cls: "codex-dock__mode-pill" });
  const modeSummary = modePill.createEl("summary", {
    cls: "codex-dock__mode-summary",
    attr: {
      "aria-label": "Mode",
      title: getModeDescription(plugin.settings.mode, DEFAULT_SETTINGS.mode)
    }
  });
  const modeIcon = modeSummary.createSpan({ cls: "codex-dock__mode-icon", attr: { "aria-hidden": "true" } });
  setIcon(modeIcon, "shield");
  const modeLabel = modeSummary.createSpan({
    cls: "codex-dock__mode-label",
    text: getModeLabel(plugin.settings.mode)
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
      text: option.label,
      attr: {
        type: "button",
        role: "menuitemradio",
        "aria-checked": String(value === plugin.settings.mode),
        title: option.description
      }
    });
    optionButton.toggleClass("is-selected", value === plugin.settings.mode);
    optionButton.addEventListener("click", async () => {
      plugin.settings.mode = value;
      modeLabel.setText(option.label);
      modeSummary.setAttr("title", option.description);
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
    sendButton.setAttr("aria-label", "Stop agent");
    sendButton.setAttr("title", "Stop agent");
    setIcon(sendButton, "square");
    sendButton.addEventListener("click", cancelActiveSession);
  } else {
    sendButton.setAttr("aria-label", "Send message");
    sendButton.setAttr("title", "Send message");
    setIcon(sendButton, "arrow-up");
    sendButton.addEventListener("click", submit);
  }

  return {
    contextStatusEl,
    inputEl,
    mentionMenuEl
  };
}

function getModeLabel(mode) {
  return (MODE_OPTIONS[mode] || MODE_OPTIONS[DEFAULT_SETTINGS.mode]).label;
}

module.exports = {
  renderComposerContent
};
