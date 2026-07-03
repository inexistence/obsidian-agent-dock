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
    this.renderMarkdownContent = options.renderMarkdownContent;
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

    for (const group of groupLiveTimeline(message.timeline, this.getDebugActivity())) {
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
      this.getDebugActivity()
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
      this.renderTimelineEntry(body, entry);
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
    if (entry.summary && !this.getDebugActivity()) {
      eventEl.createDiv({ cls: "codex-dock__event-summary", text: entry.summary });
    }
    if (entry.detail && this.getDebugActivity()) {
      eventEl.createEl("pre", { cls: "codex-dock__event-detail", text: entry.detail });
    }
  }

  shouldShowEvent(entry) {
    return shouldShowEvent(entry, this.getDebugActivity());
  }
}

module.exports = {
  MessageTimelineRenderer
};
