const { ItemView, MarkdownRenderer, Notice, setIcon } = require("obsidian");

const { VIEW_TYPE_AGENT_DOCK } = require("../constants");
const { t } = require("../i18n");
const { DEFAULT_SETTINGS } = require("../settings");
const { AGENT_OPTIONS } = require("../agents/AgentRegistry");
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
      copyText: (text) => copyText(text)
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
    this.pendingMessageRenderFrame = null;
    this.pendingMessageRenderSessionId = "";
    this.pendingMessageRenderTarget = null;
    this.affectPanelCloseListener = null;
    this.affectChangeAnimationTimer = null;
    this.affectChangeAnimationFrame = null;
    this.globalPointerListeners = new Set();
    this.hasLoadedPersistedSessions = false;
    this.autoScrollThresholdPx = 48;
    this.keepScrollBottomUntil = 0;
    this.pendingScrollBottomFrame = null;
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
    this.cancelPendingMessageRender();
    this.clearGlobalPointerListeners();
    this.clearAffectChangeAnimation();
    this.cancelRunningSessions();
    await this.plugin.flushChatSessions();
  }

  render(options = {}) {
    this.cancelPendingMessageRender();
    this.clearGlobalPointerListeners();
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
    this.scrollMessagesToBottom();
    this.updateContextStatus();
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
      onDraftChanged: (session) => this.persistSessionChange(session),
      handleReferenceDrop: (dataTransfer) => this.referenceController.handleReferenceDrop(dataTransfer),
      queuedPrompts: ensurePromptQueue(this.getActiveSession()),
      onClearQueuedPrompts: () => this.clearQueuedPrompts(),
      onRemoveQueuedPrompt: (queuedPromptId) => this.removeQueuedPrompt(queuedPromptId),
      onEditQueuedPrompt: (queuedPromptId) => this.editQueuedPrompt(queuedPromptId),
      submit: () => this.submit(),
      cancelActiveSession: () => this.cancelActiveSession(),
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

  renderMessages(options = {}) {
    const shouldScrollToBottom = options.forceScrollToBottom || this.isMessageListNearBottom();
    const previousScrollTop = this.messageList.scrollTop;
    this.messageList.empty();
    this.messageEls = new WeakMap();
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
    item.className = `codex-dock__message codex-dock__message--${message.role}`;
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
    if (message.isLoading) {
      const loading = item.createDiv({ cls: "codex-dock__loading" });
      const dots = loading.createSpan({ cls: "codex-dock__loading-dots", attr: { "aria-hidden": "true" } });
      dots.createSpan();
      dots.createSpan();
      dots.createSpan();
    }
    this.renderMessageFooter(item, message);
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

  renderMessageFooter(item, message) {
    const displayTime = formatMessageTime(message.createdAt, {
      language: this.plugin.settings.language,
      now: Date.now()
    });
    const copySource = message.content || "";
    if (!displayTime && !copySource) {
      return;
    }

    const footer = item.createDiv({ cls: "codex-dock__message-footer" });
    const title = formatMessageTimeTitle(message.createdAt, {
      language: this.plugin.settings.language
    });
    const iso = formatMessageTimeIso(message.createdAt);
    const attr = { title: title || displayTime };
    if (iso) {
      attr.datetime = iso;
    }
    if (displayTime) {
      footer.createEl("time", {
        cls: "codex-dock__message-time",
        text: displayTime,
        attr
      });
    }
    if (copySource) {
      this.renderMessageCopyButton(footer, copySource);
    }
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
        const affectShift = this.describeCurrentTurnAffectShift(prompt);
        if (affectShift) {
          this.insertAffectShiftMessageBeforeAssistant(targetSession, assistantMessage, affectShift);
          this.renderAffectIndicator({ changed: true, turnAffect: affectShift.affect });
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
      onTurnFinished: (targetSession) => this.renderSessionIfActive(targetSession),
      onComposerChanged: (targetSession) => this.renderComposerIfActive(targetSession),
      updateWorkingAffect: async (turn) => {
        await this.plugin.updateWorkingAffect(turn);
        this.renderAffectIndicator();
      },
      persistChatSessions: (options) => this.persistChatSessions(options),
      notify: (noticeKey) => {
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
        && document.activeElement === this.inputEl
      )
    );
    const draft = this.getActiveSession()?.draft || "";
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

  renderAffectIndicator(options = {}) {
    if (!this.affectIndicatorEl) {
      return;
    }

    this.clearAffectPanelCloseListener();
    this.affectIndicatorEl.empty();
    const affect = options.turnAffect || this.plugin.getWorkingAffect();
    if (!this.plugin.settings.affectShowIndicator || !affect) {
      this.affectIndicatorEl.addClass("is-empty");
      return;
    }
    this.affectIndicatorEl.removeClass("is-empty");

    const label = this.getAffectLabel(affect.label);
    const strength = this.getAffectStrengthLabel(affect.strength);
    const age = this.formatAffectAge(affect.ageMinutes);
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
    panel.createDiv({ cls: "codex-dock__affect-panel-title", text: this.translate("affect.panelTitle") });
    this.renderAffectRow(panel, "affect.row.tone", label);
    this.renderAffectRow(panel, "affect.row.warmth", this.getAffectLevelLabel(affect.warmth));
    this.renderAffectRow(panel, "affect.row.focus", this.getAffectLevelLabel(affect.focus));
    this.renderAffectRow(panel, "affect.row.tension", this.getAffectLevelLabel(affect.tension));
    this.renderAffectRow(panel, "affect.row.continuity", strength);
    this.renderAffectRow(panel, "affect.row.updated", age);
    panel.createDiv({ cls: "codex-dock__affect-note", text: this.translate("affect.boundary") });

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

  describeAffectShift(previousAffect, nextAffect) {
    if (!this.plugin.settings.affectEnabled || !this.plugin.settings.affectCrossSessionEnabled || !nextAffect) {
      return null;
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
      return null;
    }

    return {
      label: this.getAffectLabel(nextLabel),
      strength: this.getAffectStrengthLabel(nextAffect.strength)
    };
  }

  describeCurrentTurnAffectShift(prompt) {
    const currentAffect = this.plugin.getWorkingAffect();
    const promptAffect = this.plugin.getPromptWorkingAffect(prompt);
    if (!promptAffect?.transient) {
      return null;
    }

    const previousLabel = currentAffect?.label || "";
    const nextLabel = promptAffect.label || "";
    const initialShift = !previousLabel && nextLabel && nextLabel !== "steady";
    const shift = this.describeAffectShift(currentAffect, promptAffect);
    if (!shift && !initialShift) {
      return null;
    }

    return {
      label: this.getAffectLabel(nextLabel),
      strength: this.getAffectStrengthLabel(promptAffect.strength),
      affect: promptAffect
    };
  }

  insertAffectShiftMessageBeforeAssistant(session, assistantMessage, affectShift) {
    if (!session || !assistantMessage || !affectShift) {
      return;
    }

    const message = {
      role: "system",
      kind: "affect_shift",
      content: this.translate("affect.shiftNotice", affectShift),
      timeline: [],
      createdAt: Date.now(),
      isComplete: true,
      isLoading: false,
      animateOnRender: session.id === this.activeSessionId
    };
    const assistantIndex = session.messages.indexOf(assistantMessage);
    if (assistantIndex === -1) {
      session.messages.push(message);
    } else {
      session.messages.splice(assistantIndex, 0, message);
    }
    this.sessionStore.touchSession(session);
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

  getAffectLabel(label) {
    const key = `affect.label.${label || "steady"}`;
    const translated = this.translate(key);
    return translated === key ? this.translate("affect.label.steady") : translated;
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

  renderMarkdownContent(containerEl, text) {
    const contentEl = containerEl.createDiv({ cls: "codex-dock__content markdown-rendered" });
    const markdownEl = contentEl.createDiv({ cls: "codex-dock__content-body" });
    const sourcePath = this.app.workspace.getActiveFile()?.path || "";
    const renderText = normalizeLocalFileMarkdownLinks(text || "");
    MarkdownRenderer.render(this.app, renderText, markdownEl, sourcePath, this).then(() => {
      decorateLocalFileLinks(markdownEl, this.app, {
        onOpenFailed: ({ vaultPath }) => {
          new Notice(this.translate("notice.openFileLinkFailed", { path: vaultPath }));
        }
      });
      this.scrollMessagesToBottomIfPinned();
    }).catch(() => {
      markdownEl.setText(text || "");
      this.scrollMessagesToBottomIfPinned();
    });
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

    this.sessionStore.deleteSession(sessionId);
    await this.plugin.agent?.releaseDockSession?.(sessionId);
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

module.exports = {
  AgentDockView
};
