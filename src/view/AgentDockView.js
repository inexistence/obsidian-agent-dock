const { ItemView, Notice } = require("obsidian");

const { VIEW_TYPE_AGENT_DOCK } = require("../constants");
const { MODE_OPTIONS, getModeDescription } = require("../modes");
const { DEFAULT_SETTINGS } = require("../settings");

class AgentDockView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.messages = [];
    this.isRunning = false;
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
    this.render();
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
      this.messages = [];
      this.render();
    });

    this.messageList = containerEl.createDiv({ cls: "codex-dock__messages" });
    this.renderMessages();

    const composer = containerEl.createDiv({ cls: "codex-dock__composer" });
    this.inputEl = composer.createEl("textarea", {
      cls: "codex-dock__input",
      attr: {
        rows: "4",
        placeholder: "Ask the agent about this vault or the active note..."
      }
    });

    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.submit();
      }
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
    });

    const sendButton = composer.createEl("button", { cls: "mod-cta codex-dock__send" });
    sendButton.setText("Send");
    sendButton.addEventListener("click", () => this.submit());
  }

  renderMessages() {
    this.messageList.empty();

    if (this.messages.length === 0) {
      const empty = this.messageList.createDiv({ cls: "codex-dock__empty" });
      empty.createDiv({ text: "Open a side conversation with an agent." });
      empty.createDiv({ text: "The active note can be included automatically." });
      return;
    }

    for (const message of this.messages) {
      const item = this.messageList.createDiv({
        cls: `codex-dock__message codex-dock__message--${message.role}`
      });
      item.createDiv({
        cls: "codex-dock__role",
        text: message.role === "user" ? "You" : this.plugin.agent.label
      });
      if (message.isLoading) {
        const loading = item.createDiv({ cls: "codex-dock__loading" });
        loading.createSpan({ cls: "codex-dock__loading-text", text: "思考中..." });
        const dots = loading.createSpan({ cls: "codex-dock__loading-dots", attr: { "aria-hidden": "true" } });
        dots.createSpan();
        dots.createSpan();
        dots.createSpan();
      }
      if (message.timeline && message.timeline.length > 0) {
        const timeline = item.createDiv({ cls: "codex-dock__timeline" });
        for (const entry of message.timeline) {
          this.renderTimelineEntry(timeline, entry);
        }
      } else if (message.content) {
        item.createEl("pre", { cls: "codex-dock__content", text: message.content });
      }
    }

    this.messageList.scrollTop = this.messageList.scrollHeight;
  }

  async submit() {
    if (this.isRunning) {
      new Notice(`${this.plugin.agent.label} is still working.`);
      return;
    }

    const prompt = this.inputEl.value.trim();
    if (!prompt) {
      return;
    }

    this.inputEl.value = "";
    this.messages.push({
      role: "user",
      content: prompt,
      timeline: [{ kind: "message", text: prompt }]
    });
    const assistantMessage = { role: "assistant", content: "", timeline: [], isLoading: true };
    this.messages.push(assistantMessage);
    this.isRunning = true;
    this.renderMessages();

    try {
      const conversation = this.messages.slice(0, -1);
      await this.plugin.runAgent(prompt, (update) => {
        assistantMessage.isLoading = false;
        if (update.kind === "message") {
          assistantMessage.content += update.text;
          appendTimelineMessage(assistantMessage, update.text);
        } else {
          assistantMessage.timeline.push(update);
        }
        this.renderMessages();
      }, conversation);

      assistantMessage.isLoading = false;
      if (!assistantMessage.content.trim()) {
        const emptyText = `(${this.plugin.agent.label} finished without text output.)`;
        assistantMessage.content = emptyText;
        appendTimelineMessage(assistantMessage, emptyText);
        this.renderMessages();
      }
    } catch (error) {
      assistantMessage.isLoading = false;
      const errorText = [
        `${this.plugin.agent.label} could not run.`,
        "",
        error.message,
        "",
        "Check the executable path in plugin settings and make sure the CLI is installed and allowed by macOS."
      ].join("\n");
      assistantMessage.content = errorText;
      appendTimelineMessage(assistantMessage, errorText);
      this.renderMessages();
      new Notice(`${this.plugin.agent.label} command failed.`);
    } finally {
      this.isRunning = false;
    }
  }

  renderTimelineEntry(containerEl, entry) {
    if (entry.kind === "message") {
      containerEl.createEl("pre", { cls: "codex-dock__content", text: entry.text });
      return;
    }

    if (!this.shouldShowEvent(entry)) {
      return;
    }

    const eventEl = containerEl.createDiv({ cls: `codex-dock__event codex-dock__event--${entry.kind || "activity"}` });
    eventEl.createDiv({ cls: "codex-dock__event-title", text: entry.title || "Event" });
    if (entry.detail && this.plugin.settings.debugActivity) {
      eventEl.createEl("pre", { cls: "codex-dock__event-detail", text: entry.detail });
    }
  }

  shouldShowEvent(entry) {
    if (this.plugin.settings.debugActivity) {
      return true;
    }

    return ["reasoning", "tool", "error"].includes(entry.kind);
  }
}

function appendTimelineMessage(message, text) {
  const lastEntry = message.timeline[message.timeline.length - 1];
  if (lastEntry && lastEntry.kind === "message") {
    lastEntry.text += text;
    return;
  }

  message.timeline.push({ kind: "message", text });
}

module.exports = {
  AgentDockView
};
