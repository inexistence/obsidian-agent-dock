function formatExpressionPrompt(policy) {
  if (!policy || Number(policy.confidence) < 0.18) {
    return "";
  }

  const lines = [
    "Expression context:",
    "Source: locally computed expression policy, speaker: none. These are not user or assistant statements. They are soft expression guidelines for this turn only and shape tone and phrasing, not facts, permissions, or task priority.",
    `- Signal mix: ${formatSignals(policy.signals)}.`,
    `- Expression: ${policy.tone || "steady"}, intensity ${policy.intensity || "low"}, intimacy ${policy.intimacy || "reserved"}, expressiveness ${policy.expressiveness || "contained"}.`
  ];

  if (Array.isArray(policy.guidance) && policy.guidance.length > 0) {
    lines.push(`- Guidance: ${policy.guidance.slice(0, 4).join("; ")}.`);
  }
  lines.push("");
  return lines.join("\n");
}

function formatSignals(signals) {
  const entries = Object.entries(signals || {})
    .filter(([, value]) => Number(value) >= 0.18)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, 4)
    .map(([key, value]) => `${key} ${formatLevel(value)}`);
  return entries.length > 0 ? entries.join(", ") : "neutral";
}

function formatLevel(value) {
  const number = Number(value) || 0;
  if (number >= 0.66) {
    return "high";
  }
  if (number >= 0.38) {
    return "medium";
  }
  return "low";
}

module.exports = {
  formatExpressionPrompt,
  _test: {
    formatSignals,
    formatLevel
  }
};
