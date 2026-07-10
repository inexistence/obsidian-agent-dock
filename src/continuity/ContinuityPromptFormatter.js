const DEFAULT_MAX_MOMENTS = 1;
const DEFAULT_MAX_STANCE_ITEMS = 2;
const DEFAULT_MAX_SALIENCE_HINTS = 3;
const MAX_MOMENT_EVIDENCE_ITEMS = 2;
const MAX_MOMENT_EVIDENCE_CHARS = 140;

const { rankSalienceAxes } = require("../persona/PersonaProfile");

function formatAssistantContinuityPrompt(options = {}) {
  const tone = formatToneLine(options.workingAffect);
  const moments = formatMomentLines(options.deepMemories, DEFAULT_MAX_MOMENTS);
  const stance = formatStanceLines(options.interactionStance, DEFAULT_MAX_STANCE_ITEMS);
  const salience = formatSalienceLine(options.personaProfile, DEFAULT_MAX_SALIENCE_HINTS);
  const lines = [tone].concat(moments, stance, salience).filter(Boolean);
  if (lines.length === 0) {
    return "";
  }

  return [
    "Assistant continuity context:",
    "These are soft local continuity notes with explicit provenance. Local synthesis and inferred state are not user or assistant quotes. They may shape tone, pacing, warmth, and occasional relevant references when the current request naturally connects.",
    lines.join("\n"),
    ""
  ].join("\n");
}

function formatToneLine(affect) {
  if (!affect) {
    return "";
  }
  const parts = [`- Current tone: ${affect.label || "steady"} [origin=locally_computed_affect; speaker=none; decaying state, not a statement]`];
  if (affect.secondaryLabel) {
    parts.push(`secondary ${affect.secondaryLabel}`);
  }
  if (Number.isFinite(Number(affect.strength))) {
    parts.push(`strength ${formatLevel(affect.strength)}`);
  }
  if (Number.isFinite(Number(affect.ageMinutes))) {
    parts.push(`${formatAgeMinutes(affect.ageMinutes)} old`);
  }
  const guidance = [];
  if (Number(affect.warmth) >= 0.72) {
    guidance.push("keep warmth present");
  }
  if (Number(affect.focus) >= 0.72) {
    guidance.push("stay focused");
  }
  if (Number(affect.tension) >= 0.45) {
    guidance.push("handle tension carefully");
  }
  return `${parts.join(", ")}.${guidance.length ? ` ${guidance.join("; ")}.` : ""}`;
}

function formatMomentLines(memories, maxItems) {
  return selectMomentMemories(memories, maxItems)
    .map((memory) => {
      const parts = [
        formatMomentSummary(memory)
      ];
      const dateAnchor = formatMemoryDateAnchor(memory);
      if (dateAnchor) {
        parts.push(dateAnchor);
      }
      if (memory.whyItMatters) {
        parts.push(`why it matters: ${compactText(memory.whyItMatters)}`);
      }
      if (memory.feltSense) {
        parts.push(`felt sense: ${compactText(memory.feltSense)}`);
      }
      const evidence = formatMomentEvidence(memory);
      if (evidence.length > 0) {
        parts.push(...evidence);
      }
      if (Array.isArray(memory.salienceAxes) && memory.salienceAxes.length > 0) {
        parts.push(`salience axes: ${memory.salienceAxes.slice(0, 3).join(", ")}`);
      }
      parts.push("use only if this turn naturally connects");
      return parts.join(" | ");
    });
}

function formatMomentSummary(memory) {
  return `- Meaningful recalled moment [origin=local_memory_synthesis; speaker=none; not a quote]: ${compactText(memory?.summary)}`;
}

function selectMomentMemories(memories, maxItems = DEFAULT_MAX_MOMENTS) {
  return normalizeArray(memories).slice(0, maxItems);
}

function formatMomentEvidence(memory) {
  return [
    {
      text: memory?.userExcerpt,
      origin: "user_message",
      speaker: "user"
    },
    {
      text: memory?.assistantExcerpt,
      origin: "assistant_message",
      speaker: "assistant"
    }
  ]
    .filter((item) => compactText(item.text))
    .slice(0, MAX_MOMENT_EVIDENCE_ITEMS)
    .map((item) => (
      `evidence [origin=${item.origin}; speaker=${item.speaker}; quote]: “${compactEvidenceExcerpt(item.text)}”`
    ));
}

