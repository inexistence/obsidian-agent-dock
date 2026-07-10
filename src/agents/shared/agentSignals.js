const { redactSensitiveText } = require("../../storage/sensitiveText");
const {
  normalizeAiPatternCandidate
} = require("../../interaction/InteractionPatternCandidates");
const {
  AFFECT_SIGNAL_TONES,
  INTERACTION_SIGNAL_SHAPES,
  MEMORY_SIGNAL_SCOPES,
  SALIENCE_SIGNAL_AXES
} = require("./reflectionProtocol");

const MAX_SIGNAL_TEXT_CHARS = 240;
const MAX_AXES = 3;
const MAX_REFLECTION_JSON_CHARS = 3000;
const MAX_REFLECTION_EVIDENCE_ITEMS = 3;
const MAX_REFLECTION_EVIDENCE_CHARS = 180;
const MAX_REFLECTION_AUDIT_SOURCE_CHARS = 12000;
const REFLECTION_EVIDENCE_ORIGINS = new Set([
  "user_message",
  "assistant_message",
  "recalled_memory",
  "active_note",
  "tool_result",
  "unknown"
]);
const REFLECTION_EVIDENCE_SPEAKERS = new Set(["user", "assistant", "none"]);
const TERMINAL_AGENT_DOCK_COMMENT_PATTERN = /(?:\n\s*)?<!--\s*agent-dock:([a-z-]+)([^|>]*)\|\s*([\s\S]*?)\s*-->\s*$/i;
const TERMINAL_AGENT_DOCK_SUSPECT_PATTERN = /(?:^|\n)\s*<!--\s*agent-dock:[^\n]*$/i;
const LEADING_REFLECTION_PATTERN = /^\s*<!--\s*agent-dock:reflection\b([^|>]*)\|\s*([\s\S]*?)\s*-->\s*/i;
const AXIS_PATTERN = /^[a-z_ -]{2,32}$/i;

function extractAgentDockSignals(text) {
  const raw = String(text || "");
  const leading = extractLeadingReflection(raw);
  const terminal = extractTerminalAgentDockSignal(leading.visibleText);
  const signals = leading.signals.concat(terminal.signals);
  const rawSignalText = [leading.rawSignalText, terminal.rawSignalText]
    .filter(Boolean)
    .join("\n");

  return {
    visibleText: terminal.visibleText,
    signals,
    rawSignalText,
    invalidSignal: leading.invalidSignal || terminal.invalidSignal
  };
}

function extractLeadingReflection(text) {
  const raw = String(text || "");
  const match = raw.match(LEADING_REFLECTION_PATTERN);
  if (!match) {
    return {
      visibleText: raw,
      signals: [],
      rawSignalText: "",
      invalidSignal: false
    };
  }

  const attrs = parseAttributes(match[1]);
  const phase = normalizeReflectionPhase(attrs.phase, "appraisal");
  const rawSignalText = match[0].trim();
  const signals = phase === "appraisal"
    ? parseReflectionEnvelope(String(match[2] || "").trim(), rawSignalText, phase)
    : [];
  return {
    visibleText: raw.slice(match[0].length),
    signals,
    rawSignalText,
    invalidSignal: signals.length === 0
  };
}

function extractTerminalAgentDockSignal(text) {
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
  const signalBody = String(match[3] || "").trim();
  const signalText = truncateText(compactText(signalBody), MAX_SIGNAL_TEXT_CHARS);
  const rawSignalText = match[0].trim();
  let signals = [];

  if (type === "reflection") {
    signals = parseReflectionEnvelope(
      signalBody,
      rawSignalText,
      normalizeReflectionPhase(attrs.phase, "outcome")
    );
  } else if (type === "deep-memory" && signalText) {
    signals.push({
      type: "deep_memory",
      text: signalText,
      axes: normalizeAxes(attrs.axes),
      importance: normalizeImportance(attrs.importance),
      raw: rawSignalText
    });
  } else if (type === "memory" && signalText) {
    const kind = normalizeMemoryKind(attrs.kind);
    const scope = normalizeMemoryScope(attrs.scope, kind);
    if (kind && scope) {
      signals.push({
        type: "memory_candidate",
        text: signalText,
        kind,
        scope,
        confidence: normalizeConfidence(attrs.confidence),
        raw: rawSignalText
      });
    }
  } else if (type === "interaction" && signalText) {
    const shapes = normalizeAllowedList(attrs.shapes, INTERACTION_SIGNAL_SHAPES, 3);
    if (shapes.length > 0) {
      signals.push({
        type: "interaction_candidate",
        text: signalText,
        shapes,
        confidence: normalizeConfidence(attrs.confidence),
        raw: rawSignalText
      });
    }
  } else if (type === "affect" && signalText) {
    const tone = normalizeAllowedValue(attrs.tone, AFFECT_SIGNAL_TONES);
    if (tone) {
      signals.push({
        type: "affect_candidate",
        text: signalText,
        tone,
        confidence: normalizeConfidence(attrs.confidence),
        raw: rawSignalText
      });
    }
  } else if (type === "salience" && signalText) {
    const axes = normalizeAllowedList(attrs.axes, SALIENCE_SIGNAL_AXES, MAX_AXES);
    if (axes.length > 0) {
      signals.push({
        type: "salience_observation",
        text: signalText,
        axes,
        confidence: normalizeConfidence(attrs.confidence),
        raw: rawSignalText
      });
    }
  }

  return {
    visibleText,
    signals,
    rawSignalText,
    invalidSignal: signals.length === 0
  };
}

