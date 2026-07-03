const { DEFAULT_SETTINGS } = require("../settings");

function estimateContextChars(messages, draft, settings) {
  const transcriptChars = messages.reduce((total, message) => {
    return total + String(message.content || "").length + 16;
  }, 0);
  const draftChars = String(draft || "").length + 16;
  const noteChars = settings.includeActiveNote
    ? (Number(settings.activeNoteMaxChars) || DEFAULT_SETTINGS.activeNoteMaxChars)
    : 0;
  return transcriptChars + draftChars + noteChars;
}

function formatCompactNumber(value) {
  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  return String(value);
}

module.exports = {
  estimateContextChars,
  formatCompactNumber
};
