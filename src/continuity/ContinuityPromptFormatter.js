const DEFAULT_MAX_MOMENTS = 1;
const DEFAULT_MAX_STANCE_ITEMS = 2;
const DEFAULT_MAX_SALIENCE_HINTS = 3;

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
    "These are soft local continuity notes. They may shape tone, pacing, warmth, and occasional relevant references when the current request naturally connects.",
    lines.join("\n"),
    ""
  ].join("\n");
}

function formatToneLine(affect) {
  if (!affect) {
    return "";
  }
  const parts = [`- Current tone: ${affect.label || "steady"}`];
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
  return normalizeArray(memories)
    .slice(0, maxItems)
    .map((memory) => {
      const parts = [
        `- Meaningful recalled moment: ${compactText(memory.summary)}`
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
      if (Array.isArray(memory.salienceAxes) && memory.salienceAxes.length > 0) {
        parts.push(`salience axes: ${memory.salienceAxes.slice(0, 3).join(", ")}`);
      }
      parts.push("use only if this turn naturally connects");
      return parts.join(" | ");
    });
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
      return `- Collaboration stance: ${compactText(item.text)} (${item.axis || "interaction"}, confidence ${formatLevel(item.confidence)}${evidence}${dateAnchor ? `, ${dateAnchor}` : ""}).`;
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
  return `- Salience hints: ${hints}. This is a soft personality reference from ${profile.label || profile.preset}, not an identity claim.`;
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
  _test: {
    formatMemoryDateAnchor,
    formatStanceDateAnchor,
    formatMomentLines,
    formatSalienceLine,
    formatStanceLines,
    formatToneLine
  }
};
