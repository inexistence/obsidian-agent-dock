const { ItemView, MarkdownRenderer, Notice, setIcon } = require("obsidian");

const { VIEW_TYPE_AGENT_DOCK } = require("../constants");
const { t } = require("../i18n");
const { DEFAULT_SETTINGS } = require("../settings");
const { AGENT_OPTIONS } = require("../agents/AgentRegistry");
const { EmotiveFeedbackController } = require("./EmotiveFeedbackController");
const { ImagePreviewController } = require("./ImagePreviewController");
const { renderComposerContent } = require("./composer/ComposerRenderer");
const { ReferenceController } = require("./reference/ReferenceController");
const { runChatTurn } = require("./session/ChatTurnRunner");
const {
  clearPromptQueue,
  createDraftFromQueuedPrompt,
  enqueuePrompt,
  ensurePromptQueue,
  removePromptById,
  shiftPrompt
} = require("./session/PromptQueue");
const { SessionStore } = require("./session/SessionStore");
const { renderSessionSwitcher } = require("./session/SessionSwitcherRenderer");
const { MessageTimelineRenderer } = require("./timeline/MessageTimelineRenderer");
const { copyText } = require("./utils/clipboard");
const { estimateContextChars, formatCompactNumber } = require("./utils/contextEstimate");
const { decorateLocalFileLinks, normalizeLocalFileMarkdownLinks } = require("./utils/fileLinks");
const { formatMessageTime, formatMessageTimeIso, formatMessageTimeTitle } = require("./utils/messageTime");
const { DEFAULT_WORKING_AFFECT } = require("../affect/WorkingAffectStore");

const TURN_STATUS_PREVIEW_KINDS = ["thinking", "success", "celebrate", "error", "stopped"];
const PROMPT_TONE_PREVIEW_KINDS = [
  "alert",
  "serious",
  "reassuring",
  "challenging",
  "excited-open",
  "surprised",
  "admiring",
  "celebratory",
  "playful",
  "confident",
  "absorbed",
  "close",
  "patient",
  "restrained",
  "composed",
  "tense-focused",
  "warm-focused",
  "focused",
  "warm-open",
  "calm",
  "steady"
];
const PROMPT_TONE_STATUS_META = {
  alert: { mode: "alert-loop", color: "#b45309" },
  serious: { mode: "serious", color: "#6f5a4f" },
  reassuring: { mode: "settle", color: "#4d7c5a" },
  challenging: { mode: "alert", color: "#7c5aa6" },
  "excited-open": { mode: "excited", color: "#ea7a1a" },
  surprised: { mode: "glint", color: "#7a9f32" },
  admiring: { mode: "warm", color: "#8b6f3f" },
  celebratory: { mode: "celebrate", color: "#d45f4f" },
  playful: { mode: "excited", color: "#d27a2f" },
  confident: { mode: "lock", color: "#4f63b6" },
  absorbed: { mode: "absorbed", color: "#2f766f" },
  close: { mode: "warm", color: "#b76e79" },
  patient: { mode: "warm-focus", color: "#5f8a72" },
  restrained: { mode: "quiet", color: "#7b8190" },
  composed: { mode: "settle", color: "#3f7f88" },
  "tense-focused": { mode: "focus-loop", color: "#6b7280" },
  "warm-focused": { mode: "warm-focus", color: "#3f8f7a" },
  focused: { mode: "focus-loop", color: "#2f78b7" },
  "warm-open": { mode: "glint", color: "#7a9f32" },
  calm: { mode: "quiet", color: "#6d8fa3" },
  steady: { mode: "steady", color: "#65758b" }
};

