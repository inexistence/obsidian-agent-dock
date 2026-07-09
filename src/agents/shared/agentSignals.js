const MAX_SIGNAL_TEXT_CHARS = 240;
const MAX_AXES = 3;

const TERMINAL_AGENT_DOCK_COMMENT_PATTERN = /(?:\n\s*)?<!--\s*agent-dock:([a-z-]+)([^|>]*)\|\s*([\s\S]*?)\s*-->\s*$/i;
const TERMINAL_AGENT_DOCK_SUSPECT_PATTERN = /(?:^|\n)\s*<!--\s*agent-dock:[^\n]*$/i;
const AXIS_PATTERN = /^[a-z_ -]{2,32}$/i;

function extractAgentDockSignals(text) {
  const raw = String(text || "");
  const match = raw.match(TERMINAL_AGENT_DOCK_COMMENT_PATTERN);
  if (!match) {
    const suspect = raw.match(TERMINAL_AGENT_DOCK_SUSPECT_PATTERN);
    if (suspect) {
      return {
        visibleText: raw.slice(0, suspect.index).trimEnd(),
        signals: [],
        rawSignalText: suspect[0].trim(),
        invalidSignal: true
      };
    }
    return {
      visibleText: raw,
      signals: [],
      rawSignalText: "",
      invalidSignal: false
    };
  }

  const visibleText = raw.slice(0, match.index).trimEnd();
  const type = normalizeType(match[1]);
  const attrs = parseAttributes(match[2]);
  const signalText = truncateText(compactText(match[3]), MAX_SIGNAL_TEXT_CHARS);
  const rawSignalText = match[0].trim();
  const signals = [];

  if (type === "deep-memory" && signalText) {
    signals.push({
      type: "deep_memory",
      text: signalText,
      axes: normalizeAxes(attrs.axes),
      importance: normalizeImportance(attrs.importance),
      raw: rawSignalText
    });
  }

  return {
    visibleText,
    signals,
    rawSignalText,
    invalidSignal: signals.length === 0
  };
}

function formatInvalidAgentDockSignalActivity(signalResult, title = "Agent Dock signal omitted") {
  if (!signalResult?.invalidSignal) {
    return null;
  }
  return {
    kind: "activity",
    title,
    detail: signalResult.rawSignalText || "Invalid terminal agent-dock signal omitted."
  };
}

function formatAgentDockSignalNotice(signal, settings, keyPrefix, translate) {
  if (!signal || signal.type !== "deep_memory") {
    return null;
  }
  return {
    kind: "notice",
    noticeType: "deep_memory_candidate",
    title: translate(`${keyPrefix}.deepMemoryCandidate.title`),
    summary: translate(`${keyPrefix}.deepMemoryCandidate.summary`),
    detail: signal.text
  };
}

function normalizeType(value) {
  return String(value || "").trim().toLowerCase();
}

function parseAttributes(text) {
  const attrs = {};
  const pattern = /([a-zA-Z][\w-]*)=("[^"]*"|'[^']*'|[^\s]+)/g;
  let match;
  while ((match = pattern.exec(String(text || ""))) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2].replace(/^["']|["']$/g, "");
    attrs[key] = value;
  }
  return attrs;
}

function normalizeAxes(value) {
  return String(value || "")
    .split(",")
    .map((axis) => compactText(axis).toLowerCase().replace(/\s+/g, "_"))
    .filter((axis) => AXIS_PATTERN.test(axis))
    .slice(0, MAX_AXES);
}

function normalizeImportance(value) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(1, number));
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

module.exports = {
  extractAgentDockSignals,
  formatInvalidAgentDockSignalActivity,
  formatAgentDockSignalNotice,
  _test: {
    parseAttributes,
    normalizeAxes
  }
};