function parseReflectionEnvelope(text, rawSignalText, phase = "outcome") {
  if (!text || text.length > MAX_REFLECTION_JSON_CHARS) {
    return [];
  }

  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    return [];
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return [];
  }

  const evidenceRefs = normalizeEvidence(envelope.evidence);
  if (evidenceRefs.length === 0) {
    return [];
  }
  const evidence = evidenceRefs.map((item) => item.quote);

  const signals = [];
  appendReflectionMemory(signals, envelope.memory, evidence, rawSignalText);
  appendReflectionDeepMemory(signals, envelope.deepMemory || envelope.deep_memory, evidence, rawSignalText);
  appendReflectionInteraction(signals, envelope.interaction, evidence, rawSignalText);
  appendReflectionAffect(signals, envelope.affect, evidence, rawSignalText);
  appendReflectionSalience(signals, envelope.salience, evidence, rawSignalText);

  return signals.map((signal, index) => Object.assign(signal, {
    envelope: "reflection_v1",
    envelopeIndex: index,
    phase: normalizeReflectionPhase(phase, "outcome"),
    evidenceRefs
  }));
}

function normalizeReflectionPhase(value, fallback = "outcome") {
  const phase = compactText(value).toLowerCase();
  return ["appraisal", "outcome"].includes(phase) ? phase : fallback;
}

function appendReflectionMemory(signals, value, evidence, raw) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const kind = normalizeMemoryKind(value.kind);
  const scope = normalizeMemoryScope(value.scope, kind);
  const text = normalizeReflectionText(value.text || value.summary);
  if (kind && scope && text) {
    signals.push({
      type: "memory_candidate",
      kind,
      scope,
      text,
      confidence: normalizeConfidence(value.confidence),
      evidence,
      raw
    });
  }
}

function appendReflectionDeepMemory(signals, value, evidence, raw) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const text = normalizeReflectionText(value.text || value.summary);
  if (text) {
    signals.push({
      type: "deep_memory",
      text,
      axes: normalizeAllowedList(value.axes, SALIENCE_SIGNAL_AXES, MAX_AXES),
      importance: normalizeImportance(value.importance),
      evidence,
      raw
    });
  }
}

function appendReflectionInteraction(signals, value, evidence, raw) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const text = normalizeReflectionText(value.text || value.summary);
  const shapes = normalizeAllowedList(value.shapes, INTERACTION_SIGNAL_SHAPES, 3);
  const rawPatternCandidate = value.patternCandidate || value.pattern_candidate;
  const patternCandidate = normalizeAiPatternCandidate(rawPatternCandidate
    ? Object.assign({}, rawPatternCandidate, {
      confidence: Math.min(0.72, normalizeConfidence(rawPatternCandidate.confidence))
    })
    : null);
  if (text && (shapes.length > 0 || patternCandidate)) {
    signals.push({
      type: "interaction_candidate",
      text,
      shapes,
      patternCandidate,
      confidence: normalizeConfidence(value.confidence),
      evidence,
      raw
    });
  }
}

function appendReflectionAffect(signals, value, evidence, raw) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const text = normalizeReflectionText(value.text || value.why || value.summary);
  const tone = normalizeAllowedValue(value.tone, AFFECT_SIGNAL_TONES);
  if (text && tone) {
    signals.push({
      type: "affect_candidate",
      text,
      tone,
      confidence: normalizeConfidence(value.confidence),
      evidence,
      raw
    });
  }
}

function appendReflectionSalience(signals, value, evidence, raw) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const text = normalizeReflectionText(value.text || value.why || value.summary);
  const axes = normalizeAllowedList(value.axes, SALIENCE_SIGNAL_AXES, MAX_AXES);
  if (text && axes.length > 0) {
    signals.push({
      type: "salience_observation",
      text,
      axes,
      confidence: normalizeConfidence(value.confidence),
      evidence,
      raw
    });
  }
}

