const { containsSensitiveText } = require("./sensitiveText");

const MAX_EVIDENCE_ITEMS = 3;
const MAX_EVIDENCE_QUOTE_CHARS = 240;
const ALLOWED_ORIGINS = new Set([
  "user_message",
  "assistant_message",
  "active_note",
  "tool_result",
  "recalled_memory",
  "assistant_reflection",
  "local_rules",
  "legacy_summary",
  "unknown"
]);

function normalizeMemoryEvidence(value, fallback = {}) {
  const items = Array.isArray(value) ? value : [];
  const normalized = [];
  const seen = new Set();

  for (const item of items) {
    const evidence = normalizeEvidenceItem(item, fallback);
    if (!evidence) {
      continue;
    }
    const key = `${evidence.origin}:${evidence.speaker}:${evidence.quote}:${evidence.sourceMessageId}:${evidence.sourceMemoryId}:${evidence.filePath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(evidence);
    if (normalized.length >= MAX_EVIDENCE_ITEMS) {
      break;
    }
  }

  return normalized;
}

function normalizeEvidenceItem(item, fallback = {}) {
  if (typeof item === "string") {
    item = { quote: item };
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const fullQuote = compactText(item.quote || item.text);
  const quote = truncateText(fullQuote, MAX_EVIDENCE_QUOTE_CHARS);
  if (!quote || containsSensitiveText(fullQuote)) {
    return null;
  }

  const origin = normalizeOrigin(item.origin || item.source || fallback.origin);
  const speaker = deriveSpeaker(origin, item.speaker || fallback.speaker);
  const observedAt = normalizeTimestamp(item.observedAt || fallback.observedAt, Date.now());
  const sourceSessionId = compactText(item.sourceSessionId || fallback.sourceSessionId);
  const sourceMessageId = compactText(item.sourceMessageId || fallback.sourceMessageId);
  const sourceMemoryId = compactText(item.sourceMemoryId || fallback.sourceMemoryId);
  const filePath = compactText(item.filePath || fallback.filePath);

  return {
    id: compactText(item.id) || createEvidenceId(),
    origin,
    speaker,
    quote,
    sourceSessionId,
    sourceMessageId,
    sourceMemoryId,
    filePath,
    observedAt,
    truncated: item.truncated === true
      || fullQuote.length > MAX_EVIDENCE_QUOTE_CHARS
      || (Boolean(item.contentHash) && fullQuote.endsWith("..."))
  };
}

function mergeMemoryEvidence(existing, incoming, fallback = {}) {
  return normalizeMemoryEvidence([
    ...normalizeMemoryEvidence(incoming, fallback),
    ...normalizeMemoryEvidence(existing, fallback)
  ], fallback);
}

function createLegacySummaryEvidence(item) {
  const text = compactText(item?.text);
  if (!text) {
    return [];
  }
  return normalizeMemoryEvidence([{
    origin: "legacy_summary",
    speaker: "none",
    quote: text,
    sourceSessionId: item?.sourceSessionId || "",
    observedAt: item?.updatedAt || item?.createdAt || Date.now()
  }]);
}

function deriveSpeaker(origin, requested) {
  if (origin === "user_message") {
    return "user";
  }
  if (origin === "assistant_message" || origin === "assistant_reflection") {
    return "assistant";
  }
  if (origin === "recalled_memory" && ["user", "assistant", "none"].includes(requested)) {
    return requested;
  }
  return "none";
}

function normalizeOrigin(value) {
  const origin = compactText(value).toLowerCase();
  return ALLOWED_ORIGINS.has(origin) ? origin : "unknown";
}

function createEvidenceId() {
  return `evidence-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function normalizeTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

module.exports = {
  MAX_EVIDENCE_ITEMS,
  MAX_EVIDENCE_QUOTE_CHARS,
  createLegacySummaryEvidence,
  deriveSpeaker,
  mergeMemoryEvidence,
  normalizeMemoryEvidence
};
