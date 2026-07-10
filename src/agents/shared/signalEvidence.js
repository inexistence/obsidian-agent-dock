const MAX_AGENT_DOCK_SIGNALS = 10;
const MAX_SIGNAL_EVIDENCE_CONTEXT_CHARS = 12000;
const SIGNAL_EVIDENCE_ORIGINS = [
  "user_message",
  "assistant_message",
  "recalled_memory",
  "active_note",
  "tool_result",
  "unknown"
];

function hasVisibleSignalEvidence(candidateText, ...visibleParts) {
  const candidate = normalizeComparableText(candidateText);
  const visible = normalizeComparableText(visibleParts.filter(Boolean).join("\n"));
  if (!candidate || !visible) {
    return false;
  }
  if (visible.includes(candidate)) {
    return true;
  }

  const candidateTokens = extractEvidenceTokens(candidate);
  const visibleTokens = extractEvidenceTokens(visible);
  const matched = [...candidateTokens].filter((token) => visibleTokens.has(token));
  return matched.length >= 2 || matched.some((token) => token.length >= 6);
}

function hasExactVisibleSignalEvidence(candidateText, ...visibleParts) {
  const candidate = normalizeComparableText(candidateText);
  const visible = normalizeComparableText(visibleParts.filter(Boolean).join("\n"));
  return Boolean(candidate && visible && visible.includes(candidate));
}

function hasGroundedAgentSignal(signal, evidenceContextOrUserMessage, assistantMessage = "") {
  const evidenceContext = normalizeSignalEvidenceContext(
    evidenceContextOrUserMessage,
    assistantMessage
  );
  const evidenceRefs = getSignalEvidenceReferences(signal);
  if (evidenceRefs.length > 0) {
    return evidenceRefs.some((item) => hasGroundedEvidenceReference(item, evidenceContext));
  }
  return hasVisibleSignalEvidence(signal?.text, ...getAllSignalEvidenceText(evidenceContext));
}

function getSignalEvidenceReferences(signal) {
  if (Array.isArray(signal?.evidenceRefs) && signal.evidenceRefs.length > 0) {
    return signal.evidenceRefs.slice(0, 3);
  }
  return (Array.isArray(signal?.evidence) ? signal.evidence : [])
    .filter(Boolean)
    .slice(0, 3)
    .map((item) => typeof item === "string"
      ? { origin: "unknown", quote: item }
      : { origin: item.origin || item.source || "unknown", quote: item.quote || item.text || "" });
}

function hasGroundedEvidenceReference(item, evidenceContext) {
  const origin = String(item?.origin || "unknown");
  const quote = item?.quote || "";
  if (origin !== "unknown") {
    return hasExactVisibleSignalEvidence(quote, evidenceContext[origin]);
  }
  return hasExactVisibleSignalEvidence(quote, ...getAllSignalEvidenceText(evidenceContext));
}

function normalizeSignalEvidenceContext(value, assistantMessage = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createSignalEvidenceContext({
      user_message: value,
      assistant_message: assistantMessage
    });
  }
  return createSignalEvidenceContext(value);
}

function createSignalEvidenceContext(value = {}) {
  const context = {};
  for (const origin of SIGNAL_EVIDENCE_ORIGINS) {
    context[origin] = truncateEvidenceContext(value[origin]);
  }
  return context;
}

function mergeSignalEvidenceContexts(...values) {
  const merged = createSignalEvidenceContext();
  for (const value of values) {
    const context = normalizeSignalEvidenceContext(value);
    for (const origin of SIGNAL_EVIDENCE_ORIGINS) {
      merged[origin] = mergeSignalEvidenceText(merged[origin], context[origin]);
    }
  }
  return merged;
}

function mergeSignalEvidenceText(existing, incoming) {
  const left = String(existing || "");
  const right = String(incoming || "");
  if (!left) {
    return truncateEvidenceContext(right);
  }
  if (!right || left.includes(right)) {
    return truncateEvidenceContext(left);
  }
  if (right.includes(left)) {
    return truncateEvidenceContext(right);
  }
  return truncateEvidenceContext(`${left}\n${right}`);
}

function getAllSignalEvidenceText(context) {
  return SIGNAL_EVIDENCE_ORIGINS
    .map((origin) => context[origin])
    .filter(Boolean);
}

function normalizeAgentDockSignals(value) {
  return (Array.isArray(value) ? value : [])
    .filter((signal) => signal && typeof signal === "object")
    .slice(0, MAX_AGENT_DOCK_SIGNALS);
}

function truncateEvidenceContext(value) {
  const text = Array.isArray(value)
    ? value.filter(Boolean).join("\n")
    : String(value || "");
  if (text.length <= MAX_SIGNAL_EVIDENCE_CONTEXT_CHARS) {
    return text;
  }
  return text.slice(0, MAX_SIGNAL_EVIDENCE_CONTEXT_CHARS);
}

function extractEvidenceTokens(text) {
  const tokens = new Set();
  const source = normalizeComparableText(text);
  for (const word of source.match(/[a-z0-9_/-]{4,}/g) || []) {
    tokens.add(word);
  }
  for (const run of source.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.add(run.slice(index, index + 2));
    }
  }
  return tokens;
}

function normalizeComparableText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  MAX_AGENT_DOCK_SIGNALS,
  createSignalEvidenceContext,
  hasGroundedAgentSignal,
  hasVisibleSignalEvidence,
  mergeSignalEvidenceContexts,
  normalizeAgentDockSignals,
  _test: {
    extractEvidenceTokens,
    hasExactVisibleSignalEvidence,
    normalizeComparableText,
    normalizeSignalEvidenceContext
  }
};
