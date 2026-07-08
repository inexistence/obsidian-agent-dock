const {
  getCompletedTimelineSections,
  getEventGroupLabel,
  groupLiveTimeline,
  groupProcessedEntries,
  shouldShowEvent
} = require("./timeline");

class MessageTimelineRenderer {
  constructor(options) {
    this.getDebugActivity = options.getDebugActivity;
    this.translate = options.translate;
    this.renderMarkdownContent = options.renderMarkdownContent;
    this.copyText = options.copyText;
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

    for (const group of groupLiveTimeline(message.timeline, this.getDebugActivity(), this.translate)) {
      if (group.type === "eventGroup") {
        const key = this.getTimelineGroupKey("live", message.timeline, group.entries);
        const openLiveGroup = group.entries.some((entry) => (
          entry.kind === "reasoning" && Boolean(entry.detail || entry.summary)
        ));
        this.renderEventGroup(containerEl, message, key, group.entries, group.label, openLiveGroup);
      } else {
        this.renderTimelineEntry(containerEl, group.entry);
      }
    }
  }

  renderCompletedTimeline(containerEl, message) {
    const timeline = message.timeline;
    const { processedEntries, finalEntry } = getCompletedTimelineSections(
      timeline,
      this.getDebugActivity()
    );

    if (processedEntries.length > 0) {
      this.renderProcessedGroup(containerEl, message, processedEntries);
    }

    if (finalEntry) {
      this.renderTimelineEntry(containerEl, finalEntry);
    }
  }

  renderProcessedGroup(containerEl, message, entries) {
    if (entries.length === 0) {
      return;
    }

    const details = this.renderDetails(containerEl, message, "processed", {
      cls: "codex-dock__event-group codex-dock__event-group--processed",
      defaultOpen: false
    });
    const summary = details.createEl("summary", {
      cls: "codex-dock__event-group-summary",
      text: this.translate("timeline.processed", { count: entries.length })
    });

    const body = details.createDiv({ cls: "codex-dock__event-group-body" });
    for (const group of groupProcessedEntries(entries)) {
      if (group.type === "eventGroup") {
        const key = this.getTimelineGroupKey("processed", message.timeline, group.entries);
        this.renderEventGroup(body, message, key, group.entries, getEventGroupLabel(group.entries, this.translate), false);
      } else {
        this.renderTimelineEntry(body, group.entry);
      }
    }
    this.prepareAnimatedDetails(details, summary, body, message, "processed");
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

  renderEventGroup(containerEl, message, key, entries, label, open) {
    const details = this.renderDetails(containerEl, message, key, {
      cls: "codex-dock__event-group",
      defaultOpen: open
    });
    const summary = details.createEl("summary", {
      cls: "codex-dock__event-group-summary",
      text: label
    });

    const body = details.createDiv({ cls: "codex-dock__event-group-body" });
    for (const entry of entries) {
      this.renderTimelineEntry(body, entry);
    }
    this.prepareAnimatedDetails(details, summary, body, message, key);
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

  getTimelineGroupKey(prefix, timeline, entries) {
    const firstEntry = entries[0];
    const firstIndex = firstEntry ? timeline.indexOf(firstEntry) : -1;
    const kind = firstEntry?.kind || "activity";
    return `${prefix}:${firstIndex}:${kind}`;
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
  MessageTimelineRenderer
};
