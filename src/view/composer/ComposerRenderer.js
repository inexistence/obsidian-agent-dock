const { setIcon } = require("obsidian");

const { MODE_OPTIONS, getModeDescription, getModeLabel } = require("../../modes");
const { DEFAULT_SETTINGS } = require("../../settings");
const { createCodeMirrorComposerInput } = require("./CodeMirrorComposerInput");
const { renderQueuedPrompts } = require("./PromptQueueRenderer");

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
    insertActiveNoteReference,
    hasClipboardImagePaste,
    handleClipboardImagePaste,
    onDraftChanged,
    handleReferenceDrop,
    onCodeMirrorUnavailable,
    queuedPrompts,
    onClearQueuedPrompts,
    onRemoveQueuedPrompt,
    onEditQueuedPrompt,
    submit,
    cancelActiveSession,
    inputHeight,
    onInputHeightChanged,
    translate,
    addGlobalPointerListener,
    removeGlobalPointerListener
  } = options;

  const shell = composer.createDiv({ cls: "codex-dock__composer-shell" });
  renderQueuedPrompts(shell, queuedPrompts, {
    onClearQueuedPrompts,
    onRemoveQueuedPrompt,
    onEditQueuedPrompt,
    translate
  });
  const inputWrap = shell.createDiv({ cls: "codex-dock__input-wrap" });
  applyInputHeight(inputWrap, inputHeight);
  const mentionChipsEl = inputWrap.createDiv({
    cls: "codex-dock__mention-chips",
    attr: {
      "aria-label": translate("composer.referencedFiles")
    }
  });
  const inputEl = createComposerInput(inputWrap, {
    draft,
    onCodeMirrorUnavailable,
    placeholder: translate("composer.placeholder")
  });
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
    updateSendButtonState();
  });
  inputEl.addEventListener("click", updateMentionSuggestions);
  inputEl.addEventListener("blur", () => {
    window.setTimeout(hideMentionSuggestions, 120);
  });
  inputEl.addEventListener("paste", (event) => {
    if (hasClipboardImagePaste?.(event.clipboardData)) {
      event.preventDefault();
      handleClipboardImagePaste?.(event.clipboardData);
      return;
    }
    window.setTimeout(replaceObsidianLinksInInput, 0);
  });
  const onReferenceDragOver = (event) => {
    if (!handleReferenceDrop || !event.dataTransfer) {
      return;
    }
    if (hasFileDropPayload(event.dataTransfer)) {
      event.stopPropagation();
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    inputWrap.addClass("is-dragging-reference");
  };
  const onReferenceDragLeave = (event) => {
    if (!inputWrap.contains(event.relatedTarget)) {
      inputWrap.removeClass("is-dragging-reference");
    }
  };
  const onReferenceDrop = (event) => {
    inputWrap.removeClass("is-dragging-reference");
    if (!handleReferenceDrop || !event.dataTransfer) {
      return;
    }
    const shouldPreemptDefaultDrop = hasFileDropPayload(event.dataTransfer);
    if (shouldPreemptDefaultDrop) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }
    if (handleReferenceDrop(event.dataTransfer)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }
  };
  for (const dropTarget of [shell, inputWrap, inputEl]) {
    dropTarget.addEventListener("dragenter", onReferenceDragOver, true);
    dropTarget.addEventListener("dragover", onReferenceDragOver, true);
    dropTarget.addEventListener("dragleave", onReferenceDragLeave);
    dropTarget.addEventListener("drop", onReferenceDrop, true);
  }
  setupInputResizeEdge(shell, inputWrap, {
    initialHeight: inputHeight,
    onInputHeightChanged
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
    activeNoteButton.empty();
    setIcon(activeNoteButton, "file-plus-2");
    activeNoteButton.setAttr("aria-label", translate("composer.attachActiveNote"));
    activeNoteButton.setAttr("title", translate("composer.attachActiveNote"));
  };
  updateActiveNoteButton();
  activeNoteButton.addEventListener("click", () => {
    if (insertActiveNoteReference) {
      insertActiveNoteReference();
    }
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
  sendButton.addEventListener("click", () => {
    if (isStopButtonState()) {
      cancelActiveSession();
      return;
    }
    submit();
  });
  updateSendButtonState();

  return {
    contextStatusEl,
    inputEl,
    mentionChipsEl,
    mentionMenuEl,
    refreshSendButtonState: updateSendButtonState
  };

  function isStopButtonState() {
    return Boolean(getActiveSession()?.currentRun) && !inputEl.value.trim();
  }

  function updateSendButtonState() {
    sendButton.empty();
    if (isStopButtonState()) {
      sendButton.setAttr("aria-label", translate("composer.stopAgent"));
      sendButton.setAttr("title", translate("composer.stopAgent"));
      setIcon(sendButton, "square");
      return;
    }
    const label = getActiveSession()?.currentRun
      ? translate("composer.queueMessage")
      : translate("composer.sendMessage");
    sendButton.setAttr("aria-label", label);
    sendButton.setAttr("title", label);
    setIcon(sendButton, "arrow-up");
  }
}

function hasFileDropPayload(dataTransfer) {
  if (!dataTransfer) {
    return false;
  }
  if (Array.from(dataTransfer.files || []).length > 0) {
    return true;
  }
  return Array.from(dataTransfer.items || []).some((item) => item?.kind === "file");
}

const MIN_INPUT_HEIGHT = 62;
const DEFAULT_INPUT_HEIGHT = 62;
const INPUT_RESIZE_EDGE_HEIGHT = 8;

function setupInputResizeEdge(shell, inputWrap, options = {}) {
  if (!shell || !inputWrap) {
    return;
  }

  shell.addEventListener("pointermove", (event) => {
    shell.toggleClass("is-input-resize-edge", isPointerOnInputResizeEdge(shell, event));
  });
  shell.addEventListener("pointerleave", () => {
    shell.removeClass("is-input-resize-edge");
  });
  shell.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !isPointerOnInputResizeEdge(shell, event)) {
      return;
    }
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = getCurrentInputHeight(inputWrap, options.initialHeight);
    inputWrap.addClass("is-resizing-input");
    shell.addClass("is-resizing-input");
    shell.setPointerCapture?.(event.pointerId);

    const onPointerMove = (moveEvent) => {
      const nextHeight = clampInputHeight(startHeight + startY - moveEvent.clientY);
      applyInputHeight(inputWrap, nextHeight);
      options.onInputHeightChanged?.(nextHeight);
    };
    const onPointerUp = (upEvent) => {
      inputWrap.removeClass("is-resizing-input");
      shell.removeClass("is-resizing-input");
      shell.releasePointerCapture?.(upEvent.pointerId);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
  });
}

