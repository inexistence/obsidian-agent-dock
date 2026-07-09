const { formatMemoryLine } = require("../../storage/MemoryStore");

function emitMemoryNotice(onUpdate, memories, translate, keyPrefix = "cursor") {
  if (!Array.isArray(memories) || memories.length === 0) {
    return;
  }

  onUpdate({
    kind: "notice",
    noticeType: "memory_referenced",
    title: translate(`${keyPrefix}.memoryReferenced.title`),
    summary: formatMemoryNoticeSummary(memories, translate, keyPrefix),
    detail: memories.map(formatMemoryLine).join("\n")
  });
}

function emitContextCompressedNotice(onUpdate, context, translate, keyPrefix = "cursor") {
  if (!context?.compressed) {
    return;
  }

  onUpdate({
    kind: "notice",
    title: translate(`${keyPrefix}.contextCompressed.title`),
    summary: translate(`${keyPrefix}.contextCompressed.summary`, {
      original: formatNumber(context.originalChars),
      prompt: formatNumber(context.promptChars),
      limit: formatNumber(context.limitChars)
    })
  });
}

function formatMemoryNoticeSummary(memories, translate, keyPrefix = "cursor") {
  const count = memories.length;
  const lines = [
    translate(`${keyPrefix}.memoryReferenced.summary`, {
      count,
      noteLabel: count === 1 ? "note" : "notes"
    })
  ];
  const visibleMemories = memories.slice(0, 5).map(formatMemoryLine);
  lines.push(...visibleMemories);
  if (memories.length > visibleMemories.length) {
    lines.push(translate(`${keyPrefix}.memoryReferenced.more`, {
      count: memories.length - visibleMemories.length
    }));
  }
  return lines.join("\n");
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

module.exports = {
  emitContextCompressedNotice,
  emitMemoryNotice,
  formatMemoryNoticeSummary
};
