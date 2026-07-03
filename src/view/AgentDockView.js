const { ItemView, MarkdownRenderer, Notice, setIcon } = require("obsidian");

const { VIEW_TYPE_AGENT_DOCK } = require("../constants");
const { t } = require("../i18n");
const { DEFAULT_SETTINGS } = require("../settings");
const { renderComposerContent } = require("./ComposerRenderer");
const { copyText } = require("./clipboard");
const { estimateContextChars, formatCompactNumber } = require("./contextEstimate");
const { MessageTimelineRenderer } = require("./MessageTimelineRenderer");
const {
  extractMentionReferences,
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
    this.autoScrollThresholdPx = 48;
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
      updateMentionChips: () => this.updateMentionChips(),
      updateMentionSuggestions: () => this.updateMentionSuggestions(),
      hideMentionSuggestions: () => this.hideMentionSuggestions(),
      onDraftChanged: (session) => this.persistSessionChange(session),
      handleReferenceDrop: (dataTransfer) => this.handleReferenceDrop(dataTransfer),
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
    this.mentionState = {
      active: false,
      start: -1,
      end: -1,
      selectedIndex: 0,
      suggestions: []
    };
    this.updateMentionChips();
    this.updateContextStatus();
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
    } else {
      this.messageList.scrollTop = previousScrollTop;
    }
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
    this.updateMentionChips();
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
    const nextValue = replaceObsidianOpenLinks(value, (path) => this.normalizeReferencedPath(path));
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
    this.updateMentionChips();
    this.updateContextStatus();
    this.updateMentionSuggestions();
    return true;
  }

  handleReferenceDrop(dataTransfer) {
    const debugInfo = createReferenceDropDebugInfo(dataTransfer);
    const debugEnabled = Boolean(this.plugin.settings.debugActivity);
    const paths = this.extractDroppedReferencePaths(dataTransfer, debugInfo, debugEnabled);
    logReferenceDropDebug(debugInfo, paths, debugEnabled);
    if (paths.length === 0) {
      return false;
    }

    const tokens = paths.map((path) => formatMentionToken(path));
    const value = this.inputEl.value;
    const start = this.inputEl.selectionStart ?? value.length;
    const end = this.inputEl.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    const suffix = after && !/^\s/.test(after) ? " " : "";
    const insertion = `${prefix}${tokens.join(" ")}${suffix || " "}`;
    const nextValue = `${before}${insertion}${after}`;
    const nextCursor = before.length + insertion.length;

    this.inputEl.value = nextValue;
    this.inputEl.selectionStart = nextCursor;
    this.inputEl.selectionEnd = nextCursor;
    const session = this.getActiveSession();
    if (session) {
      session.draft = nextValue;
      this.persistSessionChange(session);
    }
    this.updateMentionChips();
    this.updateContextStatus();
    this.hideMentionSuggestions();
    this.inputEl.focus();
    return true;
  }

  extractDroppedReferencePaths(dataTransfer, debugInfo, debugEnabled = false) {
    const paths = [];
    const seen = new Set();
    const attemptedInputs = new Set();
    const addPath = (path, source = "unknown") => {
      const normalizedInput = normalizeReferenceInput(path);
      if (normalizedInput && attemptedInputs.has(normalizedInput)) {
        debugInfo.candidates.push({
          source,
          raw: truncateDebugText(path),
          normalized: normalizedInput,
          accepted: false,
          reason: "duplicate input"
        });
        return;
      }
      if (normalizedInput) {
        attemptedInputs.add(normalizedInput);
      }
      const normalizedPath = this.normalizeReferencedPath(path);
      const entry = normalizedPath ? this.resolveReferencedEntry(normalizedPath) : null;
      if (debugEnabled || !entry) {
        debugInfo.resolutions.push(this.getReferenceResolutionDebug(path, normalizedPath, entry));
      }
      const result = {
        source,
        raw: truncateDebugText(path),
        normalized: normalizedPath,
        accepted: false,
        reason: ""
      };
      if (!normalizedPath) {
        result.reason = "empty";
        debugInfo.candidates.push(result);
        return;
      }
      if (seen.has(normalizedPath)) {
        result.reason = "duplicate";
        debugInfo.candidates.push(result);
        return;
      }
      if (!entry) {
        result.reason = "not found in vault";
        debugInfo.candidates.push(result);
        return;
      }
      seen.add(normalizedPath);
      paths.push(normalizedPath);
      result.accepted = true;
      result.reason = `resolved to ${entry.path}`;
      debugInfo.candidates.push(result);
    };
    const addText = (text, source) => {
      if (text) {
        debugInfo.payloads.push({
          source,
          text: truncateDebugText(text, 600)
        });
      }
      for (const candidate of extractReferenceCandidatesFromText(text, debugInfo, source)) {
        addPath(candidate, source);
      }
    };

    for (const file of Array.from(dataTransfer.files || [])) {
      addPath(file.path || file.name || "", "dataTransfer.files");
    }

    for (const type of Array.from(dataTransfer.types || [])) {
      try {
        addText(dataTransfer.getData(type), type);
      } catch {
        // Some drag payload types are read-protected by the host.
        debugInfo.payloads.push({
          source: type,
          text: "[read-protected]"
        });
      }
    }

    return paths;
  }

  updateMentionChips() {
    if (!this.mentionChipsEl) {
      return;
    }

    const references = extractMentionReferences(this.inputEl?.value || "")
      .map((reference) => ({
        path: this.normalizeReferencedPath(reference.path),
        name: reference.name
      }))
      .filter((reference) => reference.path);
    this.mentionChipsEl.empty();
    this.mentionChipsEl.toggleClass("is-empty", references.length === 0);
    this.mentionChipsEl.setAttr("aria-hidden", references.length === 0 ? "true" : "false");

    for (const reference of references) {
      const entry = this.resolveReferencedEntry(reference.path);
      const isFolder = Boolean(entry?.children);
      const chip = this.mentionChipsEl.createSpan({
        cls: `codex-dock__mention-chip${isFolder ? " is-folder" : " is-file"}`,
        attr: {
          title: reference.path
        }
      });
      if (isFolder) {
        const icon = chip.createSpan({ cls: "codex-dock__mention-chip-icon", attr: { "aria-hidden": "true" } });
        setIcon(icon, "folder");
      } else {
        chip.createSpan({
          cls: "codex-dock__mention-chip-type",
          text: getMentionFileType(reference.name)
        });
      }
      chip.createSpan({ cls: "codex-dock__mention-chip-name", text: reference.name || reference.path });
    }
  }

  normalizeReferencedPath(path) {
    const normalizedPath = normalizeReferenceInput(path);
    if (!normalizedPath) {
      return "";
    }

    const vaultBasePath = String(this.app.vault.adapter.basePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (vaultBasePath && normalizedPath === vaultBasePath) {
      return "";
    }
    if (vaultBasePath && normalizedPath.startsWith(`${vaultBasePath}/`)) {
      return this.resolveReferencedPath(normalizedPath.slice(vaultBasePath.length + 1));
    }

    return this.resolveReferencedPath(normalizedPath.replace(/^\/+/, ""));
  }

  resolveReferencedPath(path) {
    const normalizedPath = String(path || "").trim();
    if (!normalizedPath) {
      return "";
    }

    const entry = this.resolveReferencedEntry(normalizedPath);
    return entry?.path || normalizedPath;
  }

  resolveReferencedEntry(path) {
    const normalizedPath = String(path || "").trim();
    if (!normalizedPath) {
      return null;
    }

    return this.app.vault.getAbstractFileByPath(normalizedPath)
      || (!/\.[^/]+$/.test(normalizedPath) ? this.app.vault.getAbstractFileByPath(`${normalizedPath}.md`) : null)
      || this.findUniqueVaultEntryByName(normalizedPath);
  }

  getReferenceResolutionDebug(rawPath, normalizedPath, entry) {
    const normalizedInput = normalizeReferenceInput(rawPath);
    const vaultBasePath = String(this.app.vault.adapter.basePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
    const lookupPath = vaultBasePath && normalizedInput.startsWith(`${vaultBasePath}/`)
      ? normalizedInput.slice(vaultBasePath.length + 1)
      : normalizedInput.replace(/^\/+/, "");
    const mdPath = !/\.[^/]+$/.test(lookupPath) ? `${lookupPath}.md` : "";
    const exactEntry = lookupPath ? this.app.vault.getAbstractFileByPath(lookupPath) : null;
    const mdEntry = mdPath ? this.app.vault.getAbstractFileByPath(mdPath) : null;
    const nameMatches = this.findVaultEntryNameMatches(lookupPath).map((match) => match.path).slice(0, 10);

    return {
      raw: truncateDebugText(rawPath),
      normalizedInput,
      lookupPath,
      normalizedPath,
      exact: exactEntry?.path || "",
      mdFallback: mdEntry?.path || "",
      nameMatches,
      accepted: entry?.path || ""
    };
  }

  findUniqueVaultEntryByName(path) {
    const candidates = this.findVaultEntryNameMatches(path);

    return candidates.length === 1 ? candidates[0] : null;
  }

  findVaultEntryNameMatches(path) {
    const normalizedPath = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!normalizedPath) {
      return [];
    }

    const name = normalizedPath.split("/").pop() || normalizedPath;
    const nameWithMd = /\.[^/]+$/.test(name) ? name : `${name}.md`;
    return this.app.vault.getAllLoadedFiles()
      .filter((entry) => entry.path)
      .filter((entry) => (
        entry.path === normalizedPath
        || entry.name === name
        || entry.name === nameWithMd
        || entry.path.endsWith(`/${normalizedPath}`)
        || entry.path.endsWith(`/${normalizedPath}.md`)
      ));
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
    this.updateMentionChips();
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
    this.renderMessages({ forceScrollToBottom: true });
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

function getMentionFileType(name) {
  const extension = String(name || "").split(".").pop();
  if (!extension || extension === name || extension.length > 4) {
    return "FILE";
  }
  return extension.toUpperCase();
}

function normalizeReferenceInput(path) {
  const value = String(path || "").replace(/\\"/g, "\"").trim();
  const obsidianPath = extractObsidianOpenPathFromValue(value);
  return String(obsidianPath || value).replace(/\\/g, "/").trim();
}

function extractObsidianOpenPathFromValue(value) {
  const match = String(value || "").match(/^obsidian:\/\/open\?([^#\s<>"']+)/i);
  if (!match) {
    return "";
  }
  return getObsidianOpenQueryPath(match[1]);
}

function getObsidianOpenQueryPath(query) {
  try {
    const params = new URLSearchParams(query);
    return decodeUriPath(params.get("file") || params.get("path") || "");
  } catch {
    return "";
  }
}

function createReferenceDropDebugInfo(dataTransfer) {
  return {
    types: Array.from(dataTransfer?.types || []),
    items: Array.from(dataTransfer?.items || []).map((item) => ({
      kind: item.kind || "",
      type: item.type || ""
    })),
    files: Array.from(dataTransfer?.files || []).map((file) => ({
      name: file.name || "",
      path: file.path || "",
      type: file.type || ""
    })),
    payloads: [],
    extractions: [],
    resolutions: [],
    candidates: []
  };
}

function logReferenceDropDebug(debugInfo, paths, debugEnabled = false) {
  const payload = {
    stamp: "drop-ob-open-v4",
    types: debugInfo.types,
    items: debugInfo.items,
    files: debugInfo.files,
    payloads: debugInfo.payloads,
    extractions: debugInfo.extractions,
    resolutions: debugInfo.resolutions,
    candidates: debugInfo.candidates,
    acceptedPaths: paths
  };

  if (paths.length > 0 && debugEnabled) {
    console.info("[Agent Dock] Reference drop accepted", payload);
  } else if (paths.length === 0) {
    console.warn("[Agent Dock] Reference drop ignored", payload);
  }
}

function truncateDebugText(value, maxChars = 180) {
  const text = String(value || "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function extractReferenceCandidatesFromText(text, debugInfo = null, sourceLabel = "") {
  const source = String(text || "").trim();
  if (!source) {
    return [];
  }

  const candidates = [];
  const addCandidate = (path, stage) => {
    const obsidianPath = extractObsidianOpenPathFromValue(path);
    const cleanPath = String(obsidianPath || path || "").replace(/^file:\/\//, "").trim();
    if (debugInfo) {
      debugInfo.extractions.push({
        source: sourceLabel,
        stage,
        raw: truncateDebugText(path),
        obsidianPath,
        candidate: cleanPath
      });
    }
    if (cleanPath) {
      candidates.push(cleanPath);
    }
  };

  for (const candidate of extractJsonReferenceCandidates(source)) {
    addCandidate(candidate, "json");
  }

  for (const candidate of extractObsidianOpenPathCandidates(source)) {
    addCandidate(candidate, "obsidian-url");
  }

  for (const reference of extractMentionReferences(replaceObsidianOpenLinks(source))) {
    addCandidate(reference.path, "mention");
  }

  let match;
  const wikiPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  while ((match = wikiPattern.exec(source)) !== null) {
    addCandidate(match[1], "wikilink");
  }

  const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  while ((match = markdownLinkPattern.exec(source)) !== null) {
    addCandidate(decodeUriPath(match[1]), "markdown-link");
  }

  const hrefPattern = /\b(?:href|src)=["']([^"']+)["']/gi;
  while ((match = hrefPattern.exec(source)) !== null) {
    addCandidate(decodeUriPath(match[1]), "href");
  }

  const dataAttributePattern = /\bdata-(?:path|href|file)=["']([^"']+)["']/gi;
  while ((match = dataAttributePattern.exec(source)) !== null) {
    addCandidate(decodeUriPath(match[1]), "data-attribute");
  }

  const objectPathPattern = /["'](?:path|file|sourcePath|source-path|data-path)["']\s*:\s*["']([^"']+)["']/gi;
  while ((match = objectPathPattern.exec(source)) !== null) {
    addCandidate(decodeUriPath(match[1]), "object-path");
  }

  for (const line of source.split(/\r?\n/)) {
    const compact = line.trim();
    if (/^[^\s<>"']+(?:\/[^\s<>"']+)*$/.test(compact) || /^file:\/\/[^\s<>"']+$/i.test(compact)) {
      addCandidate(decodeUriPath(compact), "line");
    }
  }

  return candidates;
}

function extractObsidianOpenPathCandidates(text) {
  const candidates = [];
  const pattern = /obsidian:\/\/open\?[^\s<>"']+/g;
  let match;

  while ((match = pattern.exec(String(text || ""))) !== null) {
    const path = extractObsidianOpenPathFromValue(match[0]);
    if (path) {
      candidates.push(path);
    }
  }

  return candidates;
}

function extractJsonReferenceCandidates(text) {
  try {
    return collectJsonReferenceCandidates(JSON.parse(text));
  } catch {
    return [];
  }
}

function collectJsonReferenceCandidates(value) {
  const candidates = [];
  const visit = (item) => {
    if (!item) {
      return;
    }
    if (typeof item === "string") {
      candidates.push(item);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child);
      }
      return;
    }
    if (typeof item !== "object") {
      return;
    }
    for (const key of ["path", "file", "sourcePath", "source-path", "data-path", "href"]) {
      if (typeof item[key] === "string") {
        candidates.push(item[key]);
      }
    }
    for (const child of Object.values(item)) {
      if (child && typeof child === "object") {
        visit(child);
      }
    }
  };

  visit(value);
  return candidates;
}

function decodeUriPath(path) {
  try {
    return decodeURIComponent(String(path || ""));
  } catch {
    return String(path || "");
  }
}
