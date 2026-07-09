const {
  getCompletedTimelineSections,
  shouldShowEvent
} = require("./timeline");

class MessageTimelineRenderer {
  constructor(options) {
    this.getDebugActivity = options.getDebugActivity;
    this.translate = options.translate;
    this.renderMarkdownContent = options.renderMarkdownContent;
    this.copyText = options.copyText;
    this.setIcon = options.setIcon;
    this.prefersReducedMotion = options.prefersReducedMotion;
    this.onDetailsToggleStart = options.onDetailsToggleStart;
    this.onDetailsLayoutChanged = options.onDetailsLayoutChanged;
    this.groupOpenStates = new WeakMap();
  }

  renderTimeline(containerEl, message) {
    if (message.role !== "assistant") {
      for (const entry of message.timeline) {
        this.renderTimelineEntry(containerEl, entry);
      }
      return;
    }

    if (message.isComplete) {
      this.renderCompletedTimeline(containerEl, message);
      return;
    }

    this.renderLiveTimeline(containerEl, message);
  }

  renderCompletedTimeline(containerEl, message) {
    const timeline = message.timeline;
    const { processedEntries, finalEntry } = getCompletedTimelineSections(
      timeline,
      this.getDebugActivity()
    );
    const animateProcessedCollapse = Boolean(
      message._codexDockTimelineWasLive
      && !message._codexDockProcessedCollapseAnimated
      && !this.shouldReduceMotion()
    );
    if (animateProcessedCollapse) {
      message._codexDockProcessedCollapseAnimated = true;
    }

    if (processedEntries.length > 0) {
      this.renderProcessGroup(containerEl, message, {
        key: "process",
        label: this.translate("timeline.processed", { count: processedEntries.length }),
        entries: processedEntries,
        mode: "processed",
        defaultOpen: Boolean(animateProcessedCollapse),
        animateCollapse: animateProcessedCollapse,
        showDetails: true
      });
    }

    if (finalEntry) {
      this.renderTimelineEntry(containerEl, finalEntry);
    }
  }

  renderLiveTimeline(containerEl, message) {
    for (const segment of buildLiveTimelineSegments(message.timeline, this.getDebugActivity())) {
      if (segment.type === "content") {
        this.renderTimelineEntry(containerEl, segment.entry);
      } else {
        message._codexDockTimelineWasLive = true;
        this.renderProcessGroup(containerEl, message, {
          key: `live-process:${segment.firstIndex}`,
          label: this.translate("timeline.processing", { count: segment.entries.length }),
          entries: segment.entries,
          mode: "live",
          defaultOpen: true,
          showDetails: true
        });
      }
    }
  }

  renderProcessGroup(containerEl, message, options) {
    const entries = options.entries || [];
    if (entries.length === 0) {
      return;
    }

    const mode = options.mode || "processed";
    const key = options.key || mode;
    const details = this.renderDetails(containerEl, message, key, {
      cls: [
        "codex-dock__event-group",
        "codex-dock__process-group",
        `codex-dock__process-group--${mode}`,
        options.animateCollapse ? "is-auto-collapsing" : ""
      ].filter(Boolean).join(" "),
      defaultOpen: Boolean(options.defaultOpen)
    });
    const summary = details.createEl("summary", {
      cls: "codex-dock__event-group-summary codex-dock__process-summary"
    });
    summary.createSpan({
      cls: "codex-dock__process-summary-label",
      text: options.label || this.translate("timeline.processed", { count: entries.length })
    });
    this.renderChevron(summary);

    const body = details.createDiv({ cls: "codex-dock__event-group-body" });
    for (const item of buildProcessedIndex(entries)) {
      this.renderProcessItem(body, message, item, {
        showDetails: options.showDetails !== false
      });
    }
    this.prepareAnimatedDetails(details, summary, body, message, key);
    if (options.animateCollapse) {
      this.scheduleProcessedCollapse(details, body, message);
    }
  }