function compactEvidenceExcerpt(value) {
  const text = compactText(value);
  const sentenceEnds = [...text.matchAll(/[。！？!?](?:[”’"']+)?|[.](?:[”’"']+)?(?=\s|$)/g)]
    .map((match) => match.index + match[0].length)
    .filter((end) => end <= MAX_MOMENT_EVIDENCE_CHARS)
    .slice(0, 2);
  if (sentenceEnds.length >= 2) {
    return text.slice(0, sentenceEnds[1]).trim();
  }
  if (text.length <= MAX_MOMENT_EVIDENCE_CHARS) {
    return text;
  }
  if (sentenceEnds.length === 1) {
    return text.slice(0, sentenceEnds[0]).trim();
  }
  return `${text.slice(0, MAX_MOMENT_EVIDENCE_CHARS - 1).trim()}…`;
}

function formatMemoryDateAnchor(memory) {
  return formatDateAnchor(memory, {
    singlePrefix: "recorded",
    dualPrefix: "recorded",
    includeRelativeGuidance: true
  });
}

function formatDateAnchor(item, options = {}) {
  const createdDate = formatDate(item?.createdAt);
  const updatedDate = formatDate(item?.updatedAt);
  if (!createdDate && !updatedDate) {
    return "";
  }
  const singlePrefix = options.singlePrefix || "recorded";
  const dualPrefix = options.dualPrefix || singlePrefix;
  const anchor = createdDate && updatedDate && createdDate !== updatedDate
    ? `${dualPrefix} ${createdDate}, updated ${updatedDate}`
    : `${singlePrefix} ${createdDate || updatedDate}`;
  const guidance = options.includeRelativeGuidance
    ? "; interpret relative words like tomorrow/yesterday relative to that recorded date unless the current turn says otherwise"
    : "";
  return `date anchor: ${anchor}${guidance}`;
}

function formatStanceDateAnchor(item) {
  return formatDateAnchor(item, {
    singlePrefix: "evidence updated",
    dualPrefix: "evidence since",
    includeRelativeGuidance: true
  });
}

function formatStanceLines(items, maxItems) {
  return normalizeArray(items)
    .slice(0, maxItems)
    .map((item) => {
      const evidence = item.evidenceCount ? `, ${item.evidenceCount} episodes` : "";
      const dateAnchor = formatStanceDateAnchor(item);
      return `- Collaboration stance: ${compactText(item.text)} [origin=local_episode_inference; speaker=none; not quote] (${item.axis || "interaction"}, confidence ${formatLevel(item.confidence)}${evidence}${dateAnchor ? `, ${dateAnchor}` : ""}).`;
    });
}

function formatSalienceLine(profile, maxItems) {
  if (!profile || profile.preset === "none") {
    return "";
  }
  const axes = rankSalienceAxes(profile, { limit: maxItems });
  if (axes.length === 0) {
    return "";
  }
  const hints = axes.map((axis) => `${axis.label} ${formatLevel(axis.value)}`).join(", ");
  return `- Salience hints: ${hints}. [origin=configured_persona_preset; speaker=none; not a statement] This is a soft personality reference from ${profile.label || profile.preset}, not an identity claim.`;
}

function formatLevel(value) {
  const number = Number(value) || 0;
  if (number >= 0.72) {
    return "high";
  }
  if (number >= 0.5) {
    return "medium";
  }
  return "low";
}

function formatAgeMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${Math.round(minutes / 60)} hr`;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatDate(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

module.exports = {
  formatAssistantContinuityPrompt,
  formatMomentSummary,
  selectMomentMemories,
  _test: {
    formatMemoryDateAnchor,
    compactEvidenceExcerpt,
    formatMomentEvidence,
    formatStanceDateAnchor,
    formatMomentLines,
    formatSalienceLine,
    formatStanceLines,
    formatToneLine
  }
};
