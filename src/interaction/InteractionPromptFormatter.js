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
  const dateAnchor = formatDateAnchor(item);
  return `- [${item.axis}, confidence ${confidence}${evidence}${dateAnchor ? `, ${dateAnchor}` : ""}] ${item.text}`;
}

function formatDateAnchor(item) {
  const createdDate = formatDate(item?.createdAt);
  const updatedDate = formatDate(item?.updatedAt);
  if (!createdDate && !updatedDate) {
    return "";
  }
  const anchor = createdDate && updatedDate && createdDate !== updatedDate
    ? `evidence since ${createdDate}, updated ${updatedDate}`
    : `evidence updated ${createdDate || updatedDate}`;
  return `${anchor}; interpret relative dates relative to the evidence date`;
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
  formatInteractionStancePrompt,
  formatStanceItem,
  _test: {
    formatDateAnchor
  }
};
