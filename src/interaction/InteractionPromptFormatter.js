function formatInteractionStancePrompt(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }
  const personaItems = items.filter((item) => item.kind === "stable_persona");
  const stanceItems = items.filter((item) => item.kind !== "stable_persona");
  const sections = [
    "Interaction memory:",
    "These are soft local interaction notes inferred from visible prior collaboration. Use them only when they fit the current request."
  ];
  if (personaItems.length > 0) {
    sections.push(
      "Long-term interaction persona:",
      personaItems.map(formatStanceItem).join("\n")
    );
  }
  if (stanceItems.length > 0) {
    sections.push(
      "Relevant interaction stance for this turn:",
      stanceItems.map(formatStanceItem).join("\n")
    );
  }
  sections.push("");
  return sections.join("\n");
}

function formatStanceItem(item) {
  const confidence = item.confidence >= 0.72 ? "high" : item.confidence >= 0.5 ? "medium" : "low";
  const evidence = item.evidenceCount ? `, ${item.evidenceCount} episodes` : "";
  return `- [${item.axis}, confidence ${confidence}${evidence}] ${item.text}`;
}

module.exports = {
  formatInteractionStancePrompt,
  formatStanceItem
};
