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

function findLastContentIndex(timeline) {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (timeline[index].kind === "content") {
      return index;
    }
  }
  return -1;
}

function groupLiveTimeline(timeline, debugActivity) {
  const groups = [];
  let pendingEvents = [];

  const flushPendingEvents = () => {
    if (pendingEvents.length === 0) {
      return;
    }

    groups.push({
      type: "eventGroup",
      label: getEventGroupLabel(pendingEvents),
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

function getEventGroupLabel(entries) {
  const hasError = entries.some((entry) => entry.kind === "error");
  if (hasError) {
    return `需要关注 ${entries.length} 项`;
  }

  const hasTool = entries.some((entry) => entry.kind === "tool");
  const hasReasoning = entries.some((entry) => entry.kind === "reasoning");
  const hasNotice = entries.some((entry) => entry.kind === "notice");
  const label = hasTool ? "工具调用" : hasReasoning ? "思考" : hasNotice ? "提示" : "活动";
  return `${label} ${entries.length} 项`;
}

module.exports = {
  appendTimelineContent,
  getCompletedTimelineSections,
  getEventGroupLabel,
  groupLiveTimeline,
  groupProcessedEntries,
  shouldShowEvent
};