function normalizeEvidence(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeEvidenceReference)
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => (
      candidate.origin === item.origin && candidate.quote === item.quote
    )) === index)
    .slice(0, MAX_REFLECTION_EVIDENCE_ITEMS);
}

function normalizeEvidenceReference(value) {
  if (typeof value === "string") {
    const quote = truncateText(compactText(value), MAX_REFLECTION_EVIDENCE_CHARS);
    return quote ? { origin: "unknown", speaker: "none", quote } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const quote = truncateText(compactText(value.quote || value.text), MAX_REFLECTION_EVIDENCE_CHARS);
  if (!quote) {
    return null;
  }
  const requestedOrigin = compactText(value.origin || value.source).toLowerCase();
  const origin = REFLECTION_EVIDENCE_ORIGINS.has(requestedOrigin)
    ? requestedOrigin
    : "unknown";
  const requestedSpeaker = compactText(value.speaker).toLowerCase();
  return {
    origin,
    speaker: getEvidenceSpeaker(origin, requestedSpeaker),
    quote
  };
}

function getEvidenceSpeaker(origin, requestedSpeaker = "none") {
  if (origin === "user_message") {
    return "user";
  }
  if (origin === "assistant_message") {
    return "assistant";
  }
  if (origin === "recalled_memory" && REFLECTION_EVIDENCE_SPEAKERS.has(requestedSpeaker)) {
    return requestedSpeaker;
  }
  return "none";
}

function normalizeReflectionText(value) {
  return truncateText(compactText(value), MAX_SIGNAL_TEXT_CHARS);
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
  if (!signal) {
    return null;
  }
  if (signal.type === "memory_candidate") {
    return {
      kind: "notice",
      noticeType: "memory_candidate",
      title: translate(`${keyPrefix}.memoryCandidate.title`),
      summary: translate(`${keyPrefix}.memoryCandidate.summary`),
      detail: signal.text
    };
  }
  if (["interaction_candidate", "affect_candidate", "salience_observation"].includes(signal.type)) {
    const noticeType = signal.type;
    const translationKey = {
      interaction_candidate: "interactionCandidate",
      affect_candidate: "affectCandidate",
      salience_observation: "salienceObservation"
    }[signal.type];
    return {
      kind: "notice",
      noticeType,
      title: translate(`${keyPrefix}.${translationKey}.title`),
      summary: translate(`${keyPrefix}.${translationKey}.summary`),
      detail: signal.text,
      agentDockSignal: signal
    };
  }
  if (signal.type !== "deep_memory") {
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

function formatAgentDockReflectionNotice(signals, settings, keyPrefix, translate) {
  const items = (Array.isArray(signals) ? signals : [])
    .filter((signal) => signal?.envelope === "reflection_v1");
  if (items.length === 0) {
    return null;
  }
  return {
    kind: "activity",
    noticeType: "reflection_candidate",
    noticeGroupId: "agent_dock_reflection",
    noticeItemCount: items.length,
    insertBeforeLastContent: true,
    title: translate(`${keyPrefix}.reflectionCandidate.title`),
    summary: translate(`${keyPrefix}.reflectionCandidate.summary`, { count: items.length }),
    detail: items.map((signal) => `- ${signal.phase || "outcome"}/${signal.type}: ${signal.text}`).join("\n"),
    agentDockSignals: items,
    auditItems: items.map((signal) => buildReflectionAuditItem(signal, translate))
  };
}

function buildReflectionAuditItem(signal, translate) {
  const phase = translate(`reflectionAudit.phase.${signal.phase || "outcome"}`);
  const type = translate(`reflectionAudit.type.${signal.type || "unknown"}`);
  const source = translate("reflectionAudit.source");
  const evidence = Array.isArray(signal.evidenceRefs) && signal.evidenceRefs.length > 0
    ? signal.evidenceRefs
    : (Array.isArray(signal.evidence) ? signal.evidence : []).map(normalizeEvidenceReference).filter(Boolean);
  const badges = [phase, type]
    .concat(formatReflectionSourceKind(signal.reflectionSource?.kind, translate))
    .concat(signal.tone || "")
    .concat(signal.axes || [])
    .filter(Boolean);
  return {
    title: `${phase} · ${type}`,
    summary: signal.text,
    type,
    source,
    badges,
    fields: [
      createReflectionAuditField(translate("reflectionAudit.field.phase"), phase),
      createReflectionAuditField(translate("reflectionAudit.field.type"), type),
      createReflectionAuditField(getReflectionTextLabel(signal.type, translate), signal.text),
      createReflectionAuditField(
        translate("reflectionAudit.field.evidence"),
        evidence.map((item) => formatReflectionEvidence(item, translate)).join("\n")
      ),
      createReflectionAuditField(translate("reflectionAudit.field.confidence"), formatReflectionNumber(signal.confidence)),
      createReflectionAuditField(translate("reflectionAudit.field.importance"), formatReflectionNumber(signal.importance)),
      createReflectionAuditField(translate("reflectionAudit.field.tone"), signal.tone),
      createReflectionAuditField(translate("reflectionAudit.field.axes"), formatReflectionList(signal.axes)),
      createReflectionAuditField(translate("reflectionAudit.field.shapes"), formatReflectionList(signal.shapes)),
      createReflectionAuditField(translate("reflectionAudit.field.patternCandidate"), formatReflectionPatternCandidate(signal.patternCandidate)),
      createReflectionAuditField(translate("reflectionAudit.field.kind"), signal.kind),
      createReflectionAuditField(translate("reflectionAudit.field.scope"), signal.scope),
      createReflectionAuditField(
        translate("reflectionAudit.field.sourceMessageType"),
        formatReflectionSourceKind(signal.reflectionSource?.kind, translate)
      ),
      createReflectionAuditField(
        translate("reflectionAudit.field.filteredSource"),
        signal.reflectionSource?.visibleText,
        { preformatted: true, maxChars: MAX_REFLECTION_AUDIT_SOURCE_CHARS }
      ),
      createReflectionAuditField(
        translate("reflectionAudit.field.rawSource"),
        signal.reflectionSource?.rawText,
        { preformatted: true, debugOnly: true, maxChars: MAX_REFLECTION_AUDIT_SOURCE_CHARS }
      )
    ].filter(Boolean)
  };
}

function formatReflectionPatternCandidate(value) {
  if (!value) {
    return "";
  }
  return `${value.key} · ${value.axis} · ${value.summary} · evidence: ${value.evidenceQuote}`;
}

function getReflectionTextLabel(type, translate) {
  const key = {
    memory_candidate: "memoryContent",
    deep_memory: "memorySummary",
    interaction_candidate: "responseStrategy",
    affect_candidate: "toneReason",
    salience_observation: "salienceReason"
  }[type] || "signalDescription";
  return translate(`reflectionAudit.field.${key}`);
}

function createReflectionAuditField(label, value, options = {}) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!label || !text) {
    return null;
  }
  const safeText = redactSensitiveText(text);
  const field = {
    label,
    value: truncateText(safeText, options.maxChars || 1400)
  };
  if (options.debugOnly) {
    field.debugOnly = true;
  }
  if (options.preformatted) {
    field.preformatted = true;
  }
  return field;
}

function formatReflectionSourceKind(kind, translate) {
  if (kind !== "commentary" && kind !== "content") {
    return "";
  }
  const normalized = kind;
  return translate(`reflectionAudit.sourceKind.${normalized}`);
}

function formatReflectionNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "";
  }
  return number.toFixed(2).replace(/\.?0+$/, "");
}