class AgentDockView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.sessionStore = new SessionStore({
      getUntitledSessionTitle: (number) => this.translate("session.defaultTitle", { number }),
      getFallbackSessionTitle: () => this.translate("session.fallbackTitle")
    });
    this.timelineRenderer = new MessageTimelineRenderer({
      getDebugActivity: () => this.plugin.settings.debugActivity,
      translate: (key, params) => this.translate(key, params),
      renderMarkdownContent: (containerEl, text) => this.renderMarkdownContent(containerEl, text),
      copyText: (text) => copyText(text),
      prefersReducedMotion: () => this.prefersReducedMotion(),
      onDetailsToggleStart: (opening) => this.handleTimelineDetailsToggleStart(opening),
      onDetailsLayoutChanged: () => this.scrollMessagesToBottom()
    });
    this.emotiveFeedback = new EmotiveFeedbackController({
      prefersReducedMotion: () => this.prefersReducedMotion(),
      getLayerRoot: () => this.containerEl,
      onTransientStatusRemoved: (messageEl) => this.renderMessageAfterTransientStatus(messageEl)
    });
    this.referenceController = new ReferenceController({
      app: this.plugin.app,
      plugin: this.plugin,
      translate: (key, params) => this.translate(key, params),
      getActiveSession: () => this.getActiveSession(),
      persistSessionChange: (session) => this.persistSessionChange(session),
      updateContextStatus: () => this.updateContextStatus(),
      onInputValueChanged: () => this.refreshComposerSendButtonState?.()
    });
    this.messageEls = new WeakMap();
    this.messagesByEl = new WeakMap();
    this.debugFeedbackPreviewMessage = null;
    this.debugFeedbackPreviewEl = null;
    this.pendingMessageRenderFrame = null;
    this.pendingMessageRenderSessionId = "";
    this.pendingMessageRenderTarget = null;
    this.pendingRenderAfterTransient = false;
    this.affectPanelCloseListener = null;
    this.affectChangeAnimationTimer = null;
    this.affectChangeAnimationFrame = null;
    this.globalPointerListeners = new Set();
    this.hasLoadedPersistedSessions = false;
    this.autoScrollThresholdPx = 48;
    this.keepScrollBottomUntil = 0;
    this.pendingScrollBottomFrame = null;
    this.hasWarnedCodeMirrorUnavailable = false;
    this.composerInputHeight = null;
    this.imagePreviewController = new ImagePreviewController({
      containerEl: this.containerEl,
      translate: (key, params) => this.translate(key, params)
    });
  }

  get sessions() {
    return this.sessionStore.sessions;
  }

  get activeSessionId() {
    return this.sessionStore.activeSessionId;
  }

  set activeSessionId(value) {
    this.sessionStore.activeSessionId = value;
  }

  getViewType() {
    return VIEW_TYPE_AGENT_DOCK;
  }

  getDisplayText() {
    return "Agent Dock";
  }

  getIcon() {
    return "bot";
  }

  translate(key, params) {
    return t(this.plugin.settings, key, params);
  }

  async onOpen() {
    await this.loadPersistedSessions();
    this.ensureActiveSession();
    this.render();
  }

  async onClose() {
    this.destroyComposerInput();
    this.cancelPendingMessageRender();
    this.clearGlobalPointerListeners();
    this.closeImagePreview();
    this.clearAffectChangeAnimation();
    this.cancelRunningSessions();
    await this.plugin.flushChatSessions();
  }

  render(options = {}) {
    this.destroyComposerInput();
    this.cancelPendingMessageRender();
    this.clearGlobalPointerListeners();
    this.closeImagePreview();
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("codex-dock");

    const header = containerEl.createDiv({ cls: "codex-dock__header" });
    const identity = header.createDiv({ cls: "codex-dock__identity" });
    identity.createDiv({ cls: "codex-dock__title", text: this.getAssistantDisplayName() });
    this.affectIndicatorEl = identity.createDiv({ cls: "codex-dock__affect-slot" });
    this.renderAffectIndicator();

    const actions = header.createDiv({ cls: "codex-dock__actions" });
    this.agentSwitcherEl = actions.createDiv({ cls: "codex-dock__agent-switcher-slot" });
    this.renderAgentSwitcher(this.agentSwitcherEl);
    const terminalButton = actions.createEl("button", {
      cls: "codex-dock__icon-button",
      attr: {
        "aria-label": this.translate("view.openInteractiveTerminal"),
        title: this.translate("view.openInteractiveTerminal")
      }
    });
    terminalButton.setText(this.translate("view.terminalButton"));
    terminalButton.addEventListener("click", async () => {
      try {
        await this.plugin.openInteractiveAgent();
      } catch (error) {
        new Notice(this.translate("notice.openTerminalFailed", { message: error.message }));
      }
    });

    this.sessionBarEl = containerEl.createDiv({ cls: "codex-dock__session-bar" });
    this.renderSessionSwitcher();

    this.messageList = containerEl.createDiv({ cls: "codex-dock__messages" });
    this.renderMessages({ forceScrollToBottom: options.forceScrollToBottom });

    if (this.plugin.settings.debugActivity) {
      this.renderDebugFeedbackControls(containerEl.createDiv({ cls: "codex-dock__debug-feedback" }));
    }

    const composer = containerEl.createDiv({ cls: "codex-dock__composer" });
    this.renderComposerContent(composer, this.getActiveSession()?.draft || "");
  }

  renderAgentSwitcher(containerEl) {
    containerEl.empty();
    const switcher = containerEl.createEl("details", { cls: "codex-dock__agent-switcher" });
    const summary = switcher.createEl("summary", {
      cls: "codex-dock__agent-summary",
      attr: {
        "aria-label": this.translate("agent.switchProvider"),
        title: this.translate("agent.currentProviderTitle", { agent: this.plugin.agent.label })
      }
    });
    summary.createSpan({ cls: "codex-dock__agent-label", text: this.plugin.agent.label });
    const chevron = summary.createSpan({ cls: "codex-dock__agent-chevron", attr: { "aria-hidden": "true" } });
    setIcon(chevron, "chevron-down");

    const menu = switcher.createDiv({ cls: "codex-dock__mode-menu codex-dock__mode-menu--header", attr: { role: "menu" } });
    for (const [agentId, option] of Object.entries(AGENT_OPTIONS)) {
      const button = menu.createEl("button", {
        cls: "codex-dock__mode-option codex-dock__agent-option",
        text: option.label,
        attr: {
          type: "button",
          role: "menuitemradio",
          "aria-checked": String(agentId === this.plugin.settings.agentId),
          title: option.description
        }
      });
      button.toggleClass("is-selected", agentId === this.plugin.settings.agentId);
      button.addEventListener("click", async () => {
        switcher.removeAttribute("open");
        await this.switchAgentProvider(agentId);
      });
    }

    const closeAgentMenu = (event) => {
      if (!switcher.contains(event.target)) {
        switcher.removeAttribute("open");
        this.removeGlobalPointerListener(closeAgentMenu);
      }
    };
    switcher.addEventListener("toggle", () => {
      if (switcher.open) {
        window.setTimeout(() => {
          if (switcher.isConnected && switcher.open) {
            this.addGlobalPointerListener(closeAgentMenu);
          }
        }, 0);
      } else {
        this.removeGlobalPointerListener(closeAgentMenu);
      }
    });
  }

  async switchAgentProvider(agentId) {
    const result = await this.plugin.switchAgentProvider(agentId, { sourceView: this });
    if (result.blocked) {
      new Notice(this.translate("notice.agentStillWorking", { agent: result.agentLabel || this.plugin.agent.label }));
    }
  }

  async recordProviderSwitch(fromAgent, toAgent) {
    const session = this.ensureActiveSession();
    const message = this.appendProviderSwitchMessage(session, fromAgent, toAgent);
    this.sessionStore.touchSession(session);
    await this.persistChatSessions({ immediate: true });
    this.renderAgentSwitcherIfMounted();
    this.appendRenderedMessageIfActive(session, message);
  }

  hasRunningSession() {
    return this.sessions.some((session) => session.currentRun);
  }

  appendProviderSwitchMessage(session, fromAgent, toAgent) {
    const message = {
      role: "system",
      kind: "provider_switch",
      content: this.translate("agent.providerSwitched", { agent: toAgent }),
      providerSwitch: {
        from: fromAgent,
        to: toAgent
      },
      timeline: [],
      createdAt: Date.now(),
      isComplete: true,
      isLoading: false
    };
    session.messages.push(message);
    return message;
  }

  renderAgentSwitcherIfMounted() {
    if (this.agentSwitcherEl?.isConnected) {
      this.renderAgentSwitcher(this.agentSwitcherEl);
    }
  }

  appendRenderedMessageIfActive(session, message) {
    if (!this.messageList || session.id !== this.activeSessionId) {
      return;
    }
    this.messageList.querySelector(".codex-dock__empty")?.remove();
    const item = this.messageList.createDiv();
    this.renderMessageItem(item, message);
    this.messageEls.set(message, item);
    this.messagesByEl.set(item, message);
    this.scrollMessagesToBottom();
    this.updateContextStatus();
  }

  renderDebugFeedbackControls(containerEl) {
    const label = containerEl.createSpan({
      cls: "codex-dock__debug-feedback-label",
      text: this.translate("debugFeedback.label")
    });
    label.setAttr("aria-hidden", "true");
    for (const kind of TURN_STATUS_PREVIEW_KINDS) {
      const button = containerEl.createEl("button", {
        cls: "codex-dock__debug-feedback-button",
        text: this.getTurnStatusLabel(kind),
        attr: {
          type: "button",
          title: this.translate("debugFeedback.preview", { label: this.getTurnStatusLabel(kind) })
        }
      });
      button.addEventListener("click", () => this.previewDebugFeedback(kind));
    }
    const promptLabel = containerEl.createSpan({
      cls: "codex-dock__debug-feedback-label codex-dock__debug-feedback-label--prompt",
      text: this.translate("debugFeedback.promptLabel")
    });
    promptLabel.setAttr("aria-hidden", "true");
    for (const toneKind of PROMPT_TONE_PREVIEW_KINDS) {
      const toneLabel = this.getAffectToneLabel(toneKind);
      const button = containerEl.createEl("button", {
        cls: "codex-dock__debug-feedback-button",
        text: toneLabel,
        attr: {
          type: "button",
          title: this.translate("debugFeedback.preview", { label: toneLabel })
        }
      });
      button.addEventListener("click", () => this.previewDebugFeedback("thinking", {
        label: toneLabel,
        toneKind
      }));
    }
    const clearButton = containerEl.createEl("button", {
      cls: "codex-dock__debug-feedback-button codex-dock__debug-feedback-button--clear",
      text: this.translate("debugFeedback.clear"),
      attr: {
        type: "button"
      }
    });
    clearButton.addEventListener("click", () => this.clearDebugFeedbackPreview());
  }

  previewDebugFeedback(kind, options = {}) {
    if (!this.messageList) {
      return;
    }
    this.clearDebugFeedbackPreview();
    const label = options.label || this.getTurnStatusLabel(kind);
    const message = {
      role: "assistant",
      agentId: this.plugin.settings.agentId,
      content: this.translate("debugFeedback.previewContent", { label }),
      timeline: [],
      createdAt: Date.now(),
      isLoading: kind === "thinking",
      isComplete: kind !== "thinking",
      debugFeedbackPreview: true
    };
    if (kind === "thinking") {
      message.loadingToneLabel = label;
      message.loadingToneKind = options.toneKind || "";
    }
    if (kind !== "thinking") {
      message.emotiveFeedback = {
        kind,
        label,
        play: true
      };
    }
    this.debugFeedbackPreviewMessage = message;
    this.messageList.querySelector(".codex-dock__empty")?.remove();
    const item = this.messageList.createDiv();
    this.renderMessageItem(item, message);
    item.addClass("codex-dock__message--debug-preview");
    this.messageEls.set(message, item);
    this.messagesByEl.set(item, message);
    this.debugFeedbackPreviewEl = item;
    this.scrollMessagesToBottom();
  }

  clearDebugFeedbackPreview() {
    if (this.debugFeedbackPreviewEl) {
      this.emotiveFeedback.clearParticles(this.debugFeedbackPreviewEl, { scope: "dock" });
    }
    if (this.debugFeedbackPreviewEl?.isConnected) {
      this.debugFeedbackPreviewEl.remove();
    }
    this.debugFeedbackPreviewMessage = null;
    this.debugFeedbackPreviewEl = null;
  }

  renderSessionSwitcher() {
    if (!this.sessionBarEl) {
      return;
    }

    const activeSession = this.ensureActiveSession();
    renderSessionSwitcher({
      containerEl: this.sessionBarEl,
      sessions: this.sessions,
      activeSessionId: activeSession.id,
      activeSession,
      onSwitchSession: (sessionId) => {
        this.activeSessionId = sessionId;
        this.clearUnreadCompletion(this.sessionStore.getSession(sessionId));
        this.persistChatSessions();
        this.render();
      },
      onDeleteSession: (sessionId) => this.deleteSession(sessionId),
      onNewSession: () => {
        this.createSession();
        this.render();
      },
      translate: (key, params) => this.translate(key, params),
      addGlobalPointerListener: (listener) => this.addGlobalPointerListener(listener),
      removeGlobalPointerListener: (listener) => this.removeGlobalPointerListener(listener)
    });
  }

  renderComposerContent(composer, draft) {
    const refs = renderComposerContent(composer, {
      plugin: this.plugin,
      draft,
      getActiveSession: () => this.getActiveSession(),
      handleMentionKeydown: (event) => this.referenceController.handleMentionKeydown(event),
      replaceObsidianLinksInInput: () => this.referenceController.replaceObsidianLinksInInput(),
      updateContextStatus: () => this.updateContextStatus(),
      updateMentionChips: () => this.referenceController.updateMentionChips(),
      updateMentionSuggestions: () => this.referenceController.updateMentionSuggestions(),
      hideMentionSuggestions: () => this.referenceController.hideMentionSuggestions(),
      insertActiveNoteReference: () => this.insertActiveNoteReference(),
      hasClipboardImagePaste: (clipboardData) => this.referenceController.hasClipboardImagePaste(clipboardData),
      handleClipboardImagePaste: (clipboardData) => this.handleClipboardImagePaste(clipboardData),
      onDraftChanged: (session) => this.persistSessionChange(session),
      handleReferenceDrop: (dataTransfer) => this.referenceController.handleReferenceDrop(dataTransfer),
      onCodeMirrorUnavailable: () => this.notifyCodeMirrorUnavailable(),
      queuedPrompts: ensurePromptQueue(this.getActiveSession()),
      onClearQueuedPrompts: () => this.clearQueuedPrompts(),
      onRemoveQueuedPrompt: (queuedPromptId) => this.removeQueuedPrompt(queuedPromptId),
      onEditQueuedPrompt: (queuedPromptId) => this.editQueuedPrompt(queuedPromptId),
      submit: () => this.submit(),
      cancelActiveSession: () => this.cancelActiveSession(),
      inputHeight: this.composerInputHeight,
      onInputHeightChanged: (height) => {
        this.composerInputHeight = height;
      },
      translate: (key, params) => this.translate(key, params),
      addGlobalPointerListener: (listener) => this.addGlobalPointerListener(listener),
      removeGlobalPointerListener: (listener) => this.removeGlobalPointerListener(listener)
    });
    this.inputEl = refs.inputEl;
    this.mentionChipsEl = refs.mentionChipsEl;
    this.mentionMenuEl = refs.mentionMenuEl;
    this.contextStatusEl = refs.contextStatusEl;
    this.refreshComposerSendButtonState = refs.refreshSendButtonState;
    this.referenceController.setElements({
      inputEl: this.inputEl,
      mentionChipsEl: this.mentionChipsEl,
      mentionMenuEl: this.mentionMenuEl
    });
    this.updateContextStatus();
  }

  insertActiveNoteReference() {
    if (this.referenceController.insertActiveFileReference()) {
      return true;
    }
    new Notice(this.translate("notice.noActiveNote"));
    return false;
  }

  async handleClipboardImagePaste(clipboardData) {
    try {
      const saved = await this.referenceController.handleClipboardImagePaste(clipboardData);
      if (saved) {
        new Notice(this.translate("notice.pastedImageSaved"));
      }
      return saved;
    } catch (error) {
      console.error("Agent Dock failed to save pasted image", error);
      new Notice(this.translate("notice.pastedImageFailed", { message: error.message || String(error) }));
      return false;
    }
  }

  renderMessages(options = {}) {
    const shouldScrollToBottom = options.forceScrollToBottom || this.isMessageListNearBottom();
    const previousScrollTop = this.messageList.scrollTop;
    this.messageList.empty();
    this.messageEls = new WeakMap();
    this.messagesByEl = new WeakMap();
    const session = this.ensureActiveSession();
    const messages = session.messages;

    if (messages.length === 0) {
      const empty = this.messageList.createDiv({ cls: "codex-dock__empty" });
      empty.createDiv({ text: this.translate("view.emptyLine1") });
      empty.createDiv({ text: this.translate("view.emptyLine2") });
      this.updateContextStatus();
      return;
    }

    for (const message of messages) {
      const item = this.messageList.createDiv();
      this.renderMessageItem(item, message);
      this.messageEls.set(message, item);
      this.messagesByEl.set(item, message);
    }

    if (shouldScrollToBottom) {
      this.scrollMessagesToBottom();
      this.keepMessagesPinnedToBottom(options.forceScrollToBottom ? 900 : 250);
    } else {
      this.messageList.scrollTop = previousScrollTop;
    }
    this.updateContextStatus();
  }

  renderMessageItem(item, message) {
    item.empty();
    this.messagesByEl?.set(item, message);
    item.className = `codex-dock__message codex-dock__message--${message.role}`;
    if (message.debugFeedbackPreview) {
      item.addClass("codex-dock__message--debug-preview");
    }
    if (message.role === "system") {
      this.renderSystemMessage(item, message);
      return;
    }
    this.renderMessageMeta(item, message);
    if (message.timeline && message.timeline.length > 0) {
      const timeline = item.createDiv({ cls: "codex-dock__timeline" });
      this.renderTimeline(timeline, message);
    } else if (message.content) {
      this.renderMarkdownContent(item, message.content);
    }
    this.renderMessageFooter(item, message);
  }

  prefersReducedMotion() {
    return (
      typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  renderTurnStatus(item, message, providedStatus = null) {
    const status = providedStatus || this.getTurnStatus(message);
    if (!status) {
      return;
    }
    const isFirstThinkingRender = status.kind === "thinking" && !message.emotiveFeedbackPlayed?.thinking;
    const statusClasses = [
      "codex-dock__turn-status",
      `codex-dock__turn-status--${status.kind}`
    ];
    const toneMeta = status.kind === "thinking" && status.toneKind
      ? this.getPromptToneStatusMeta(status.toneKind)
      : null;
    if (toneMeta) {
      statusClasses.push("codex-dock__turn-status--tone");
      statusClasses.push(`codex-dock__turn-status--tone-${toneMeta.mode}`);
    }
    if (status.play || (isFirstThinkingRender && !toneMeta)) {
      statusClasses.push("is-fresh");
    }
    if (status.play && status.kind === "error") {
      statusClasses.push("is-alerting");
    } else if (status.play && status.kind === "stopped") {
      statusClasses.push("is-settling");
    }

    const statusSlot = item.createDiv({ cls: "codex-dock__turn-status-slot" });
    const statusEl = statusSlot.createSpan({
      cls: statusClasses.join(" "),
      text: status.label,
      attr: {
        "data-feedback-kind": status.kind
      }
    });
    if (toneMeta) {
      statusEl.style.setProperty("--codex-dock-turn-status-color", toneMeta.color);
    }

    if (status.kind === "thinking") {
      if (!message.emotiveFeedbackPlayed) {
        message.emotiveFeedbackPlayed = {};
      }
      if (isFirstThinkingRender) {
        message.emotiveFeedbackPlayed.thinking = true;
      }
      window.requestAnimationFrame(() => {
        if (item.isConnected && statusEl.isConnected) {
          this.emotiveFeedback.play(item, statusEl, "thinking");
        }
      });
      return;
    }

    if (status.play) {
      window.requestAnimationFrame(() => {
        if (item.isConnected && statusEl.isConnected) {
          this.emotiveFeedback.play(item, statusEl, status.kind);
        }
      });
      if (message.emotiveFeedback) {
        message.emotiveFeedback.played = true;
      }
    }
    if (status.transient) {
      this.emotiveFeedback.settleTransientStatus(statusEl, status.kind);
    }
  }

  getTurnStatus(message) {
    if (!message || message.role !== "assistant") {
      return null;
    }
    if (message.isLoading) {
      return {
        kind: "thinking",
        label: message.loadingToneLabel || this.translate("turnStatus.thinking"),
        toneKind: message.loadingToneKind || "",
        play: false
      };
    }
    const feedback = message.emotiveFeedback;
    if (!feedback || !feedback.kind) {
      return null;
    }
    if (feedback.played) {
      return null;
    }
    return {
      kind: feedback.kind,
      label: feedback.label || this.getTurnStatusLabel(feedback.kind),
      play: feedback.play !== false,
      transient: feedback.transient !== false
    };
  }

  getTurnStatusLabel(kind) {
    if (kind === "success") {
      return this.translate("turnStatus.success");
    }
    if (kind === "celebrate") {
      return this.translate("turnStatus.celebrate");
    }
    if (kind === "error") {
      return this.translate("turnStatus.error");
    }
    if (kind === "stopped") {
      return this.translate("turnStatus.stopped");
    }
    return this.translate("turnStatus.thinking");
  }

  getPromptToneStatusMeta(toneKind) {
    return PROMPT_TONE_STATUS_META[toneKind] || PROMPT_TONE_STATUS_META.steady;
  }

  renderMessageMeta(item, message) {
    item.createDiv({
      cls: "codex-dock__role",
      text: message.role === "user" ? this.translate("view.you") : this.getAssistantDisplayName()
    });
  }

  getAssistantDisplayName() {
    return String(this.plugin.settings.assistantDisplayName || "").trim() || this.translate("view.aiAssistant");
  }

  renderSystemMessage(item, message) {
    const noticeClasses = ["codex-dock__system-notice"];
    if (message.kind) {
      noticeClasses.push(`codex-dock__system-notice--${message.kind}`);
    }
    if (message.animateOnRender) {
      noticeClasses.push("is-fresh");
      message.animateOnRender = false;
    }
    const noticeClass = noticeClasses.join(" ");
    const notice = item.createDiv({ cls: noticeClass });
    notice.createSpan({ cls: "codex-dock__system-notice-text", text: message.content || "" });
    if (this.isAffectSystemMessage(message)) {
      return;
    }
    const displayTime = formatMessageTime(message.createdAt, {
      language: this.plugin.settings.language,
      now: Date.now()
    });
    if (displayTime) {
      const title = formatMessageTimeTitle(message.createdAt, {
        language: this.plugin.settings.language
      });
      const attr = { title: title || displayTime };
      const iso = formatMessageTimeIso(message.createdAt);
      if (iso) {
        attr.datetime = iso;
      }
      notice.createEl("time", {
        cls: "codex-dock__system-notice-time",
        text: displayTime,
        attr
      });
    }
  }

  isAffectSystemMessage(message) {
    return message?.kind === "affect_shift" || message?.kind === "affect_prompt";
  }

  renderMessageFooter(item, message) {
    const status = this.getTurnStatus(message);
    if (status) {
      const footerClasses = ["codex-dock__message-footer", "codex-dock__message-footer--status"];
      const shouldHandoffToMeta = status.kind !== "thinking" && status.transient;
      if (shouldHandoffToMeta) {
        footerClasses.push("codex-dock__message-footer--handoff");
      }
      const footer = item.createDiv({ cls: footerClasses.join(" ") });
      this.renderTurnStatus(footer, message, status);
      if (shouldHandoffToMeta) {
        this.renderMessageFooterMeta(footer, message, { pending: true });
      }
      return;
    }

    this.renderMessageFooterMeta(item, message);
  }

  renderMessageFooterMeta(item, message, options = {}) {
    const displayTime = formatMessageTime(message.createdAt, {
      language: this.plugin.settings.language,
      now: Date.now()
    });
    const copySource = message.content || "";
    if (!displayTime && !copySource) {
      return false;
    }

    const footer = options.pending
      ? item
      : item.createDiv({ cls: "codex-dock__message-footer" });
    const metaClasses = ["codex-dock__message-footer-meta"];
    if (options.pending) {
      metaClasses.push("codex-dock__message-footer-meta--pending");
    }
    const meta = footer.createSpan({ cls: metaClasses.join(" ") });
    const title = formatMessageTimeTitle(message.createdAt, {
      language: this.plugin.settings.language
    });
    const iso = formatMessageTimeIso(message.createdAt);
    const attr = { title: title || displayTime };
    if (iso) {
      attr.datetime = iso;
    }
    if (displayTime) {
      meta.createEl("time", {
        cls: "codex-dock__message-time",
        text: displayTime,
        attr
      });
    }
    if (copySource) {
      this.renderMessageCopyButton(meta, copySource);
    }
    return true;
  }

  renderMessageCopyButton(containerEl, text) {
    const copyButton = containerEl.createEl("button", {
      cls: "codex-dock__copy-button",
      attr: {
        type: "button",
        "aria-label": this.translate("view.copyMessageText"),
        title: this.translate("view.copyMessageText")
      }
    });
    setIcon(copyButton, "copy");
    copyButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await copyText(text || "");
      copyButton.addClass("is-copied");
      copyButton.setAttr("title", this.translate("view.copied"));
      copyButton.setAttr("aria-label", this.translate("view.copied"));
      setIcon(copyButton, "check");
      window.setTimeout(() => {
        copyButton.removeClass("is-copied");
        copyButton.setAttr("title", this.translate("view.copyMessageText"));
        copyButton.setAttr("aria-label", this.translate("view.copyMessageText"));
        setIcon(copyButton, "copy");
      }, 1200);
    });
  }

  async submit() {
    const session = this.ensureActiveSession();
    const prompt = this.inputEl.value.trim();
    if (session.currentRun) {
      if (prompt) {
        this.queuePrompt(session, prompt);
      }
      return;
    }

    if (!prompt) {
      return;
    }

    this.clearComposerDraft(session);
    await this.startChatTurn(session, prompt);
  }

  async startChatTurn(session, prompt, options = {}) {
    this.maybeNameSession(session, prompt);
    this.updateSessionSwitcher();
    this.sessionStore.touchSession(session);

    await runChatTurn({
      session,
      prompt,
      agentLabel: this.getAssistantDisplayName(),
      agentId: this.plugin.settings.agentId,
      runAgent: (agentPrompt, onUpdate, conversation, options) => (
        this.plugin.runAgent(agentPrompt, onUpdate, conversation, options)
      ),
      translate: (key, params) => this.translate(key, params),
      touchSession: (targetSession) => this.sessionStore.touchSession(targetSession),
      onBeforeAgentRun: (targetSession, assistantMessage) => {
        const promptAffectNotice = this.describePromptAffectNotice(prompt);
        if (promptAffectNotice) {
          assistantMessage.loadingToneLabel = promptAffectNotice.label || "";
          assistantMessage.loadingToneKind = promptAffectNotice.rawLabel || "";
          if (promptAffectNotice.rawLabel === "celebratory") {
            assistantMessage.emotiveCompletionKind = "celebrate";
          }
        }
      },
      onTurnStarted: (targetSession) => {
        if (targetSession.id === this.activeSessionId) {
          this.renderMessages({ forceScrollToBottom: true });
          this.renderComposer({ focusInput: true });
        }
      },
      onTurnUpdate: (targetSession, assistantMessage) => {
        this.scheduleSessionRenderIfActive(targetSession, assistantMessage);
      },
      onTurnFinished: (targetSession, result) => this.handleTurnFinished(targetSession, result),
      onComposerChanged: (targetSession) => this.renderComposerIfActive(targetSession),
      updateWorkingAffect: async (turn, context = {}) => {
        const previousAffect = this.plugin.getWorkingAffect();
        await this.plugin.updateWorkingAffect(turn);
        const nextAffect = this.plugin.getWorkingAffect();
        const affectChanged = this.hasVisibleAffectShift(previousAffect, nextAffect);
        const isActiveSession = context.session?.id === this.activeSessionId;
        if (isActiveSession) {
          this.renderAffectIndicator({ changed: affectChanged });
        }
      },
      settleAffectDisplay: async (context = {}) => {
        this.renderAffectIndicatorIfActive(context.session);
      },
      persistChatSessions: (options) => this.persistChatSessions(options),
      notify: (noticeKey, targetSession) => {
        if (targetSession && targetSession.id !== this.activeSessionId) {
          return;
        }
        const key = noticeKey === "agentStopped" ? "notice.agentStopped" : "notice.agentCommandFailed";
        new Notice(this.translate(key, { agent: this.plugin.agent.label }));
      }
    });
    if (options.drainQueue !== false) {
      await this.drainQueuedPrompts(session);
    }
  }

  clearComposerDraft(session) {
    if (this.inputEl) {
      this.inputEl.value = "";
    }
    session.draft = "";
    this.referenceController.updateMentionChips();
  }

  queuePrompt(session, prompt) {
    if (!enqueuePrompt(session, prompt)) {
      return;
    }

    this.clearComposerDraft(session);
    this.sessionStore.touchSession(session);
    this.persistSessionChange(session);
    this.renderComposerIfActive(session, { focusInput: true });
    this.updateContextStatus();
  }

  removeQueuedPrompt(queuedPromptId) {
    const session = this.getActiveSession();
    if (!removePromptById(session, queuedPromptId)) {
      return;
    }

    this.sessionStore.touchSession(session);
    this.persistSessionChange(session);
    this.renderComposerIfActive(session);
  }

  clearQueuedPrompts() {
    const session = this.getActiveSession();
    if (clearPromptQueue(session) === 0) {
      return;
    }

    this.sessionStore.touchSession(session);
    this.persistSessionChange(session);
    this.renderComposerIfActive(session);
  }

  editQueuedPrompt(queuedPromptId) {
    const session = this.getActiveSession();
    const entry = removePromptById(session, queuedPromptId);
    if (!entry) {
      return;
    }

    const currentDraft = String(this.inputEl?.value || session.draft || "");
    session.draft = createDraftFromQueuedPrompt(entry, currentDraft);
    this.sessionStore.touchSession(session);
    this.persistSessionChange(session);
    this.renderComposerIfActive(session);
    if (this.inputEl) {
      this.inputEl.focus();
      const cursor = entry.text.length;
      this.inputEl.selectionStart = cursor;
      this.inputEl.selectionEnd = cursor;
    }
  }

  async drainQueuedPrompts(session) {
    while (session && !session.currentRun && ensurePromptQueue(session).length > 0) {
      const entry = shiftPrompt(session);
      if (!entry) {
        return;
      }
      this.sessionStore.touchSession(session);
      this.persistSessionChange(session);
      this.renderComposerIfActive(session, { preserveFocus: true });
      await this.startChatTurn(session, entry.text, { drainQueue: false });
    }
  }

  renderComposer(options = {}) {
    const composer = this.containerEl.querySelector(".codex-dock__composer");
    if (!composer) {
      return;
    }

    const shouldRestoreFocus = Boolean(
      options.focusInput
      || (
        options.preserveFocus !== false
        && this.inputEl
        && this.isComposerInputFocused()
      )
    );
    const draft = this.getActiveSession()?.draft || "";
    this.destroyComposerInput();
    composer.empty();
    this.renderComposerContent(composer, draft);
    if (shouldRestoreFocus && this.inputEl) {
      const inputToFocus = this.inputEl;
      window.requestAnimationFrame(() => {
        if (inputToFocus.isConnected) {
          inputToFocus.focus();
        }
      });
    }
  }

  isComposerInputFocused() {
    if (!this.inputEl) {
      return false;
    }
    if (this.inputEl.isCodeMirrorComposerInput) {
      return this.inputEl.contains(document.activeElement);
    }
    return document.activeElement === this.inputEl;
  }

  destroyComposerInput() {
    if (this.inputEl?.destroy) {
      this.inputEl.destroy();
    }
    this.inputEl = null;
  }

  notifyCodeMirrorUnavailable() {
    if (this.hasWarnedCodeMirrorUnavailable) {
      return;
    }
    this.hasWarnedCodeMirrorUnavailable = true;
    console.warn("Agent Dock Markdown live preview is unavailable; using textarea composer.");
    new Notice(this.translate("notice.markdownLivePreviewUnavailable"));
  }

  renderAffectIndicator(options = {}) {
    if (!this.affectIndicatorEl) {
      return;
    }

    this.clearAffectPanelCloseListener();
    this.affectIndicatorEl.empty();
    if (
      !this.plugin.settings.affectShowIndicator
      || !this.plugin.settings.affectEnabled
      || !this.plugin.settings.affectCrossSessionEnabled
    ) {
      this.affectIndicatorEl.addClass("is-empty");
      return;
    }
    const affect = this.plugin.getWorkingAffect() || this.getDefaultAffectIndicatorState();
    this.affectIndicatorEl.removeClass("is-empty");

    const label = this.getAffectStateLabel(affect.label);
    const strength = affect.isDefault
      ? this.translate("affect.strength.default")
      : this.getAffectStrengthLabel(affect.strength);
    const age = affect.isDefault
      ? this.translate("affect.age.notUpdated")
      : this.formatAffectAge(affect.ageMinutes);
    const title = this.translate("affect.tooltip", { label, strength, age });
    const details = this.affectIndicatorEl.createEl("details", { cls: "codex-dock__affect" });
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
    this.renderAffectRow(panel, "affect.row.tone", label);
    this.renderAffectRow(panel, "affect.row.warmth", this.getAffectLevelLabel(affect.warmth));
    this.renderAffectRow(panel, "affect.row.focus", this.getAffectLevelLabel(affect.focus));
    this.renderAffectRow(panel, "affect.row.tension", this.getAffectLevelLabel(affect.tension));
    this.renderAffectRow(panel, "affect.row.continuity", strength);
    this.renderAffectRow(panel, "affect.row.updated", age);
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
        this.renderAffectIndicator();
      } catch (error) {
        console.warn("Agent Dock could not reset affect continuity:", error);
        new Notice(this.translate("notice.resetAffectFailed"));
      }
    });

    const closeAffectPanel = (event) => {
      if (!details.contains(event.target)) {
        details.removeAttribute("open");
        this.clearAffectPanelCloseListener();
      }
    };
    details.addEventListener("toggle", () => {
      if (details.open) {
        window.setTimeout(() => {
          if (details.isConnected && details.open) {
            this.clearAffectPanelCloseListener();
            this.affectPanelCloseListener = closeAffectPanel;
            this.addGlobalPointerListener(closeAffectPanel);
          }
        }, 0);
      } else {
        this.clearAffectPanelCloseListener();
      }
    });

    if (options.changed) {
      this.playAffectChangeAnimation();
    }
  }

  playAffectChangeAnimation() {
    if (!this.affectIndicatorEl) {
      return;
    }
    this.clearAffectChangeAnimation();
    this.affectChangeAnimationFrame = window.requestAnimationFrame(() => {
      // Wait two frames so the rebuilt indicator has a stable pre-animation state.
      this.affectChangeAnimationFrame = window.requestAnimationFrame(() => {
        this.affectChangeAnimationFrame = null;
        this.affectIndicatorEl?.addClass("is-changing");
        this.affectChangeAnimationTimer = window.setTimeout(() => {
          this.affectIndicatorEl?.removeClass("is-changing");
          this.affectChangeAnimationTimer = null;
        }, 1800);
      });
    });
  }

  clearAffectChangeAnimation() {
    if (this.affectChangeAnimationFrame) {
      window.cancelAnimationFrame(this.affectChangeAnimationFrame);
      this.affectChangeAnimationFrame = null;
    }
    if (this.affectChangeAnimationTimer) {
      window.clearTimeout(this.affectChangeAnimationTimer);
      this.affectChangeAnimationTimer = null;
    }
    this.affectIndicatorEl?.removeClass("is-changing");
  }

  hasVisibleAffectShift(previousAffect, nextAffect) {
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

  renderAffectIndicatorIfActive(session, options = {}) {
    const isActiveSession = session?.id === this.activeSessionId;
    if (isActiveSession) {
      this.renderAffectIndicator(options);
    }
  }

  describePromptAffectNotice(prompt) {
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
      label: this.getAffectToneLabel(label),
      strength: this.getAffectStrengthLabel(promptAffect.strength),
      affect: promptAffect
    };
  }

  clearAffectPanelCloseListener() {
    if (!this.affectPanelCloseListener) {
      return;
    }
    this.removeGlobalPointerListener(this.affectPanelCloseListener);
    this.affectPanelCloseListener = null;
  }

  renderAffectRow(containerEl, labelKey, value) {
    const row = containerEl.createDiv({ cls: "codex-dock__affect-row" });
    row.createSpan({ cls: "codex-dock__affect-row-label", text: this.translate(labelKey) });
    row.createSpan({ cls: "codex-dock__affect-row-value", text: value });
  }

  getDefaultAffectIndicatorState() {
    return Object.assign({}, DEFAULT_WORKING_AFFECT, {
      strength: 0,
      ageMinutes: 0,
      isDefault: true
    });
  }

  getAffectLabel(label) {
    const key = `affect.label.${label || "steady"}`;
    const translated = this.translate(key);
    return translated === key ? this.translate("affect.label.steady") : translated;
  }

  getAffectStateLabel(label) {
    return this.getAffectLabelPart(label, "state");
  }

  getAffectToneLabel(label) {
    return this.getAffectLabelPart(label, "tone");
  }

  getAffectLabelPart(label, part) {
    const value = this.getAffectLabel(label);
    const pieces = value.split("/").map((piece) => piece.trim()).filter(Boolean);
    if (pieces.length < 2) {
      return value;
    }
    return part === "tone" ? pieces[1] : pieces[0];
  }

  getAffectLevelLabel(value) {
    if (value >= 0.75) {
      return this.translate("affect.level.high");
    }
    if (value >= 0.4) {
      return this.translate("affect.level.medium");
    }
    return this.translate("affect.level.low");
  }

  getAffectStrengthLabel(value) {
    if (value >= 0.66) {
      return this.translate("affect.strength.high");
    }
    if (value >= 0.28) {
      return this.translate("affect.strength.medium");
    }
    return this.translate("affect.strength.low");
  }

  formatAffectAge(ageMinutes) {
    const minutes = Math.max(0, Math.round(ageMinutes || 0));
    if (minutes < 1) {
      return this.translate("affect.age.justNow");
    }
    if (minutes < 60) {
      return this.translate("affect.age.minutes", { count: minutes });
    }
    return this.translate("affect.age.hours", { count: Math.round(minutes / 60) });
  }

  renderTimeline(containerEl, message) {
    this.timelineRenderer.renderTimeline(containerEl, message);
  }

  handleTimelineDetailsToggleStart(opening) {
    if (!opening || !this.isMessageListNearBottom()) {
      return false;
    }
    return true;
  }

  renderMarkdownContent(containerEl, text) {
    const contentEl = containerEl.createDiv({ cls: "codex-dock__content markdown-rendered" });
    const markdownEl = contentEl.createDiv({ cls: "codex-dock__content-body" });
    const sourcePath = this.app.workspace.getActiveFile()?.path || "";
    const renderText = normalizeLocalFileMarkdownLinks(text || "");
    MarkdownRenderer.render(this.app, renderText, markdownEl, sourcePath, this).then(() => {
      decorateLocalFileLinks(markdownEl, this.app, {
        sourcePath,
        confirmExternalLocalFile: (path) => window.confirm(
          this.translate("confirm.openExternalLocalFile", { path })
        ),
        onOpenFailed: ({ vaultPath }) => {
          new Notice(this.translate("notice.openFileLinkFailed", { path: vaultPath }));
        }
      });
      this.decorateImagePreviews(markdownEl);
      this.scrollMessagesToBottomIfPinned();
    }).catch(() => {
      markdownEl.setText(text || "");
      this.scrollMessagesToBottomIfPinned();
    });
    return contentEl;
  }

  decorateImagePreviews(markdownEl) {
    this.imagePreviewController.decorate(markdownEl);
  }

  closeImagePreview() {
    this.imagePreviewController.close();
  }

  updateContextStatus() {
    if (!this.contextStatusEl) {
      return;
    }

    const session = this.getActiveSession();
    const limit = Number(this.plugin.settings.contextLimitChars) || DEFAULT_SETTINGS.contextLimitChars;
    const used = estimateContextChars(session?.messages || [], this.inputEl?.value || "", this.plugin.settings);
    const percent = Math.min(999, Math.round((used / limit) * 100));
    this.contextStatusEl.toggleClass("is-warning", percent >= 80);
    this.contextStatusEl.toggleClass("is-over", percent >= 100);
    this.contextStatusEl.setText(`${percent}%`);
    this.contextStatusEl.setAttr(
      "title",
      this.translate("view.contextTitle", {
        percent,
        used: formatCompactNumber(used),
        limit: formatCompactNumber(limit)
      })
    );
  }

  ensureActiveSession() {
    return this.sessionStore.ensureActiveSession();
  }

  createSession() {
    const session = this.sessionStore.createSession();
    this.persistChatSessions();
    return session;
  }

  getActiveSession() {
    return this.sessionStore.getActiveSession();
  }

  maybeNameSession(session, prompt) {
    this.sessionStore.maybeNameSession(session, prompt);
  }

  updateSessionSwitcher() {
    this.renderSessionSwitcher();
  }

  handleTurnFinished(session, result = {}) {
    if (session.id === this.activeSessionId) {
      const message = findLastAssistantMessage(session);
      if (result.final) {
        this.prepareTurnFeedback(session, result.status || "success");
      }
      if (this.hasActiveTransientFeedback(session)) {
        this.pendingRenderAfterTransient = true;
        return;
      }
      this.cancelPendingMessageRender();
      if (!this.renderMessageIfMounted(message)) {
        this.renderSessionIfActive(session);
      }
      return;
    }

    if (!result.final || session.currentRun) {
      return;
    }

    session.unreadTurnStatus = result.status || "success";
    session.hasUnreadCompletion = true;
    this.renderSessionSwitcher();
    this.persistSessionChange(session);
    const noticeKey = result.status === "failed"
      ? "notice.backgroundSessionFailed"
      : result.status === "stopped"
        ? "notice.backgroundSessionStopped"
        : "notice.backgroundSessionFinished";
    new Notice(this.translate(noticeKey, {
      title: session.title || this.translate("session.fallbackTitle")
    }));
  }

  prepareTurnFeedback(session, status) {
    const message = findLastAssistantMessage(session);
    if (!message) {
      return;
    }
    if (message.emotiveFeedback?.kind) {
      return;
    }
    const kind = status === "success" && message.emotiveCompletionKind
      ? message.emotiveCompletionKind
      : status === "failed"
      ? "error"
      : status === "stopped"
        ? "stopped"
        : "success";
    message.emotiveFeedback = {
      kind,
      label: this.getTurnStatusLabel(kind),
      play: true
    };
  }

  clearUnreadCompletion(session) {
    if (session?.hasUnreadCompletion || session?.unreadTurnStatus) {
      session.hasUnreadCompletion = false;
      session.unreadTurnStatus = "";
      return true;
    }
    return false;
  }

  async deleteSession(sessionId) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      return;
    }

    if (session.currentRun) {
      new Notice(this.translate("notice.stopBeforeDeleting"));
      return;
    }

    if (!window.confirm(this.translate("view.deleteSessionConfirm", { title: session.title }))) {
      return;
    }

    const pastedImagePaths = Array.isArray(session.pastedImagePaths) ? [...session.pastedImagePaths] : [];
    this.sessionStore.deleteSession(sessionId);
    await this.plugin.agent?.releaseDockSession?.(sessionId);
    await this.plugin.deletePastedImageCacheFiles(pastedImagePaths);
    await this.plugin.deletePersistedSession(sessionId);
    await this.persistChatSessions({ immediate: true });
    this.render();
  }

  cancelActiveSession() {
    const session = this.getActiveSession();
    if (!session?.currentRun) {
      return;
    }

    session.currentRun.abortController.abort();
  }

  cancelRunningSessions() {
    for (const session of this.sessions) {
      if (session.currentRun) {
        session.currentRun.abortController.abort();
      }
    }
  }

  renderSessionIfActive(session) {
    if (session.id === this.activeSessionId) {
      if (this.clearUnreadCompletion(session)) {
        this.persistChatSessions();
        this.renderSessionSwitcher();
      }
      if (this.hasActiveTransientFeedback(session)) {
        this.pendingRenderAfterTransient = true;
        return;
      }
      this.cancelPendingMessageRender();
      this.renderMessages();
    }
  }

  scheduleSessionRenderIfActive(session, message = null) {
    if (session.id !== this.activeSessionId) {
      return;
    }

    this.pendingMessageRenderSessionId = session.id;
    this.pendingMessageRenderTarget = message;
    if (this.pendingMessageRenderFrame !== null) {
      return;
    }

    this.pendingMessageRenderFrame = window.requestAnimationFrame(() => {
      this.pendingMessageRenderFrame = null;
      const renderSession = this.sessions.find((entry) => entry.id === this.pendingMessageRenderSessionId);
      const renderMessage = this.pendingMessageRenderTarget;
      this.pendingMessageRenderSessionId = "";
      this.pendingMessageRenderTarget = null;
      if (renderSession && renderSession.id === this.activeSessionId) {
        if (this.hasActiveTransientFeedback(renderSession)) {
          this.pendingRenderAfterTransient = true;
          return;
        }
        this.renderMessageIfMounted(renderMessage) || this.renderMessages();
      }
    });
  }

  renderMessageIfMounted(message) {
    if (!message) {
      return false;
    }

    const item = this.messageEls.get(message);
    if (!item || !item.isConnected) {
      return false;
    }

    const shouldScrollToBottom = this.isMessageListNearBottom();
    this.renderMessageItem(item, message);
    if (shouldScrollToBottom) {
      this.scrollMessagesToBottom();
    }
    this.updateContextStatus();
    return true;
  }

  hasActiveTransientFeedback(session) {
    return Boolean(session?.messages?.some((message) => this.isActiveTransientFeedback(message)));
  }

  isActiveTransientFeedback(message) {
    return Boolean(
      message?.role === "assistant"
      && message.emotiveFeedback?.kind
      && message.emotiveFeedback.played
      && message.emotiveFeedback.transient !== false
    );
  }

  renderMessageAfterTransientStatus(messageEl) {
    const message = messageEl ? this.messagesByEl?.get(messageEl) : null;
    if (!message) {
      return;
    }
    message.emotiveFeedback = null;
    window.requestAnimationFrame(() => {
      if (this.pendingRenderAfterTransient) {
        this.pendingRenderAfterTransient = false;
        this.renderMessages();
        return;
      }
      this.renderMessageIfMounted(message);
    });
  }

  isMessageListNearBottom() {
    if (!this.messageList) {
      return true;
    }

    const distanceFromBottom = this.messageList.scrollHeight
      - this.messageList.scrollTop
      - this.messageList.clientHeight;
    return distanceFromBottom <= this.autoScrollThresholdPx;
  }

  scrollMessagesToBottom() {
    if (this.messageList) {
      this.messageList.scrollTop = this.messageList.scrollHeight;
    }
  }

  keepMessagesPinnedToBottom(durationMs = 250) {
    this.keepScrollBottomUntil = Math.max(this.keepScrollBottomUntil, Date.now() + durationMs);
    this.scheduleScrollMessagesToBottom();
    window.setTimeout(() => this.scrollMessagesToBottomIfPinned(), Math.min(durationMs, 120));
  }

  scrollMessagesToBottomIfPinned() {
    if (Date.now() <= this.keepScrollBottomUntil) {
      this.scrollMessagesToBottom();
      this.scheduleScrollMessagesToBottom();
    }
  }

  scheduleScrollMessagesToBottom() {
    if (this.pendingScrollBottomFrame !== null) {
      return;
    }
    this.pendingScrollBottomFrame = window.requestAnimationFrame(() => {
      this.pendingScrollBottomFrame = null;
      if (Date.now() <= this.keepScrollBottomUntil) {
        this.scrollMessagesToBottom();
      }
    });
  }

  cancelPendingMessageRender() {
    if (this.pendingMessageRenderFrame === null) {
      return;
    }

    window.cancelAnimationFrame(this.pendingMessageRenderFrame);
    this.pendingMessageRenderFrame = null;
    this.pendingMessageRenderSessionId = "";
    this.pendingMessageRenderTarget = null;
    this.pendingRenderAfterTransient = false;
  }

  renderComposerIfActive(session, options = {}) {
    if (session.id === this.activeSessionId) {
      this.renderComposer(options);
    }
  }

  async loadPersistedSessions() {
    if (this.hasLoadedPersistedSessions) {
      return;
    }
    this.hasLoadedPersistedSessions = true;
    const state = await this.plugin.loadChatSessions();
    this.sessionStore.loadState(state);
  }

  persistSessionChange(session) {
    this.sessionStore.touchSession(session);
    this.persistChatSessions();
  }

  async persistChatSessions(options = {}) {
    const state = this.sessionStore.toState();
    if (options.immediate) {
      await this.plugin.saveChatSessions(state);
      return;
    }
    this.plugin.scheduleSaveChatSessions(state);
  }

  addGlobalPointerListener(listener) {
    if (this.globalPointerListeners.has(listener)) {
      return;
    }

    document.addEventListener("pointerdown", listener);
    this.globalPointerListeners.add(listener);
  }

  removeGlobalPointerListener(listener) {
    document.removeEventListener("pointerdown", listener);
    this.globalPointerListeners.delete(listener);
  }

  clearGlobalPointerListeners() {
    for (const listener of this.globalPointerListeners) {
      document.removeEventListener("pointerdown", listener);
    }
    this.globalPointerListeners.clear();
    this.affectPanelCloseListener = null;
  }
}

function findLastAssistantMessage(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return message;
    }
  }
  return null;
}

module.exports = {
  AgentDockView
};