  scheduleProcessedCollapse(details, body, message) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!details.isConnected || !details.open) {
          return;
        }
        this.toggleDetailsAnimated(details, body, message, "process");
      });
    });
  }

  renderProcessItem(containerEl, message, item, options = {}) {
    if (item.type === "content") {
      this.renderProcessedContent(containerEl, item.entry);
      return;
    }

    if (item.type === "reasoning") {
      if (options.showDetails === false) {
        this.renderProcessTitleRow(containerEl, item.entry);
      } else {
        this.renderReasoningProcessItem(containerEl, message, item, options);
      }
      return;
    }

    if (options.showDetails === false) {
      this.renderProcessTitleRow(containerEl, item.entries[item.entries.length - 1]);
      return;
    }

    this.renderProcessedEventItem(containerEl, message, item, options);
  }

  renderProcessedContent(containerEl, entry) {
    const text = String(entry?.text || "").trim();
    if (!text) {
      return;
    }
    this.renderMarkdownContent(containerEl, text, { compact: true });
  }

  renderReasoningProcessItem(containerEl, message, item, options = {}) {
    const entry = item.entry;
    const text = String(entry?.detail || entry?.summary || "").trim();
    if (!text) {
      this.renderProcessTitleRow(containerEl, entry);
      return;
    }

    const key = `processed-item:${item.firstIndex}:reasoning`;
    const details = this.renderDetails(containerEl, message, key, {
      cls: "codex-dock__processed-item codex-dock__processed-item--reasoning",
      defaultOpen: Boolean(options.defaultItemOpen)
    });
    const summary = details.createEl("summary", { cls: "codex-dock__processed-item-summary" });
    this.renderProcessIcon(summary, entry);
    summary.createSpan({
      cls: "codex-dock__processed-item-title",
      text: this.getProcessedEntryTitle(entry)
    });
    this.renderChevron(summary);

    const body = details.createDiv({ cls: "codex-dock__processed-item-body" });
    body.createEl("pre", { cls: "codex-dock__processed-item-detail", text });
    this.renderCopyButton(body, text, this.translate("view.copyEventText"));
    this.prepareAnimatedDetails(details, summary, body, message, key);
  }

  renderProcessedEventItem(containerEl, message, item, options = {}) {
    const entry = item.entries[item.entries.length - 1];
    if (!entry || !this.shouldShowEvent(entry)) {
      return;
    }

    const key = `processed-item:${item.firstIndex}:${item.kind}:${item.key}`;
    const details = this.renderDetails(containerEl, message, key, {
      cls: `codex-dock__processed-item codex-dock__processed-item--${item.kind}`,
      defaultOpen: Boolean(options.defaultItemOpen)
    });
    const summary = details.createEl("summary", { cls: "codex-dock__processed-item-summary" });
    this.renderProcessIcon(summary, entry);
    summary.createSpan({
      cls: "codex-dock__processed-item-title",
      text: this.getProcessedEntryTitle(entry)
    });
    this.renderChevron(summary);

    const body = details.createDiv({ cls: "codex-dock__processed-item-body" });
    const detail = this.getProcessedItemDetail(item.entries);
    if (detail) {
      body.createEl("pre", { cls: "codex-dock__processed-item-detail", text: detail });
      this.renderCopyButton(body, detail, this.translate("view.copyEventText"));
    }
    this.prepareAnimatedDetails(details, summary, body, message, key);
  }

  getProcessedEntryDetail(entry) {
    if (!entry) {
      return "";
    }
    if (entry.kind === "reasoning") {
      return String(entry.detail || entry.summary || "").trim();
    }
    const body = this.getDebugActivity()
      ? entry.detail || entry.summary || ""
      : entry.summary || entry.detail || "";
    return String(body || "").trim();
  }

  getProcessedItemDetail(entries) {
    const parts = [];
    for (const entry of entries) {
      const detail = this.getProcessedEntryDetail(entry);
      if (detail) {
        parts.push(detail);
      }
    }
    return parts.join("\n\n");
  }

  getProcessedEntryTitle(entry) {
    const title = String(entry?.title || "").trim();
    const summary = String(entry?.summary || "").trim();
    return compactProcessedText(title || summary || this.translate("timeline.event"));
  }

  renderCopyButton(containerEl, text, label) {
    if (!text || !this.copyText) {
      return;
    }

    const copyButton = containerEl.createEl("button", {
      cls: "codex-dock__event-copy-button",
      text: this.translate("view.copy"),
      attr: {
        type: "button",
        "aria-label": label,
        title: label
      }
    });
    copyButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await this.copyText(text);
      copyButton.setText(this.translate("view.copied"));
      window.setTimeout(() => copyButton.setText(this.translate("view.copy")), 1200);
    });
  }

  renderProcessTitleRow(containerEl, entry) {
    if (!this.shouldShowEvent(entry)) {
      return;
    }

    const row = containerEl.createDiv({
      cls: `codex-dock__event-title-row codex-dock__event-title-row--${entry.kind || "activity"}`
    });
    this.renderProcessIcon(row, entry);
    row.createSpan({
      cls: "codex-dock__event-title-text",
      text: this.getProcessedEntryTitle(entry)
    });
  }

  renderChevron(containerEl) {
    const chevron = containerEl.createSpan({
      cls: "codex-dock__event-chevron",
      attr: { "aria-hidden": "true" }
    });
    if (typeof this.setIcon === "function") {
      this.setIcon(chevron, "chevron-right");
    } else {
      chevron.setText(">");
    }
    return chevron;
  }

  renderProcessIcon(containerEl, entry) {
    const iconName = this.getProcessEntryIcon(entry);
    if (!iconName) {
      return null;
    }
    const icon = containerEl.createSpan({
      cls: "codex-dock__process-icon",
      attr: { "aria-hidden": "true" }
    });
    if (typeof this.setIcon === "function") {
      this.setIcon(icon, iconName);
    } else {
      icon.setText("•");
    }
    return icon;
  }

  getProcessEntryIcon(entry) {
    if (!entry) {
      return "";
    }

    const haystack = [
      entry.kind,
      entry.title,
      entry.summary,
      entry.detail
    ].map((part) => String(part || "").toLowerCase()).join("\n");

    if (entry.noticeType === "memory_referenced") {
      return "book-open";
    }
    if (entry.noticeType === "memory_updated" || entry.noticeType === "profile_updated") {
      return "square-pen";
    }
    if (entry.noticeType === "memory_search") {
      return "search";
    }
    if (entry.toolType === "web_search") {
      return "search";
    }
    if (entry.toolType === "command") {
      return "terminal";
    }
    if (/local memory referenced|已引用本地记忆|referenced .*local historical|提示词中引用/.test(haystack)) {
      return "book-open";
    }
    if (/memory updated|记忆已更新|profile updated|档案已更新|updated .*local historical|已为之后的聊天更新/.test(haystack)) {
      return "square-pen";
    }
    if (/web search|网页搜索/.test(haystack)) {
      return "search";
    }
    if (entry.kind === "tool" && (/^\s*(?:started |completed |failed )?\$/.test(String(entry.title || "").toLowerCase()) || /command_execution|命令/.test(haystack))) {
      return "terminal";
    }
    if (entry.kind === "tool") {
      return "wrench";
    }
    if (entry.kind === "notice") {
      return "info";
    }
    if (entry.kind === "error") {
      return "circle-alert";
    }
    if (entry.kind === "reasoning") {
      return "brain";
    }
    return "wrench";
  }

  renderDetails(containerEl, message, key, options) {
    const details = containerEl.createEl("details", {
      cls: options.cls
    });
    details.open = this.getStoredOpenState(message, key, options.defaultOpen);
    details.addEventListener("toggle", () => {
      this.setStoredOpenState(message, key, details.open);
    });
    return details;
  }

  getStoredOpenState(message, key, defaultOpen) {
    const states = this.groupOpenStates.get(message);
    if (!states || !states.has(key)) {
      return defaultOpen;
    }
    return states.get(key);
  }

  setStoredOpenState(message, key, open) {
    let states = this.groupOpenStates.get(message);
    if (!states) {
      states = new Map();
      this.groupOpenStates.set(message, states);
    }
    states.set(key, open);
  }

  prepareAnimatedDetails(details, summary, body, message, key) {
    if (!details || !summary || !body) {
      return;
    }

    const toggle = (event) => {
      if (event.defaultPrevented) {
        return;
      }
      if (this.shouldReduceMotion()) {
        const shouldAnchorToBottom = this.notifyDetailsToggleStart(!details.open);
        if (shouldAnchorToBottom) {
          window.requestAnimationFrame(() => this.notifyDetailsLayoutChanged());
        }
        return;
      }
      event.preventDefault();
      this.toggleDetailsAnimated(details, body, message, key);
    };

    summary.addEventListener("click", toggle);
    summary.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      toggle(event);
    });
  }

  toggleDetailsAnimated(details, body, message, key) {
    if (details.dataset.codexDockAnimating === "true") {
      return;
    }

    if (!details.isConnected) {
      details.open = !details.open;
      this.setStoredOpenState(message, key, details.open);
      return;
    }

    const opening = !details.open;
    const shouldAnchorToBottom = this.notifyDetailsToggleStart(opening);
    details.dataset.codexDockAnimating = "true";
    details.classList.add("is-animating");
    this.setStoredOpenState(message, key, opening);

    if (opening) {
      details.open = true;
    }

    if (opening && shouldAnchorToBottom) {
      this.animateDetailsAtPinnedBottom(details, body);
      return;
    }

    const bodyHeight = body.scrollHeight;
    const fromHeight = opening ? "0px" : `${bodyHeight}px`;
    const toHeight = opening ? `${bodyHeight}px` : "0px";
    const duration = opening ? 180 : 135;
    body.style.overflow = "hidden";
    body.style.maxHeight = fromHeight;
    body.style.opacity = opening ? "0" : "1";
    body.style.transform = opening ? "translateY(-3px)" : "translateY(0)";
    body.style.transition = [
      `max-height ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`
    ].join(", ");

    body.offsetHeight;
    window.requestAnimationFrame(() => {
      if (details.dataset.codexDockAnimating !== "true") {
        return;
      }
      body.style.maxHeight = toHeight;
      body.style.opacity = opening ? "1" : "0";
      body.style.transform = opening ? "translateY(0)" : "translateY(-2px)";
    });

    window.setTimeout(() => {
      if (details.dataset.codexDockAnimating !== "true") {
        return;
      }
      if (!opening) {
        details.open = false;
      }
      this.clearDetailsAnimation(details, body);
    }, duration + 40);
  }

  animateDetailsAtPinnedBottom(details, body) {
    const duration = 160;
    this.notifyDetailsLayoutChanged();
    body.style.opacity = "0";
    body.style.transform = "translateY(-4px)";
    body.style.transition = [
      `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`
    ].join(", ");

    body.offsetHeight;
    window.requestAnimationFrame(() => {
      if (details.dataset.codexDockAnimating !== "true") {
        return;
      }
      this.notifyDetailsLayoutChanged();
      body.style.opacity = "1";
      body.style.transform = "translateY(0)";
    });

    window.setTimeout(() => {
      if (details.dataset.codexDockAnimating !== "true") {
        return;
      }
      this.notifyDetailsLayoutChanged();
      this.clearDetailsAnimation(details, body);
    }, duration + 40);
  }

  clearDetailsAnimation(details, body) {
    details.classList.remove("is-animating");
    details.classList.remove("is-auto-collapsing");
    delete details.dataset.codexDockAnimating;
    body.style.maxHeight = "";
    body.style.overflow = "";
    body.style.opacity = "";
    body.style.transform = "";
    body.style.transition = "";
  }

  shouldReduceMotion() {
    return typeof this.prefersReducedMotion === "function" && this.prefersReducedMotion();
  }

  notifyDetailsToggleStart(opening) {
    if (typeof this.onDetailsToggleStart === "function") {
      return Boolean(this.onDetailsToggleStart(opening));
    }
    return false;
  }

  notifyDetailsLayoutChanged() {
    if (typeof this.onDetailsLayoutChanged === "function") {
      this.onDetailsLayoutChanged();
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
    eventEl.createDiv({ cls: "codex-dock__event-title", text: entry.title || this.translate("timeline.event") });
    this.renderCopyButton(eventEl, entryToClipboardText(entry, this.getDebugActivity()), this.translate("view.copyEventText"));

    if (entry.kind === "reasoning") {
      this.renderReasoningBody(eventEl, entry);
      return;
    }

    if (entry.summary && !this.getDebugActivity()) {
      eventEl.createDiv({ cls: "codex-dock__event-summary", text: entry.summary });
    }
    if (entry.detail && this.getDebugActivity()) {
      eventEl.createEl("pre", { cls: "codex-dock__event-detail", text: entry.detail });
    }
  }

  renderReasoningBody(eventEl, entry) {
    const streamText = entry.detail || entry.summary || "";
    if (!streamText) {
      return;
    }

    if (this.getDebugActivity()) {
      eventEl.createEl("pre", { cls: "codex-dock__event-detail", text: streamText });
      return;
    }

    eventEl.createDiv({
      cls: "codex-dock__event-summary codex-dock__event-summary--reasoning",
      text: streamText
    });
  }

  shouldShowEvent(entry) {
    return shouldShowEvent(entry, this.getDebugActivity());
  }
}

