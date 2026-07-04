function shouldShowEvent(entry, debugActivity) {
  if (debugActivity) {
    return true;
  }

  return ["reasoning", "tool", "error", "notice"].includes(entry.kind);
}

function getCompletedTimelineSections(timeline, debugActivity) {
  const finalContentIndex = findLastContentIndex(timeline);

  if (finalContentIndex === -1) {
    return {
      processedEntries: timeline.filter((entry) => shouldShowEvent(entry, debugActivity)),
      finalEntry: null
    };
  }

  return {
    processedEntries: timeline.filter((entry, index) => {
      if (index === finalContentIndex) {
        return false;
      }
      return entry.kind === "content" || shouldShowEvent(entry, debugActivity);
    }),
    finalEntry: timeline[finalContentIndex]
  };
}

function appendTimelineContent(message, text) {
  const lastEntry = message.timeline[message.timeline.length - 1];
  if (lastEntry && lastEntry.kind === "content") {
    lastEntry.text += text;
    return;
  }

  message.timeline.push({ kind: "content", text });
}

function replaceTimelineFinalContent(message, text) {
  message.timeline = message.timeline.filter((entry) => entry.kind !== "content");
  const normalized = String(text || "");
  if (normalized) {
    message.timeline.push({ kind: "content", text: normalized });
  }
}

function consolidateTimelineContent(message) {
  const finalAnswer = String(message.content || "");
  const contentIndices = [];

  for (let index = 0; index < message.timeline.length; index += 1) {
    if (message.timeline[index].kind === "content") {
      contentIndices.push(index);
    }
  }

  if (contentIndices.length === 0) {
    if (finalAnswer) {
      message.timeline.push({ kind: "content", text: finalAnswer });
    }
    return;
  }

  if (contentIndices.length === 1) {
    if (finalAnswer) {
      message.timeline[contentIndices[0]].text = finalAnswer;
    }
    return;
  }

  if (!finalAnswer) {
    return;
  }

  const lastContentIndex = contentIndices[contentIndices.length - 1];
  if (message.timeline[lastContentIndex].text === finalAnswer) {
    return;
  }

  message.timeline.push({ kind: "content", text: finalAnswer });
}

function findLastStreamingReasoningEntry(timeline) {
  const entry = timeline[timeline.length - 1];
  if (entry?.kind === "reasoning" && !entry.discrete) {
    return entry;
  }
  return null;
}

function appendTimelineReasoning(message, update) {
  const chunk = String(update.detail || "");

  if (update.discrete) {
    message.timeline.push({
      kind: "reasoning",
      title: update.title || "",
      detail: chunk,
      summary: update.summary || "",
      discrete: true
    });
    return;
  }

  const lastEntry = findLastStreamingReasoningEntry(message.timeline);
  if (lastEntry) {
    if (update.title) {
      lastEntry.title = update.title;
    }
    if (chunk) {
      const existing = lastEntry.detail || "";
      if (existing && chunk.length >= existing.length && chunk.startsWith(existing)) {
        lastEntry.detail = chunk;
      } else {
        lastEntry.detail = `${existing}${chunk}`;
      }
    }
    if (update.summary) {
      lastEntry.summary = update.summary;
    }
    return;
  }

  message.timeline.push({
    kind: "reasoning",
    title: update.title || "",
    detail: chunk,
    summary: update.summary || "",
    discrete: false
  });
}

function findLastContentIndex(timeline) {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (timeline[index].kind === "content") {
      return index;
    }
  }
  return -1;
}

function groupLiveTimeline(timeline, debugActivity, translate) {
  const groups = [];
  let pendingEvents = [];

  const flushPendingEvents = () => {
    if (pendingEvents.length === 0) {
      return;
    }

    groups.push({
      type: "eventGroup",
      label: getEventGroupLabel(pendingEvents, translate),
      entries: pendingEvents
    });
    pendingEvents = [];
  };

  for (const entry of timeline) {
    if (entry.kind === "content") {
      flushPendingEvents();
      groups.push({ type: "entry", entry });
      continue;
    }

    if (debugActivity || ["reasoning", "tool", "error", "notice"].includes(entry.kind)) {
      const previous = pendingEvents[pendingEvents.length - 1];
      if (previous && previous.kind !== entry.kind) {
        flushPendingEvents();
      }
      pendingEvents.push(entry);
    }
  }

  flushPendingEvents();
  return groups;
}

function groupProcessedEntries(entries) {
  const groups = [];
  let pending = [];

  const flush = () => {
    if (pending.length === 0) {
      return;
    }

    groups.push({ type: "eventGroup", entries: pending });
    pending = [];
  };

  for (const entry of entries) {
    if (entry.kind === "content") {
      flush();
      groups.push({ type: "entry", entry });
      continue;
    }

    const previous = pending[pending.length - 1];
    if (previous && previous.kind !== entry.kind) {
      flush();
    }
    pending.push(entry);
  }

  flush();
  return groups;
}

function getEventGroupLabel(entries, translate = defaultTranslate) {
  const hasError = entries.some((entry) => entry.kind === "error");
  if (hasError) {
    return translate("timeline.needsAttention", { count: entries.length });
  }

  const hasTool = entries.some((entry) => entry.kind === "tool");
  const hasReasoning = entries.some((entry) => entry.kind === "reasoning");
  const hasNotice = entries.some((entry) => entry.kind === "notice");
  const labelKey = hasTool
    ? "timeline.toolCalls"
    : hasReasoning
      ? "timeline.reasoning"
      : hasNotice
        ? "timeline.notice"
        : "timeline.activity";
  return translate("timeline.groupLabel", {
    label: translate(labelKey),
    count: entries.length
  });
}

function defaultTranslate(key, params = {}) {
  const defaults = {
    "timeline.needsAttention": "Needs attention {count} items",
    "timeline.toolCalls": "Tool calls",
    "timeline.reasoning": "Thinking",
    "timeline.notice": "Notice",
    "timeline.activity": "Activity",
    "timeline.groupLabel": "{label} {count} items"
  };
  return String(defaults[key] || key).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    params[name] === undefined ? match : String(params[name])
  ));
}

module.exports = {
  appendTimelineContent,
  appendTimelineReasoning,
  consolidateTimelineContent,
  replaceTimelineFinalContent,
  getCompletedTimelineSections,
  getEventGroupLabel,
  groupLiveTimeline,
  groupProcessedEntries,
  shouldShowEvent,
  _test: {
    appendTimelineContent,
    appendTimelineReasoning,
    consolidateTimelineContent,
    replaceTimelineFinalContent,
    findLastContentIndex,
    getCompletedTimelineSections
  }
};
