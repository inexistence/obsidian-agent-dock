const HIGH_SUPPORT_THRESHOLD = 0.78;
const MEDIUM_SUPPORT_THRESHOLD = 0.5;

const SOURCE_BASE_SCORES = Object.freeze({
  user_message: 0.82,
  active_note: 0.78,
  assistant_message: 0.62,
  recalled_memory: 0.58,
  assistant_reflection: 0.52,
  local_rules: 0.46,
  legacy_summary: 0.5,
  tool_result: 0.68,
  unknown: 0.38
});

function evaluateMemoryReliability(item, options = {}) {
  const now = Number(options.now) || Date.now();
  const evidence = Array.isArray(item?.evidenceRefs) ? item.evidenceRefs : [];
  const strongest = evidence.reduce((best, entry) => (
    Math.max(best, SOURCE_BASE_SCORES[entry?.origin] ?? SOURCE_BASE_SCORES.unknown)
  ), SOURCE_BASE_SCORES[item?.source] ?? SOURCE_BASE_SCORES.unknown);
  const reasons = [];
  let score = strongest;

  const exactEvidenceCount = evidence.filter((entry) => entry?.quote && entry.origin !== "legacy_summary").length;
  if (exactEvidenceCount > 0) {
    score += 0.08;
    reasons.push("exact_visible_evidence");
  } else {
    reasons.push("summary_only");
  }
  if (new Set(evidence.map((entry) => `${entry.origin}:${entry.sourceMessageId || entry.filePath || entry.sourceSessionId}`)).size >= 2) {
    score += 0.05;
    reasons.push("multiple_sources");
  }
  const activeNoteEvidence = evidence.filter((entry) => (
    entry.origin === "active_note"
    && options.activeFilePath
    && entry.filePath === options.activeFilePath
  ));
  if (activeNoteEvidence.length > 0 && typeof options.activeFileContent === "string") {
    if (activeNoteEvidence.some((entry) => evidenceMatchesContent(entry, options.activeFileContent))) {
      score += 0.06;
      reasons.push("current_file_matches");
    } else {
      score -= 0.25;
      reasons.push("current_file_changed");
    }
  }
  const evidenceFileContents = options.evidenceFileContents && typeof options.evidenceFileContents === "object"
    ? options.evidenceFileContents
    : {};
  const checkedFileEvidence = evidence.filter((entry) => (
    entry.origin === "active_note"
    && entry.filePath
    && Object.prototype.hasOwnProperty.call(evidenceFileContents, entry.filePath)
    && entry.filePath !== options.activeFilePath
  ));
  if (checkedFileEvidence.some((entry) => !evidenceMatchesContent(
    entry,
    evidenceFileContents[entry.filePath]
  ))) {
    score -= 0.25;
    reasons.push("stored_file_changed");
  } else if (checkedFileEvidence.length > 0) {
    score += 0.04;
    reasons.push("stored_files_match");
  }

  const captureConfidence = clampUnit(item?.captureConfidence ?? item?.confidence, 0.6);
  score += (captureConfidence - 0.5) * 0.12;

  const temporal = normalizeTemporal(item?.temporal, item?.kind);
  const ageDays = Math.max(0, (now - normalizeTimestamp(item?.updatedAt, now)) / 86400000);
  const agePenalty = getAgePenalty(temporal.class, ageDays);
  if (agePenalty > 0) {
    score -= agePenalty;
    reasons.push("aged_evidence");
  }

  const expired = isExpired(item, now, temporal);
  const contested = item?.status === "contested" || (Array.isArray(item?.conflictIds) && item.conflictIds.length > 0);
  if (expired) {
    reasons.push("expired");
  }
  if (contested) {
    reasons.push("conflicting_evidence");
  }
  const retired = item?.status === "corrected" || item?.status === "superseded";
  if (retired) {
    reasons.push(item.status);
    score = Math.min(score, 0.3);
  }

  score = clampUnit(score, 0.4);
  if (evidence.length > 0 && evidence.every((entry) => entry.origin === "legacy_summary")) {
    score = Math.min(score, 0.7);
    reasons.push("legacy_support_cap");
  }
  if (item?.source === "ai" && !evidence.some((entry) => containsComparableText(entry.quote, item.text))) {
    score = Math.min(score, 0.74);
    reasons.push("ai_summary_support_cap");
  }
  let level = score >= HIGH_SUPPORT_THRESHOLD
    ? "high"
    : score >= MEDIUM_SUPPORT_THRESHOLD ? "medium" : "low";
  if (retired) {
    level = "low";
  } else if (contested) {
    level = "contested";
  } else if (expired) {
    level = "expired";
  }

  return {
    score,
    level,
    reasons,
    stale: expired || agePenalty >= 0.18,
    contested,
    expired
  };
}

function evidenceMatchesContent(evidence, content) {
  const quote = String(evidence?.quote || "");
  if (!quote) {
    return false;
  }
  const comparableQuote = evidence?.truncated === true && quote.endsWith("...")
    ? quote.slice(0, -3)
    : quote;
  return Boolean(comparableQuote && String(content || "").includes(comparableQuote));
}

function containsComparableText(container, candidate) {
  const normalize = (value) => String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const left = normalize(container);
  const right = normalize(candidate);
  return Boolean(left && right && left.includes(right));
}

function normalizeTemporal(value, kind) {
  const source = value && typeof value === "object" ? value : {};
  const allowed = ["durable", "project", "state", "event"];
  return {
    class: allowed.includes(source.class) ? source.class : inferTemporalClass(kind),
    validFrom: normalizeTimestamp(source.validFrom, 0),
    validUntil: normalizeTimestamp(source.validUntil, 0),
    containsRelativeTime: source.containsRelativeTime === true
  };
}

function inferTemporalClass(kind) {
  if (["preference", "identity", "shared"].includes(kind)) {
    return "durable";
  }
  if (kind === "task") {
    return "state";
  }
  return "project";
}

function isExpired(item, now, temporal = normalizeTemporal(item?.temporal, item?.kind)) {
  if (item?.status === "expired") {
    return true;
  }
  if (temporal.validUntil > 0 && temporal.validUntil < now) {
    return true;
  }
  const ageMs = now - normalizeTimestamp(item?.updatedAt, now);
  if (temporal.class === "state" && temporal.containsRelativeTime && ageMs > 48 * 3600000) {
    return true;
  }
  if (
    temporal.class === "event"
    && ["planned", "active"].includes(item?.event?.status)
    && ageMs > (temporal.containsRelativeTime ? 48 * 3600000 : 7 * 86400000)
  ) {
    return true;
  }
  return temporal.class === "state" && ageMs > 30 * 86400000;
}

function getAgePenalty(temporalClass, ageDays) {
  if (temporalClass === "durable") {
    return Math.min(0.1, ageDays / 3650);
  }
  if (temporalClass === "project") {
    return Math.min(0.22, ageDays / 820);
  }
  if (temporalClass === "event") {
    return Math.min(0.3, ageDays / 300);
  }
  return Math.min(0.45, ageDays / 90);
}

function clampUnit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, number));
}

function normalizeTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

module.exports = {
  evaluateMemoryReliability,
  inferTemporalClass,
  isExpired,
  normalizeTemporal,
  _test: {
    evidenceMatchesContent
  }
};