function entryToClipboardText(entry, debugActivity) {
  if (!entry) {
    return "";
  }

  if (entry.kind === "message" || entry.kind === "content") {
    return String(entry.text || "").trim();
  }

  const body = entry.kind === "reasoning"
    ? entry.detail || entry.summary || ""
    : debugActivity
      ? entry.detail || ""
      : entry.summary || "";
  return [entry.title, body]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  MessageTimelineRenderer,
  _test: {
    buildLiveTimelineSegments,
    buildProcessedIndex,
    getProcessedAggregationKey
  }
};

function buildLiveTimelineSegments(timeline, debugActivity) {
  const segments = [];
  let processEntries = [];
  let firstProcessIndex = -1;

  const flushProcessEntries = () => {
    if (processEntries.length === 0) {
      return;
    }
    segments.push({
      type: "process",
      entries: processEntries,
      firstIndex: firstProcessIndex
    });
    processEntries = [];
    firstProcessIndex = -1;
  };

  for (let index = 0; index < timeline.length; index += 1) {
    const entry = timeline[index];
    if (entry.kind === "content") {
      flushProcessEntries();
      segments.push({ type: "content", entry, firstIndex: index });
    } else if (shouldShowEvent(entry, debugActivity)) {
      if (processEntries.length === 0) {
        firstProcessIndex = index;
      }
      processEntries.push(entry);
    }
  }

  flushProcessEntries();
  return segments;
}

