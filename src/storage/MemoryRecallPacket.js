const { evaluateMemoryReliability } = require("./MemoryReliability");

const DEFAULT_MAX_ITEMS = 4;
const DEFAULT_MAX_CHARS = 1600;

function buildMemoryRecallPacket(items, settings = {}, options = {}) {
  const maxItems = Math.max(1, Number(settings.memoryMaxPromptItems) || DEFAULT_MAX_ITEMS);
  const maxChars = Math.max(200, Number(settings.memoryMaxPromptChars) || DEFAULT_MAX_CHARS);
  const explicit = options.explicit === true;
  const prefix = String(options.refPrefix || "M").replace(/[^A-Z]/gi, "").slice(0, 2) || "M";
  const packet = [];
  const manifest = {};
  let usedChars = 0;

  for (const item of Array.isArray(items) ? items : []) {
    if (packet.length >= maxItems) {
      break;
    }
    const reliability = item.reliability || evaluateMemoryReliability(item, options);
    const ref = `${prefix}${packet.length + 1}`;
    const entry = Object.assign({}, item, { recallRef: ref, reliability });
    const line = formatRecallLine(entry, { explicit });
    if (usedChars + line.length + 1 > maxChars) {
      continue;
    }
    packet.push(entry);
    manifest[ref] = {
      memoryId: item.id || "",
      text: item.text || "",
      evidenceRefs: explicit ? (item.evidenceRefs || []) : []
    };
    usedChars += line.length + 1;
  }

  return { items: packet, manifest };
}

function formatRecallLine(item, options = {}) {
  const reliability = item.reliability || evaluateMemoryReliability(item);
  const date = formatDate(item.updatedAt || item.createdAt);
  const source = getPrimarySource(item);
  const event = item.event?.topic
    ? `${item.event.topic}:${item.event.status || "observed"}#${item.event.sequence || 1}`
    : "";
  const metadata = [item.recallRef, source, reliability.level, date, event].filter(Boolean).join(" | ");
  const label = formatKind(item.kind);
  const parts = [`- [${metadata}] ${label}: ${compactText(item.text)}`];
  if (options.explicit) {
    const evidence = getPrimaryEvidence(item);
    if (evidence) {
      parts.push(`  Evidence [origin=${evidence.origin}; speaker=${evidence.speaker}]: “${evidence.quote}”${formatLocator(evidence)}`);
    }
  }
  return parts.join("\n");
}

function getPrimaryEvidence(item) {
  const evidence = Array.isArray(item?.evidenceRefs) ? item.evidenceRefs : [];
  return evidence.find((entry) => entry.origin === "user_message") || evidence[0] || null;
}

function getPrimarySource(item) {
  if (item?.source === "ai") {
    return "assistant_reflection";
  }
  return getPrimaryEvidence(item)?.origin || item?.source || "unknown";
}

function formatLocator(evidence) {
  const parts = [];
  if (evidence.sourceSessionId) {
    parts.push(`session=${evidence.sourceSessionId}`);
  }
  if (evidence.sourceMessageId) {
    parts.push(`message=${evidence.sourceMessageId}`);
  }
  if (evidence.sourceMemoryId) {
    parts.push(`memory=${evidence.sourceMemoryId}`);
  }
  if (evidence.filePath) {
    parts.push(`file=${evidence.filePath}`);
  }
  const date = formatDate(evidence.observedAt);
  if (date) {
    parts.push(`observed=${date}`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function formatKind(kind) {
  return ({
    preference: "Preference",
    fact: "Fact",
    decision: "Decision",
    task: "State/task",
    identity: "Agent identity",
    shared: "Shared memory"
  })[kind] || "Memory";
}

function formatDate(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString().slice(0, 10)
    : "";
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

module.exports = {
  buildMemoryRecallPacket,
  formatRecallLine
};
