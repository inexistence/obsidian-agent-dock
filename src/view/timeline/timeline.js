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
  const normalized = String(text || "");
  const finalContentIndex = findLastContentIndex(message.timeline);
  if (finalContentIndex === -1) {
    if (normalized) {
      message.timeline.push({ kind: "content", text: normalized });
    }
    return;
  }

  if (normalized) {
    message.timeline[finalContentIndex].text = normalized;
  } else {
    message.timeline.splice(finalContentIndex, 1);
  }
}

function replaceAllTimelineContent(message, text) {
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

module.exports = {
  appendTimelineContent,
  appendTimelineReasoning,
  consolidateTimelineContent,
  replaceAllTimelineContent,
  replaceTimelineFinalContent,
  getCompletedTimelineSections,
  shouldShowEvent,
  _test: {
    appendTimelineContent,
    appendTimelineReasoning,
    consolidateTimelineContent,
    replaceAllTimelineContent,
    replaceTimelineFinalContent,
    findLastContentIndex,
    getCompletedTimelineSections
  }
};