function buildProcessedIndex(entries) {
  const items = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const kind = entry?.kind || "activity";
    if (kind === "content") {
      items.push({ type: "content", kind, entry, firstIndex: index });
      continue;
    }
    if (kind === "reasoning") {
      items.push({ type: "reasoning", kind, entry, firstIndex: index });
      continue;
    }

    const key = getProcessedAggregationKey(entry);
    const previous = items[items.length - 1];
    if (
      previous
      && previous.type === "event"
      && previous.kind === kind
      && previous.key === key
      && shouldAggregateProcessedEntries(previous.entries[previous.entries.length - 1], entry, key)
    ) {
      previous.entries.push(entry);
      continue;
    }

    items.push({
      type: "event",
      kind,
      key,
      entries: [entry],
      firstIndex: index
    });
  }

  return items;
}

function getProcessedAggregationKey(entry) {
  if (entry?.toolCallId) {
    return `tool:${entry.toolCallId}`;
  }

  const title = stripToolState(String(entry?.title || ""));
  const summaryHead = String(entry?.summary || "").split("|")[0] || "";
  const detailHead = String(entry?.detail || "").split("\n")[0] || "";
  const command = normalizeCommandLabel(summaryHead || detailHead || title);
  return compactProcessedText(`${entry?.kind || "activity"}:${command || title}`);
}

function shouldAggregateProcessedEntries(previous, entry, key) {
  if (!previous || !entry || !key) {
    return false;
  }
  if (previous.toolCallId && entry.toolCallId && previous.toolCallId === entry.toolCallId) {
    return true;
  }
  if (entry.kind !== "tool" || previous.kind !== "tool") {
    return false;
  }
  if (!hasToolState(previous) || !hasToolState(entry)) {
    return false;
  }
  return Boolean(normalizeCommandLabel(String(entry.summary || entry.detail || entry.title || "")));
}

function hasToolState(entry) {
  return /\b(started|completed|failed)\b/i.test(String(entry?.title || ""))
    || /(已开始|已完成|已失败)/u.test(String(entry?.title || ""));
}

function stripToolState(value) {
  return value
    .replace(/\s+(已开始|已完成|已失败)$/u, "")
    .replace(/\s+(started|completed|failed)$/iu, "")
    .trim();
}

function normalizeCommandLabel(value) {
  return stripToolState(String(value || ""))
    .replace(/^\$\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactProcessedText(value) {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}
