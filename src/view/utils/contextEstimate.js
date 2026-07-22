const { CUSTOM_ASSISTANT_STYLE_MAX_CHARS, DEFAULT_SETTINGS } = require("../../settings");

const BUILT_IN_ASSISTANT_STYLE_ESTIMATE_CHARS = 700;
const ASSISTANT_STYLE_PROMPT_OVERHEAD_CHARS = 220;

function estimateContextChars(messages, draft, settings) {
  const transcriptChars = messages.reduce((total, message) => {
    if (message?.role !== "user" && message?.role !== "assistant") {
      return total;
    }
    return total + String(message.content || "").length + 16;
  }, 0);
  const draftChars = String(draft || "").length + 16;
  const styleChars = estimateAssistantStyleChars(settings);
  return transcriptChars + draftChars + styleChars;
}

function estimateAssistantStyleChars(settings) {
  if (settings.assistantStyle !== "custom") {
    return BUILT_IN_ASSISTANT_STYLE_ESTIMATE_CHARS;
  }

  const customChars = String(settings.customAssistantStyle || "").length;
  return ASSISTANT_STYLE_PROMPT_OVERHEAD_CHARS
    + Math.min(customChars, CUSTOM_ASSISTANT_STYLE_MAX_CHARS);
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
