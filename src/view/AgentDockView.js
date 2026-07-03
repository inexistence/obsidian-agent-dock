const { ItemView, MarkdownRenderer, Notice, setIcon } = require("obsidian");

const { VIEW_TYPE_AGENT_DOCK } = require("../constants");
const { MODE_OPTIONS, getModeDescription } = require("../modes");
const { DEFAULT_SETTINGS } = require("../settings");
const {
  appendTimelineContent,
  getCompletedTimelineSections,
  getEventGroupLabel,
  groupLiveTimeline,
  groupProcessedEntries,
  shouldShowEvent
} = require("./timeline");

class AgentDockView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.sessions = [];
    this.activeSessionId = "";
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

  async onOpen() {
    this.ensureActiveSession();
    this.render();
  }

  async onClose() {
    this.cancelRunningSessions();
  }

  render() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("codex-dock");

    const header = containerEl.createDiv({ cls: "codex-dock__header" });
    header.createDiv({ cls: "codex-dock__title", text: this.plugin.agent.label });

    const actions = header.createDiv({ cls: "codex-dock__actions" });
    const terminalButton = actions.createEl("button", {
      cls: "codex-dock__icon-button",
      attr: { "aria-label": "Open interactive agent in Terminal", title: "Open interactive agent in Terminal" }
    });
    terminalButton.setText("Terminal");
    terminalButton.addEventListener("click", async () => {
      try {
        await this.plugin.openInteractiveAgent();
      } catch (error) {
        new Notice(`Could not open Terminal: ${error.message}`);
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

    this.sessionBarEl.empty();
    const activeSession = this.ensureActiveSession();
    const switcher = this.sessionBarEl.createEl("details", { cls: "codex-dock__conversation-switcher" });
    const summary = switcher.createEl("summary", {
      cls: "codex-dock__conversation-summary",
      attr: {
        "aria-label": "Switch conversation",
        title: "Switch conversation"
      }
    });
    summary.createSpan({ cls: "codex-dock__conversation-title", text: activeSession.title });
    const chevron = summary.createSpan({ cls: "codex-dock__conversation-chevron", attr: { "aria-hidden": "true" } });
    setIcon(chevron, "chevron-down");

    const menu = switcher.createDiv({ cls: "codex-dock__conversation-menu" });
    menu.createDiv({ cls: "codex-dock__conversation-menu-title", text: "Conversations" });
    const list = menu.createDiv({ cls: "codex-dock__conversation-list" });
    for (const session of this.sessions) {
      const item = list.createDiv({
        cls: `codex-dock__conversation-item${session.id === this.activeSessionId ? " is-active" : ""}`
      });
      const switchButton = item.createEl("button", {
        cls: "codex-dock__conversation-item-main",
        attr: {
          type: "button",
          title: session.title
        }
      });
      const check = switchButton.createSpan({ cls: "codex-dock__conversation-check", attr: { "aria-hidden": "true" } });
      if (session.id === this.activeSessionId) {
        setIcon(check, "check");
      }
      switchButton.createSpan({ cls: "codex-dock__conversation-item-title", text: session.title });
      switchButton.addEventListener("click", () => {
        this.activeSessionId = session.id;
        switcher.removeAttribute("open");
        this.render();
      });

      const deleteButton = item.createEl("button", {
        cls: "codex-dock__conversation-delete",
        attr: {
          type: "button",
          "aria-label": `Delete ${session.title}`,
          title: "Delete conversation"
        }
      });
      setIcon(deleteButton, "trash-2");
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.deleteSession(session.id);
      });
    }

    const newSessionButton = this.sessionBarEl.createEl("button", {
      cls: "codex-dock__conversation-new",
      attr: {
        type: "button",
        "aria-label": "New conversation",
        title: "New conversation"
      }
    });
    setIcon(newSessionButton, "plus");
    newSessionButton.addEventListener("click", () => {
      this.createSession();
      this.render();
    });

    const closeConversationMenu = (event) => {
      if (!switcher.contains(event.target)) {
        switcher.removeAttribute("open");
        document.removeEventListener("pointerdown", closeConversationMenu);
      }
    };
    switcher.addEventListener("toggle", () => {
      if (switcher.open) {
        window.setTimeout(() => document.addEventListener("pointerdown", closeConversationMenu), 0);
      } else {
        document.removeEventListener("pointerdown", closeConversationMenu);
      }
    });
  }

  renderComposerContent(composer, draft) {
    const shell = composer.createDiv({ cls: "codex-dock__composer-shell" });
    this.inputEl = shell.createEl("textarea", {
      cls: "codex-dock__input",
      attr: {
        rows: "4",
        placeholder: "Ask the agent about this vault or the active note..."
      }
    });
    this.inputEl.value = draft || "";
    this.mentionMenuEl = shell.createDiv({ cls: "codex-dock__mention-menu" });
    this.mentionState = {
      active: false,
      start: -1,
      end: -1,
      selectedIndex: 0,
      suggestions: []
    };

    this.inputEl.addEventListener("keydown", (event) => {
      if (this.handleMentionKeydown(event)) {
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.submit();
      }
    });
    this.inputEl.addEventListener("input", () => {
      if (this.replaceObsidianLinksInInput()) {
        return;
      }
      const session = this.getActiveSession();
      if (session) {
        session.draft = this.inputEl.value;
      }
      this.updateContextStatus();
      this.updateMentionSuggestions();
    });
    this.inputEl.addEventListener("click", () => this.updateMentionSuggestions());
    this.inputEl.addEventListener("blur", () => {
      window.setTimeout(() => this.hideMentionSuggestions(), 120);
    });
    this.inputEl.addEventListener("paste", () => {
      window.setTimeout(() => this.replaceObsidianLinksInInput(), 0);
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
    activeNoteButton.toggleClass("is-active", this.plugin.settings.includeActiveNote);
    activeNoteButton.addEventListener("click", async () => {
      this.plugin.settings.includeActiveNote = !this.plugin.settings.includeActiveNote;
      activeNoteButton.toggleClass("is-active", this.plugin.settings.includeActiveNote);
      await this.plugin.saveSettings();
      this.updateContextStatus();
    });

    const modePill = leftTools.createEl("details", { cls: "codex-dock__mode-pill" });
    const modeSummary = modePill.createEl("summary", {
      cls: "codex-dock__mode-summary",
      attr: {
        "aria-label": "Mode",
        title: getModeDescription(this.plugin.settings.mode, DEFAULT_SETTINGS.mode)
      }
    });
    const modeIcon = modeSummary.createSpan({ cls: "codex-dock__mode-icon", attr: { "aria-hidden": "true" } });
    setIcon(modeIcon, "shield");
    const modeLabel = modeSummary.createSpan({
      cls: "codex-dock__mode-label",
      text: getModeLabel(this.plugin.settings.mode)
    });
    const modeChevron = modeSummary.createSpan({ cls: "codex-dock__mode-chevron", attr: { "aria-hidden": "true" } });
    setIcon(modeChevron, "chevron-down");

    const modeMenu = modePill.createDiv({ cls: "codex-dock__mode-menu", attr: { role: "menu" } });
    const closeModeMenu = (event) => {
      if (!modePill.contains(event.target)) {
        modePill.removeAttribute("open");
        document.removeEventListener("pointerdown", closeModeMenu);
      }
    };
    modePill.addEventListener("toggle", () => {
      if (modePill.open) {
        window.setTimeout(() => document.addEventListener("pointerdown", closeModeMenu), 0);
      } else {
        document.removeEventListener("pointerdown", closeModeMenu);
      }
    });
    for (const [value, option] of Object.entries(MODE_OPTIONS)) {
      const optionButton = modeMenu.createEl("button", {
        cls: "codex-dock__mode-option",
        text: option.label,
        attr: {
          type: "button",
          role: "menuitemradio",
          "aria-checked": String(value === this.plugin.settings.mode),
          title: option.description
        }
      });
      optionButton.toggleClass("is-selected", value === this.plugin.settings.mode);
      optionButton.addEventListener("click", async () => {
        this.plugin.settings.mode = value;
        modeLabel.setText(option.label);
        modeSummary.setAttr("title", option.description);
        for (const button of modeMenu.querySelectorAll(".codex-dock__mode-option")) {
          const isSelected = button === optionButton;
          button.classList.toggle("is-selected", isSelected);
          button.setAttribute("aria-checked", String(isSelected));
        }
        modePill.removeAttribute("open");
        await this.plugin.saveSettings();
        this.updateContextStatus();
      });
    }

    const rightTools = composerBar.createDiv({ cls: "codex-dock__composer-status" });
    this.contextStatusEl = rightTools.createDiv({ cls: "codex-dock__context-status" });
    this.updateContextStatus();

    const sendButton = rightTools.createEl("button", {
      cls: "codex-dock__send",
      attr: { type: "button" }
    });
    if (this.getActiveSession()?.currentRun) {
      sendButton.setAttr("aria-label", "Stop agent");
      sendButton.setAttr("title", "Stop agent");
      setIcon(sendButton, "square");
      sendButton.addEventListener("click", () => this.cancelActiveSession());
    } else {
      sendButton.setAttr("aria-label", "Send message");
      sendButton.setAttr("title", "Send message");
      setIcon(sendButton, "arrow-up");
      sendButton.addEventListener("click", () => this.submit());
    }
  }

  renderMessages() {
    this.messageList.empty();
    const session = this.ensureActiveSession();
    const messages = session.messages;

    if (messages.length === 0) {
      const empty = this.messageList.createDiv({ cls: "codex-dock__empty" });
      empty.createDiv({ text: "Open a side conversation with an agent." });
      empty.createDiv({ text: "The active note can be included automatically." });
      this.updateContextStatus();
      return;
    }

    for (const message of messages) {
      const item = this.messageList.createDiv({
        cls: `codex-dock__message codex-dock__message--${message.role}`
      });
      item.createDiv({
        cls: "codex-dock__role",
        text: message.role === "user" ? "You" : this.plugin.agent.label
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

    this.messageList.scrollTop = this.messageList.scrollHeight;
    this.updateContextStatus();
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
      this.renderMentionSuggestions();
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.mentionState.selectedIndex = Math.max(this.mentionState.selectedIndex - 1, 0);
      this.renderMentionSuggestions();
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
        text: suggestion.kind === "folder" ? "Folder" : suggestion.folder || "Vault root"
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
        this.renderMentionSuggestions();
      });
    }

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
    }
    this.updateContextStatus();
    this.updateMentionSuggestions();
    return true;
  }

  async submit() {
    const session = this.ensureActiveSession();
    if (session.currentRun) {
      new Notice(`${this.plugin.agent.label} is still working in this conversation.`);
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
    session.messages.push({
      role: "user",
      content: prompt,
      timeline: [{ kind: "message", text: prompt }]
    });
    const assistantMessage = { role: "assistant", content: "", timeline: [], isLoading: true };
    session.messages.push(assistantMessage);
    const run = {
      abortController: new AbortController(),
      assistantMessage
    };
    session.currentRun = run;
    this.renderMessages();
    this.renderComposer();

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
        this.renderSessionIfActive(session);
      }, conversation, { signal: run.abortController.signal });

      assistantMessage.isLoading = false;
      assistantMessage.isComplete = true;
      if (!assistantMessage.content.trim()) {
        const emptyText = `(${this.plugin.agent.label} finished without text output.)`;
        assistantMessage.content = emptyText;
        appendTimelineContent(assistantMessage, emptyText);
      }
      this.renderSessionIfActive(session);
    } catch (error) {
      assistantMessage.isLoading = false;
      assistantMessage.isComplete = true;
      const errorText = error.name === "AbortError"
        ? `(${this.plugin.agent.label} stopped.)`
        : [
            `${this.plugin.agent.label} could not run.`,
            "",
            error.message,
            "",
            "Check the executable path in plugin settings and make sure the CLI is installed and allowed by macOS."
          ].join("\n");
      assistantMessage.content = errorText;
      appendTimelineContent(assistantMessage, errorText);
      this.renderSessionIfActive(session);
      if (error.name === "AbortError") {
        new Notice(`${this.plugin.agent.label} stopped.`);
      } else {
        new Notice(`${this.plugin.agent.label} command failed.`);
      }
    } finally {
      if (session.currentRun === run) {
        session.currentRun = null;
      }
      this.renderSessionIfActive(session);
      this.renderComposerIfActive(session);
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
    if (message.role !== "assistant") {
      for (const entry of message.timeline) {
        this.renderTimelineEntry(containerEl, entry);
      }
      return;
    }

    if (message.isComplete) {
      this.renderCompletedTimeline(containerEl, message.timeline);
      return;
    }

    for (const group of groupLiveTimeline(message.timeline, this.plugin.settings.debugActivity)) {
      if (group.type === "eventGroup") {
        this.renderEventGroup(containerEl, group.entries, group.label, false);
      } else {
        this.renderTimelineEntry(containerEl, group.entry);
      }
    }
  }

  renderCompletedTimeline(containerEl, timeline) {
    const { processedEntries, finalEntry } = getCompletedTimelineSections(
      timeline,
      this.plugin.settings.debugActivity
    );

    if (processedEntries.length > 0) {
      this.renderProcessedGroup(containerEl, processedEntries);
    }

    if (finalEntry) {
      this.renderTimelineEntry(containerEl, finalEntry);
    }
  }

  renderProcessedGroup(containerEl, entries) {
    if (entries.length === 0) {
      return;
    }

    const details = containerEl.createEl("details", {
      cls: "codex-dock__event-group codex-dock__event-group--processed"
    });
    details.open = false;
    details.createEl("summary", {
      cls: "codex-dock__event-group-summary",
      text: `已处理 ${entries.length} 项`
    });

    const body = details.createDiv({ cls: "codex-dock__event-group-body" });
    for (const group of groupProcessedEntries(entries)) {
      if (group.type === "eventGroup") {
        this.renderEventGroup(body, group.entries, getEventGroupLabel(group.entries), false);
      } else {
        this.renderTimelineEntry(body, group.entry);
      }
    }
  }

  renderEventGroup(containerEl, entries, label, open) {
    const details = containerEl.createEl("details", {
      cls: "codex-dock__event-group"
    });
    details.open = open;
    details.createEl("summary", {
      cls: "codex-dock__event-group-summary",
      text: label
    });

    const body = details.createDiv({ cls: "codex-dock__event-group-body" });
    for (const entry of entries) {
      this.renderTimelineEntry(body, entry, { forceDetail: this.plugin.settings.debugActivity });
    }
  }

  renderTimelineEntry(containerEl, entry) {
    if (entry.kind === "message" || entry.kind === "content") {
      this.renderMarkdownContent(containerEl, entry.text);
      return;
    }

    if (!this.shouldShowEvent(entry)) {
      return;
    }

    const eventEl = containerEl.createDiv({ cls: `codex-dock__event codex-dock__event--${entry.kind || "activity"}` });
    eventEl.createDiv({ cls: "codex-dock__event-title", text: entry.title || "Event" });
    if (entry.summary && !this.plugin.settings.debugActivity) {
      eventEl.createDiv({ cls: "codex-dock__event-summary", text: entry.summary });
    }
    if (entry.detail && this.plugin.settings.debugActivity) {
      eventEl.createEl("pre", { cls: "codex-dock__event-detail", text: entry.detail });
    }
  }

  renderMarkdownContent(containerEl, text) {
    const contentEl = containerEl.createDiv({ cls: "codex-dock__content markdown-rendered" });
    const copyButton = contentEl.createEl("button", {
      cls: "codex-dock__copy-button",
      text: "Copy",
      attr: {
        type: "button",
        "aria-label": "Copy message text",
        title: "Copy message text"
      }
    });
    copyButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await copyText(text || "");
      copyButton.setText("Copied");
      window.setTimeout(() => copyButton.setText("Copy"), 1200);
    });

    const markdownEl = contentEl.createDiv({ cls: "codex-dock__content-body" });
    const sourcePath = this.app.workspace.getActiveFile()?.path || "";
    MarkdownRenderer.render(this.app, text || "", markdownEl, sourcePath, this).catch(() => {
      markdownEl.setText(text || "");
    });
  }

  shouldShowEvent(entry) {
    return shouldShowEvent(entry, this.plugin.settings.debugActivity);
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
      `Context ${percent}% · ${formatCompactNumber(used)} / ${formatCompactNumber(limit)} chars`
    );
  }

  ensureActiveSession() {
    if (this.sessions.length === 0) {
      return this.createSession();
    }

    const existing = this.getActiveSession();
    if (existing) {
      return existing;
    }

    this.activeSessionId = this.sessions[0].id;
    return this.sessions[0];
  }

  createSession() {
    const session = {
      id: `session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: `Chat ${this.sessions.length + 1}`,
      isUntitled: true,
      currentRun: null,
      draft: "",
      messages: []
    };
    this.sessions.push(session);
    this.activeSessionId = session.id;
    return session;
  }

  getActiveSession() {
    return this.sessions.find((session) => session.id === this.activeSessionId) || null;
  }

  maybeNameSession(session, prompt) {
    if (!session.isUntitled) {
      return;
    }

    const compact = prompt.replace(/\s+/g, " ").trim();
    session.title = compact.length > 28 ? `${compact.slice(0, 28)}...` : compact || session.title;
    session.isUntitled = false;
  }

  updateSessionSwitcher() {
    this.renderSessionSwitcher();
  }

  deleteSession(sessionId) {
    const session = this.sessions.find((entry) => entry.id === sessionId);
    if (!session) {
      return;
    }

    if (session.currentRun) {
      new Notice("Stop this conversation before deleting it.");
      return;
    }

    if (!window.confirm(`Delete "${session.title}"?`)) {
      return;
    }

    const deletedIndex = this.sessions.findIndex((entry) => entry.id === sessionId);
    this.sessions.splice(deletedIndex, 1);

    if (this.sessions.length === 0) {
      this.createSession();
    } else if (this.activeSessionId === sessionId) {
      const nextIndex = Math.min(deletedIndex, this.sessions.length - 1);
      this.activeSessionId = this.sessions[nextIndex].id;
    }

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
      this.renderMessages();
    }
  }

  renderComposerIfActive(session) {
    if (session.id === this.activeSessionId) {
      this.renderComposer();
    }
  }
}

function estimateContextChars(messages, draft, settings) {
  const transcriptChars = messages.reduce((total, message) => {
    return total + String(message.content || "").length + 16;
  }, 0);
  const draftChars = String(draft || "").length + 16;
  const noteChars = settings.includeActiveNote
    ? (Number(settings.activeNoteMaxChars) || DEFAULT_SETTINGS.activeNoteMaxChars)
    : 0;
  return transcriptChars + draftChars + noteChars;
}

function formatCompactNumber(value) {
  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  return String(value);
}

function getModeLabel(mode) {
  return (MODE_OPTIONS[mode] || MODE_OPTIONS[DEFAULT_SETTINGS.mode]).label;
}

function getMentionMatch(value, cursor) {
  const beforeCursor = value.slice(0, cursor);
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCursor);
  if (!match) {
    return null;
  }

  const start = beforeCursor.length - match[2].length - 1;
  return {
    start,
    end: cursor,
    query: match[2]
  };
}

function formatMentionToken(path) {
  return /\s/.test(path) ? `@"${path.replace(/"/g, "\\\"")}"` : `@${path}`;
}

function getParentPath(path) {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function replaceObsidianOpenLinks(value) {
  return value.replace(/obsidian:\/\/open\?[^\s<>"']+/g, (url) => {
    const filePath = extractObsidianOpenFilePath(url);
    return filePath ? formatMentionToken(filePath) : url;
  });
}

function extractObsidianOpenFilePath(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "obsidian:" || parsed.hostname !== "open") {
      return "";
    }
    return parsed.searchParams.get("file") || "";
  } catch {
    return "";
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

module.exports = {
  AgentDockView
};