function isPointerOnInputResizeEdge(shell, event) {
  const rect = shell.getBoundingClientRect();
  return event.clientY >= rect.top && event.clientY <= rect.top + INPUT_RESIZE_EDGE_HEIGHT;
}

function getCurrentInputHeight(inputWrap, fallbackHeight) {
  const customHeight = Number(inputWrap.style.getPropertyValue("--codex-dock-composer-input-height").replace("px", ""));
  if (Number.isFinite(customHeight) && customHeight > 0) {
    return customHeight;
  }
  if (Number.isFinite(fallbackHeight) && fallbackHeight > 0) {
    return fallbackHeight;
  }
  return inputWrap.getBoundingClientRect().height || DEFAULT_INPUT_HEIGHT;
}

function applyInputHeight(inputWrap, height) {
  const nextHeight = Number(height);
  if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
    inputWrap.style.removeProperty("--codex-dock-composer-input-height");
    return;
  }
  inputWrap.style.setProperty("--codex-dock-composer-input-height", `${clampInputHeight(nextHeight)}px`);
}

function clampInputHeight(height) {
  const maxHeight = getMaxInputHeight();
  return Math.round(Math.min(Math.max(height, MIN_INPUT_HEIGHT), maxHeight));
}

function getMaxInputHeight() {
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return 360;
  }
  return Math.max(180, Math.min(420, Math.floor(viewportHeight * 0.55)));
}

function createComposerInput(inputWrap, options) {
  const codeMirrorInput = createCodeMirrorComposerInput({
    parent: inputWrap,
    onUnavailable: options.onCodeMirrorUnavailable,
    placeholder: options.placeholder,
    value: options.draft || ""
  });
  if (codeMirrorInput) {
    return codeMirrorInput;
  }

  const inputEl = inputWrap.createEl("textarea", {
    cls: "codex-dock__input",
    attr: {
      rows: "3",
      spellcheck: "false",
      placeholder: options.placeholder
    }
  });
  inputEl.value = options.draft || "";
  return inputEl;
}

module.exports = {
  renderComposerContent,
  _test: {
    clampInputHeight,
    hasFileDropPayload
  }
};
