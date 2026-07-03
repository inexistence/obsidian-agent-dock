const { ItemView, MarkdownRenderer, Notice, setIcon } = require("obsidian");

const { VIEW_TYPE_AGENT_DOCK } = require("../constants");
const { t } = require("../i18n");
const { DEFAULT_SETTINGS } = require("../settings");
const { renderComposerContent } = require("./ComposerRenderer");
const { copyText } = require("./clipboard");
const { estimateContextChars, formatCompactNumber } = require("./contextEstimate");
const { MessageTimelineRenderer } = require("./MessageTimelineRenderer");
const {
  formatMentionToken,
  getMentionMatch,
  getParentPath,
  replaceObsidianOpenLinks
} = require("./mention");
const { renderSessionSwitcher } = require("./SessionSwitcherRenderer");
const { SessionStore } = require("./SessionStore");
const { appendTimelineContent } = require("./timeline");

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
      renderMarkdownContent: (containerEl, text) => this.renderMarkdownContent(containerEl, text)
    });
    this.messageEls = new WeakMap();
    this.pendingMessageRenderFrame = null;
    this.pendingMessageRenderSessionId = "";
    this.pendingMessageRenderTarget = null;
    this.globalPointerListeners = new Set();
    this.hasLoadedPersistedSessions = false;
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
    this.cancelRunningSessions();
    await this.plugin.flushChatSessions();
  }

  render() {
    this.cancelPendingMessageRender();
    this.clearGlobalPointerListeners();
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("codex-dock");

    const header = containerEl.createDiv({ cls: "codex-dock__header" });
    header.createDiv({ cls: "codex-dock__title", text: this.plugin.agent.label });

    const actions = header.createDiv({ cls: "codex-dock__actions" });
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
    this.renderMessages();

    const composer = containerEl.createDiv({ cls: "codex-dock__composer" });
    this.renderComposerContent(composer, this.getActiveSession()?.draft || "");
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
      handleMentionKeydown: (event) => this.handleMentionKeydown(event),
      replaceObsidianLinksInInput: () => this.replaceObsidianLinksInInput(),
      updateContextStatus: () => this.updateContextStatus(),
      updateMentionSuggestions: () => this.updateMentionSuggestions(),
      hideMentionSuggestions: () => this.hideMentionSuggestions(),
      onDraftChanged: (session) => this.persistSessionChange(session),
      submit: () => this.submit(),
      cancelActiveSession: () => this.cancelActiveSession(),
      translate: (key, params) => this.translate(key, params),
      addGlobalPointerListener: (listener) => this.addGlobalPointerListener(listener),
      removeGlobalPointerListener: (listener) => this.removeGlobalPointerListener(listener)
    });
    this.inputEl = refs.inputEl;
    this.mentionMenuEl = refs.mentionMenuEl;
    this.contextStatusEl = refs.contextStatusEl;
    this.mentionState = {
      active: false,
      start: -1,
      end: -1,
      selectedIndex: 0,
      suggestions: []
    };
    this.updateContextStatus();
  }

  renderMessages() {
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

    this.messageList.scrollTop = this.messageList.scrollHeight;
    this.updateContextStatus();
  }

  renderMessageItem(item, message) {
    item.empty();
    item.className = `codex-dock__message codex-dock__message--${message.role}`;
    item.createDiv({
      cls: "codex-dock__role",
      text: message.role === "user" ? this.translate("view.you") : this.plugin.agent.label
    });
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
  }

  handleMentionKeydown(event) {
    if (!this.mentionState?.active) {
      return false;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.mentionState.selectedIndex = Math.min(
        this.mentionState.selectedIndex + 1,
        this.mentionState.suggestions.length - 1
      );
      this.updateMentionSelection({ scrollIntoView: true });
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.mentionState.selectedIndex = Math.max(this.mentionState.selectedIndex - 1, 0);
      this.updateMentionSelection({ scrollIntoView: true });
      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      this.selectMentionSuggestion(this.mentionState.selectedIndex);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.hideMentionSuggestions();
      return true;
    }

    return false;
  }

  updateMentionSuggestions() {
    const match = getMentionMatch(this.inputEl.value, this.inputEl.selectionStart);
    if (!match) {
      this.hideMentionSuggestions();
      return;
    }

    const suggestions = this.getVaultPathSuggestions(match.query);
    if (suggestions.length === 0) {
      this.hideMentionSuggestions();
      return;
    }

    this.mentionState = {
      active: true,
      start: match.start,
      end: match.end,
      selectedIndex: 0,
      suggestions
    };
    this.renderMentionSuggestions();
  }

  getVaultPathSuggestions(query) {
    const normalizedQuery = query.toLowerCase();
    return this.app.vault.getAllLoadedFiles()
      .map((entry) => ({
        path: entry.path,
        name: entry.name || entry.path,
        folder: getParentPath(entry.path),
        kind: entry.children ? "folder" : "file"
      }))
      .filter((entry) => entry.path)
      .filter((entry) => {
        if (!normalizedQuery) {
          return true;
        }
        return entry.path.toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "file" ? -1 : 1;
        }
        return left.path.localeCompare(right.path);
      })
      .slice(0, 7);
  }

  renderMentionSuggestions() {
    if (!this.mentionMenuEl || !this.mentionState.active) {
      return;
    }

    this.mentionMenuEl.empty();
    this.mentionMenuEl.addClass("is-open");
    const list = this.mentionMenuEl.createDiv({ cls: "codex-dock__mention-list" });
    for (let index = 0; index < this.mentionState.suggestions.length; index += 1) {
      const suggestion = this.mentionState.suggestions[index];
      const option = list.createEl("button", {
        cls: `codex-dock__mention-option${index === this.mentionState.selectedIndex ? " is-selected" : ""}`,
        attr: {
          type: "button",
          title: suggestion.path
        }
      });
      const icon = option.createSpan({ cls: "codex-dock__mention-icon", attr: { "aria-hidden": "true" } });
      setIcon(icon, suggestion.kind === "folder" ? "folder" : "file-text");
      const text = option.createSpan({ cls: "codex-dock__mention-text" });
      text.createSpan({ cls: "codex-dock__mention-name", text: suggestion.name });
      text.createSpan({
        cls: "codex-dock__mention-path",
        text: suggestion.kind === "folder" ? this.translate("view.folder") : suggestion.folder || this.translate("view.vaultRoot")
      });
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.selectMentionSuggestion(index);
      });
      option.addEventListener("mouseenter", () => {
        if (this.mentionState.selectedIndex === index) {
          return;
        }
        this.mentionState.selectedIndex = index;
        this.updateMentionSelection();
      });
    }

    this.renderMentionPreview();
  }

  updateMentionSelection(options = {}) {
    if (!this.mentionMenuEl || !this.mentionState.active) {
      return;
    }

    const optionEls = this.mentionMenuEl.querySelectorAll(".codex-dock__mention-option");
    for (let index = 0; index < optionEls.length; index += 1) {
      const isSelected = index === this.mentionState.selectedIndex;
      optionEls[index].classList.toggle("is-selected", isSelected);
      if (isSelected && options.scrollIntoView) {
        optionEls[index].scrollIntoView({ block: "nearest" });
      }
    }
    this.renderMentionPreview();
  }

  renderMentionPreview() {
    if (!this.mentionMenuEl || !this.mentionState.active) {
      return;
    }

    this.mentionMenuEl.querySelector(".codex-dock__mention-preview")?.remove();
    const selected = this.mentionState.suggestions[this.mentionState.selectedIndex];
    if (selected) {
      const preview = this.mentionMenuEl.createDiv({ cls: "codex-dock__mention-preview" });
      const segments = selected.path.split("/");
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const row = preview.createDiv({
          cls: `codex-dock__mention-preview-row depth-${Math.min(index, 4)}`
        });
        const icon = row.createSpan({ cls: "codex-dock__mention-preview-icon", attr: { "aria-hidden": "true" } });
        setIcon(icon, index === segments.length - 1 && selected.kind === "file" ? "file-text" : "folder");
        row.createSpan({ cls: "codex-dock__mention-preview-name", text: segment });
      }
    }
  }

  selectMentionSuggestion(index) {
    const suggestion = this.mentionState?.suggestions[index];
    if (!suggestion) {
      return;
    }

    const value = this.inputEl.value;
    const mention = formatMentionToken(suggestion.path);
    const nextValue = `${value.slice(0, this.mentionState.start)}${mention} ${value.slice(this.mentionState.end)}`;
    const nextCursor = this.mentionState.start + mention.length + 1;
    this.inputEl.value = nextValue;
    this.inputEl.selectionStart = nextCursor;
    this.inputEl.selectionEnd = nextCursor;
    const session = this.getActiveSession();
    if (session) {
      session.draft = nextValue;
      this.persistSessionChange(session);
    }
    this.hideMentionSuggestions();
    this.updateContextStatus();
    this.inputEl.focus();
  }

  hideMentionSuggestions() {
    if (!this.mentionMenuEl) {
      return;
    }

    this.mentionState = {
      active: false,
      start: -1,
      end: -1,
      selectedIndex: 0,
      suggestions: []
    };
    this.mentionMenuEl.empty();
    this.mentionMenuEl.removeClass("is-open");
  }

  replaceObsidianLinksInInput() {
    const value = this.inputEl.value;
    const nextValue = replaceObsidianOpenLinks(value);
    if (nextValue === value) {
      return false;
    }

    const cursor = this.inputEl.selectionStart;
    const delta = nextValue.length - value.length;
    this.inputEl.value = nextValue;
    this.inputEl.selectionStart = Math.max(0, cursor + delta);
    this.inputEl.selectionEnd = this.inputEl.selectionStart;
    const session = this.getActiveSession();
    if (session) {
      session.draft = nextValue;
      this.persistSessionChange(session);
    }
    this.updateContextStatus();
    this.updateMentionSuggestions();
    return true;
  }

  async submit() {
    const session = this.ensureActiveSession();
    if (session.currentRun) {
      new Notice(this.translate("notice.agentStillWorking", { agent: this.plugin.agent.label }));
      return;
    }

    const prompt = this.inputEl.value.trim();
    if (!prompt) {
      return;
    }

    this.maybeNameSession(session, prompt);
    this.updateSessionSwitcher();
    this.inputEl.value = "";
    session.draft = "";
    this.sessionStore.touchSession(session);
    const now = Date.now();
    session.messages.push({
      role: "user",
      content: prompt,
      createdAt: now,
      timeline: [{ kind: "message", text: prompt }]
    });
    const assistantMessage = {
      role: "assistant",
      content: "",
      timeline: [],
      isLoading: true,
      createdAt: now
    };
    session.messages.push(assistantMessage);
    const run = {
      abortController: new AbortController(),
      assistantMessage
    };
    session.currentRun = run;
    this.renderMessages();
    this.renderComposer();
    this.persistChatSessions({ immediate: true });

    try {
      const conversation = session.messages.slice(0, -1);
      await this.plugin.runAgent(prompt, (update) => {
        if (assistantMessage.isComplete || session.currentRun !== run) {
          return;
        }

        if (update.kind === "content") {
          assistantMessage.content += update.text;
          appendTimelineContent(assistantMessage, update.text);
        } else {
          assistantMessage.timeline.push(update);
        }
        this.scheduleSessionRenderIfActive(session, assistantMessage);
      }, conversation, {
        signal: run.abortController.signal,
        sessionId: session.id
      });

      assistantMessage.isLoading = false;
      assistantMessage.isComplete = true;
      if (!assistantMessage.content.trim()) {
        const emptyText = this.translate("view.agentFinishedEmpty", { agent: this.plugin.agent.label });
        assistantMessage.content = emptyText;
        appendTimelineContent(assistantMessage, emptyText);
      }
      this.sessionStore.touchSession(session);
      this.renderSessionIfActive(session);
    } catch (error) {
      assistantMessage.isLoading = false;
      assistantMessage.isComplete = true;
      const errorText = error.name === "AbortError"
        ? this.translate("view.agentStopped", { agent: this.plugin.agent.label })
        : [
            this.translate("view.agentRunFailed", { agent: this.plugin.agent.label }),
            "",
            error.message,
            "",
            this.translate("view.agentRunFailedHint")
          ].join("\n");
      assistantMessage.content = errorText;
      appendTimelineContent(assistantMessage, errorText);
      this.sessionStore.touchSession(session);
      this.renderSessionIfActive(session);
      if (error.name === "AbortError") {
        new Notice(this.translate("notice.agentStopped", { agent: this.plugin.agent.label }));
      } else {
        new Notice(this.translate("notice.agentCommandFailed", { agent: this.plugin.agent.label }));
      }
    } finally {
      if (session.currentRun === run) {
        session.currentRun = null;
      }
      this.renderSessionIfActive(session);
      this.renderComposerIfActive(session);
      await this.persistChatSessions({ immediate: true });
    }
  }

  renderComposer() {
    const composer = this.containerEl.querySelector(".codex-dock__composer");
    if (!composer) {
      return;
    }

    const draft = this.inputEl?.value || "";
    composer.empty();
    this.renderComposerContent(composer, draft);
  }

  renderTimeline(containerEl, message) {
    this.timelineRenderer.renderTimeline(containerEl, message);
  }

  renderMarkdownContent(containerEl, text) {
    const contentEl = containerEl.createDiv({ cls: "codex-dock__content markdown-rendered" });
    const copyButton = contentEl.createEl("button", {
      cls: "codex-dock__copy-button",
      text: this.translate("view.copy"),
      attr: {
        type: "button",
        "aria-label": this.translate("view.copyMessageText"),
        title: this.translate("view.copyMessageText")
      }
    });
    copyButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await copyText(text || "");
      copyButton.setText(this.translate("view.copied"));
      window.setTimeout(() => copyButton.setText(this.translate("view.copy")), 1200);
    });

    const markdownEl = contentEl.createDiv({ cls: "codex-dock__content-body" });
    const sourcePath = this.app.workspace.getActiveFile()?.path || "";
    MarkdownRenderer.render(this.app, text || "", markdownEl, sourcePath, this).catch(() => {
      markdownEl.setText(text || "");
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

    this.renderMessageItem(item, message);
    this.messageList.scrollTop = this.messageList.scrollHeight;
    this.updateContextStatus();
    return true;
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

  renderComposerIfActive(session) {
    if (session.id === this.activeSessionId) {
      this.renderComposer();
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
  }
}

module.exports = {
  AgentDockView
};