function formatReflectionList(value) {
  return (Array.isArray(value) ? value : []).filter(Boolean).join(", ");
}

function formatReflectionEvidence(item, translate) {
  const origin = translate(`reflectionAudit.origin.${item.origin || "unknown"}`);
  const speaker = translate(`reflectionAudit.speaker.${item.speaker || "none"}`);
  return `- [${origin}; ${translate("reflectionAudit.field.speaker")}: ${speaker}] ${item.quote}`;
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

function normalizeConfidence(value) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) {
    return 0.6;
  }
  return Math.max(0, Math.min(1, number));
}

function normalizeMemoryKind(value) {
  const kind = compactText(value).toLowerCase();
  return MEMORY_SIGNAL_SCOPES[kind] ? kind : "";
}

function normalizeMemoryScope(value, kind) {
  const requiredScope = MEMORY_SIGNAL_SCOPES[kind] || "";
  const requestedScope = compactText(value).toLowerCase();
  if (!requiredScope || (requestedScope && requestedScope !== requiredScope)) {
    return "";
  }
  return requiredScope;
}

function normalizeAllowedValue(value, allowed) {
  const normalized = compactText(value).toLowerCase().replace(/\s+/g, "-");
  return allowed.has(normalized) ? normalized : "";
}

function normalizeAllowedList(value, allowed, limit) {
  return String(value || "")
    .split(",")
    .map((item) => compactText(item).toLowerCase().replace(/[\s-]+/g, "_"))
    .map((item) => allowed.has(item) ? item : item.replace(/_/g, "-"))
    .filter((item) => allowed.has(item))
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, limit);
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
  formatAgentDockReflectionNotice,
  _test: {
    parseAttributes,
    normalizeAxes,
    normalizeMemoryKind,
    normalizeMemoryScope,
    normalizeAllowedList,
    normalizeAllowedValue,
    normalizeEvidence,
    parseReflectionEnvelope
  }
};
