const { ItemView, MarkdownRenderer, Notice } = require("obsidian");

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

    const clearButton = actions.createEl("button", {
      cls: "codex-dock__icon-button",
      attr: { "aria-label": "Clear conversation", title: "Clear conversation" }
    });
    clearButton.setText("Clear");
    clearButton.addEventListener("click", () => {
      const session = this.getActiveSession();
      if (session?.currentRun) {
        new Notice(`${this.plugin.agent.label} is still working in this conversation.`);
        return;
      }
      if (session) {
        session.messages = [];
        this.renderMessages();
      }
    });

    const sessionBar = containerEl.createDiv({ cls: "codex-dock__session-bar" });
    this.sessionSelectEl = sessionBar.createEl("select", {
      cls: "codex-dock__session-select",
      attr: { "aria-label": "Conversation" }
    });
    this.sessionSelectEl.addEventListener("change", () => {
      this.activeSessionId = this.sessionSelectEl.value;
      this.render();
    });

    const newSessionButton = sessionBar.createEl("button", {
      cls: "codex-dock__icon-button",
      attr: { type: "button", "aria-label": "New conversation", title: "New conversation" }
    });
    newSessionButton.setText("New");
    newSessionButton.addEventListener("click", () => {
      this.createSession();
      this.render();
    });
    this.updateSessionSelectOptions();

    this.messageList = containerEl.createDiv({ cls: "codex-dock__messages" });
    this.renderMessages();

    const composer = containerEl.createDiv({ cls: "codex-dock__composer" });
    this.renderComposerContent(composer, this.getActiveSession()?.draft || "");
  }

  renderComposerContent(composer, draft) {
    this.inputEl = composer.createEl("textarea", {
      cls: "codex-dock__input",
      attr: {
        rows: "4",
        placeholder: "Ask the agent about this vault or the active note..."
      }
    });
    this.inputEl.value = draft || "";

    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.submit();
      }
    });
    this.inputEl.addEventListener("input", () => {
      const session = this.getActiveSession();
      if (session) {
        session.draft = this.inputEl.value;
      }
      this.updateContextStatus();
    });

    const modeRow = composer.createDiv({ cls: "codex-dock__mode-row" });
    modeRow.createEl("label", {
      cls: "codex-dock__mode-label",
      text: "Mode",
      attr: { for: "codex-dock-mode" }
    });
    const modeSelect = modeRow.createEl("select", {
      cls: "codex-dock__mode-select",
      attr: { id: "codex-dock-mode" }
    });

    for (const [value, option] of Object.entries(MODE_OPTIONS)) {
      modeSelect.createEl("option", {
        text: option.label,
        value
      });
    }

    modeSelect.value = this.plugin.settings.mode;
    const modeHint = composer.createDiv({
      cls: "codex-dock__mode-hint",
      text: getModeDescription(this.plugin.settings.mode, DEFAULT_SETTINGS.mode)
    });

    modeSelect.addEventListener("change", async () => {
      this.plugin.settings.mode = modeSelect.value;
      modeHint.setText(getModeDescription(this.plugin.settings.mode, DEFAULT_SETTINGS.mode));
      await this.plugin.saveSettings();
      this.updateContextStatus();
    });

    this.contextStatusEl = composer.createDiv({ cls: "codex-dock__context-status" });
    this.updateContextStatus();

    const sendButton = composer.createEl("button", { cls: "mod-cta codex-dock__send" });
    if (this.getActiveSession()?.currentRun) {
      sendButton.setText("Stop");
      sendButton.addEventListener("click", () => this.cancelActiveSession());
    } else {
      sendButton.setText("Send");
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
    this.updateSessionSelectOptions();
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
    this.contextStatusEl.setText(`Context ${percent}% · ${formatCompactNumber(used)} / ${formatCompactNumber(limit)} chars`);
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

  updateSessionSelectOptions() {
    if (!this.sessionSelectEl) {
      return;
    }

    this.sessionSelectEl.empty();
    for (const session of this.sessions) {
      this.sessionSelectEl.createEl("option", {
        text: session.title,
        value: session.id
      });
    }
    this.sessionSelectEl.value = this.activeSessionId;
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
