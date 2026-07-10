const { redactSensitiveText } = require("../storage/sensitiveText");

const AI_PATTERN_AXES = new Set([
  "decision_style",
  "collaboration_texture",
  "attention_pattern",
  "communication_pacing",
  "collaboration_style",
  "repair_style"
]);

const SUPPORTIVE_OUTCOMES = new Set([
  "accepted",
  "implementation_followup",
  "productive_deepening"
]);

function normalizeAiPatternCandidate(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const key = normalizeCandidateKey(item.key);
  const axis = compactText(item.axis);
  const summary = truncateText(redactSensitiveText(compactText(item.summary)), 440);
  const evidenceQuote = truncateText(redactSensitiveText(compactText(item.evidenceQuote)), 180);
  if (!key || !AI_PATTERN_AXES.has(axis) || !summary || !evidenceQuote) {
    return null;
  }
  return {
    key,
    axis,
    summary,
    evidenceQuote,
    confidence: Math.min(0.72, clampUnit(Number(item.confidence) || 0)),
    evidenceOrigin: item.evidenceOrigin === "user_message" ? "user_message" : ""
  };
}

function buildAiPatternCandidateRegistry(episodes, settings) {
  const minEvidence = Math.max(2, Number(settings?.interactionMemoryMinEvidence) || 2);
  const groups = new Map();
  const sorted = (Array.isArray(episodes) ? episodes : [])
    .filter(Boolean)
    .slice()
    .sort((left, right) => timestamp(left) - timestamp(right));

  for (const episode of sorted) {
    const candidate = normalizeAiPatternCandidate(episode.aiReflectionContribution?.patternCandidate);
    if (!candidate || candidate.evidenceOrigin !== "user_message") {
      continue;
    }
    if (!groups.has(candidate.key)) {
      groups.set(candidate.key, {
        key: candidate.key,
        axis: candidate.axis,
        summary: candidate.summary,
        evidenceQuote: candidate.evidenceQuote,
        confidenceValues: [],
        evidenceEpisodes: [],
        conflictingEpisodeIds: [],
        createdAt: episode.createdAt || episode.updatedAt || Date.now(),
        updatedAt: episode.updatedAt || episode.createdAt || Date.now()
      });
    }
    const group = groups.get(candidate.key);
    group.updatedAt = Math.max(group.updatedAt, episode.updatedAt || episode.createdAt || 0);
    if (!sameCandidateDefinition(group, candidate)) {
      group.conflictingEpisodeIds.push(episode.id);
      continue;
    }
    if (isSupportiveCandidateEpisode(episode)) {
      group.evidenceEpisodes.push(episode);
      group.confidenceValues.push(candidate.confidence);
    }
  }

  return [...groups.values()].map((group) => ({
    key: group.key,
    axis: group.axis,
    summary: group.summary,
    evidenceQuote: group.evidenceQuote,
    evidenceEpisodes: group.evidenceEpisodes,
    evidenceEpisodeIds: group.evidenceEpisodes.map((episode) => episode.id),
    evidenceCount: group.evidenceEpisodes.length,
    conflictCount: group.conflictingEpisodeIds.length,
    conflictingEpisodeIds: group.conflictingEpisodeIds,
    averageConfidence: average(group.confidenceValues),
    minEvidence,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt
  }));
}

function sameCandidateDefinition(left, right) {
  return left.key === right.key
    && left.axis === right.axis
    && compactText(left.summary) === compactText(right.summary);
}

function isSupportiveCandidateEpisode(episode) {
  return episode?.repairPath?.outcome === "accepted"
    || SUPPORTIVE_OUTCOMES.has(compactText(episode?.outcomeHint));
}

function normalizeCandidateKey(value) {
  const key = compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return /^[a-z][a-z0-9_]{2,63}$/.test(key) ? key : "";
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function timestamp(item) {
  return Number(item?.createdAt || item?.updatedAt || 0);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxChars) {
  const text = String(value || "");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function clampUnit(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

module.exports = {
  AI_PATTERN_AXES,
  buildAiPatternCandidateRegistry,
  isSupportiveCandidateEpisode,
  normalizeAiPatternCandidate,
  normalizeCandidateKey,
  sameCandidateDefinition
};
