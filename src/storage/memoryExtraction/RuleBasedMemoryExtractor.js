const {
  hasGroundedAgentSignal,
  mergeSignalEvidenceContexts,
  normalizeAgentDockSignals
} = require("../../agents/shared/signalEvidence");
const {
  createEventInstanceKey,
  deriveEventTopic,
  inferEventStatus
} = require("../MemoryEventClassifier");

class RuleBasedMemoryExtractor {
  constructor(options = {}) {
    this.candidateExtractor = options.candidateExtractor || new RuleBasedMemoryCandidateExtractor();
    this.classifier = options.classifier || new RuleBasedMemoryClassifier();
  }

  extractTurn(turn) {
    const context = normalizeTurnContext(turn);
    const candidates = this.candidateExtractor.extractCandidates(context);
    return dedupeExtracted(this.classifier.classifyCandidates(candidates, context));
  }
}

class RuleBasedMemoryCandidateExtractor {
  extractCandidates(context) {
    return [
      ...extractAgentDockSignalCandidates(context),
      ...extractPreferenceCandidates(context.prompt),
      ...extractExplicitMemoryCandidates(context.prompt),
      ...extractUserCorrectionCandidates(context.prompt),
      ...extractAgentIdentityCandidates(context.prompt, context.response),
      ...extractSharedCandidates(context.prompt, context.response),
      ...extractTemporalEventCandidates(context.prompt, context.observedAt),
      ...extractTaskCandidates(context.prompt, context.response, context.activeFilePath, context.observedAt),
      ...extractDecisionCandidates(context.response)
    ];
  }
}

class RuleBasedMemoryClassifier {
  classifyCandidates(candidates, context) {
    return candidates
      .map((candidate) => classifyCandidate(candidate, context))
      .filter(Boolean);
  }
}

function normalizeTurnContext(turn) {
  return {
    prompt: compactText(turn?.prompt),
    response: compactText(turn?.response),
    sourceSessionId: turn?.sessionId || "",
    userMessageId: turn?.userMessageId || "",
    assistantMessageId: turn?.assistantMessageId || "",
    memoryRecallManifest: turn?.memoryRecallManifest && typeof turn.memoryRecallManifest === "object"
      ? turn.memoryRecallManifest
      : {},
    observedAt: Number(turn?.observedAt) || Date.now(),
    activeFilePath: turn?.activeFilePath || "",
    agentDockSignals: normalizeAgentDockSignals(turn?.agentDockSignals),
    signalEvidenceContext: mergeSignalEvidenceContexts(
      turn?.signalEvidenceContext,
      { user_message: turn?.prompt, assistant_message: turn?.response }
    )
  };
}

function extractAgentDockSignalCandidates(context) {
  return context.agentDockSignals
    .filter((signal) => signal.type === "memory_candidate")
    .filter((signal) => signal.phase !== "appraisal")
    .filter((signal) => isGroundedMemorySignal(signal, context))
    .map((signal) => createCandidate({
      kind: signal.kind,
      scope: signal.scope,
      text: truncateText(compactText(signal.text), 220),
      confidence: Math.min(0.72, Math.max(0.45, Number(signal.confidence) || 0.6)),
      source: "ai",
      sourceSessionId: context.sourceSessionId,
      evidenceRefs: contextualizeEvidenceRefs(signal.evidenceRefs, context)
    }));
}

function isGroundedMemorySignal(signal, context) {
  if (!signal?.text || !hasGroundedAgentSignal(signal, context.signalEvidenceContext)) {
    return false;
  }
  if (signal.kind === "decision") {
    return extractDecisionCandidates(context.response).length > 0;
  }
  if (signal.kind === "task") {
    return context.response.length >= 20 && hasTaskMemorySignal(context.prompt, context.response);
  }
  if (signal.kind === "identity") {
    return extractAgentIdentityCandidates(context.prompt, context.response).length > 0;
  }
  if (signal.kind === "shared") {
    return extractSharedCandidates(context.prompt, context.response).length > 0;
  }
  return false;
}

function classifyCandidate(candidate, context) {
  if (!candidate || !candidate.text || !isMemoryKind(candidate.kind)) {
    return null;
  }

  return {
    kind: candidate.kind,
    scope: normalizeScope(candidate.scope),
    text: candidate.text,
    confidence: Number(candidate.confidence) || 0.6,
    source: candidate.source || "auto",
    sourceSessionId: candidate.sourceSessionId || context.sourceSessionId || "",
    evidenceRefs: contextualizeEvidenceRefs(candidate.evidenceRefs, context),
    persistence: candidate.persistence || classifyPersistence(candidate),
    temporal: normalizeCandidateTemporal(candidate),
    event: candidate.event || null
  };
}

function extractPreferenceCandidates(text) {
  const candidates = [];
  const patterns = [
    /(?:我|用户)(?:更)?(?:喜欢|偏好|希望|想要)([^。.!?\n]{2,80})/g,
    /(?:我|用户)(?:通常|一般|习惯|倾向于|更愿意)([^。.!?\n]{2,80})/g,
    /(?:我|用户)(?:不再|不希望|不喜欢|不要)([^。.!?\n]{2,80})/g,
    /(?:以后|之后|今后)(?:都|请)?([^。.!?\n]{2,80})/g,
    /(?:以后|之后|今后).{0,12}(?:别|不要|不用|避免)([^。.!?\n]{2,80})/g,
    /(?:默认|尽量|优先)(?:按|用|走|采用)([^。.!?\n]{2,80})/g,
    /\b(?:prefer|likes?|wants?)\b([^.!?\n]{2,100})/gi,
    /\b(?:usually|generally|tend to|would rather)\b([^.!?\n]{2,100})/gi,
    /\b(?:always|never)\b([^.!?\n]{2,100})/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const fragment = compactText(match[0]);
      if (fragment.length >= 8) {
        candidates.push(createCandidate({
          kind: "preference",
          scope: "user",
          text: truncateText(fragment, 180),
          confidence: 0.76,
          evidenceRefs: [{ origin: "user_message", speaker: "user", quote: fragment }]
        }));
      }
    }
  }

  return candidates;
}

function extractUserCorrectionCandidates(text) {
  const source = compactText(text);
  if (!/(?:之前说错了|纠正一下|更正|不是.+而是|改成|改为|I was wrong|correction|rather than|instead)/i.test(source)) {
    return [];
  }
  if (/(?:喜欢|偏好|希望|倾向|prefer|like|want)/i.test(source)) {
    return [];
  }
  return [createCandidate({
    kind: "fact",
    scope: "user",
    text: truncateText(source, 220),
    confidence: 0.86,
    evidenceRefs: [{ origin: "user_message", speaker: "user", quote: truncateText(source, 240) }]
  })];
}

function extractExplicitMemoryCandidates(text) {
  const match = text.match(/(?:记住|记一下|帮我记|保存一下|作为约定|remember(?: that)?|note(?: that)?)(?:[:：\s，,]*)([^。.!?\n]{4,180})/i);
  if (!match) {
    return [];
  }

  return [createCandidate({
    kind: "fact",
    scope: "user",
    text: truncateText(compactText(match[1]), 220),
    confidence: 0.9,
    evidenceRefs: [{ origin: "user_message", speaker: "user", quote: compactText(match[0]) }]
  })];
}

function extractAgentIdentityCandidates(prompt, response) {
  return [
    ...extractPromptAgentIdentityCandidates(prompt),
    ...extractResponseAgentIdentityCandidates(response)
  ].slice(0, 2);
}

function extractPromptAgentIdentityCandidates(text) {
  const patterns = [
    /(?:AI|Agent|assistant|助手|智能体)(?:的)?(?:自己|自身|人格|性格|兴趣|偏好|判断|气质)[^。.!?\n]{4,140}/gi,
    /(?:AI|Agent|assistant|助手|智能体)(?:应该|倾向于|偏好|喜欢|持续关注|感兴趣)[^。.!?\n]{4,140}/gi,
    /(?:agentMemory|Agent Identity|协作气质|兴趣方向)[^。.!?\n]{4,140}/gi
  ];

  return extractIdentityCandidatesByPatterns(text, patterns, 0.68, "user_message");
}

function extractResponseAgentIdentityCandidates(text) {
  const patterns = [
    /(?:AI|Agent|assistant|助手|智能体)(?:的)?(?:自己|自身|人格|性格|兴趣|偏好|判断|气质)[^。.!?\n]{4,140}/gi,
    /(?:AI|Agent|assistant|助手|智能体)(?:应该|倾向于|偏好|喜欢|持续关注|感兴趣)[^。.!?\n]{4,140}/gi,
    /(?:我)(?:倾向于|偏好|喜欢|持续关注|感兴趣)[^。.!?\n]{4,140}/gi,
    /(?:agentMemory|Agent Identity|协作气质|兴趣方向)[^。.!?\n]{4,140}/gi
  ];

  return extractIdentityCandidatesByPatterns(text, patterns, 0.66, "assistant_message");
}

function extractIdentityCandidatesByPatterns(text, patterns, confidence, origin) {
  const candidates = [];
  const source = compactText(text);

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const fragment = compactText(match[0]);
      if (fragment.length < 12 || looksLikeUserPreference(fragment)) {
        continue;
      }
      candidates.push(createCandidate({
        kind: "identity",
        scope: "agent",
        text: truncateText(fragment, 220),
        confidence,
        evidenceRefs: [{
          origin,
          speaker: origin === "user_message" ? "user" : "assistant",
          quote: fragment
        }]
      }));
      if (candidates.length >= 2) {
        return candidates;
      }
    }
  }

  return candidates;
}

function extractSharedCandidates(prompt, response) {
  const text = compactText(`${prompt} ${response}`);
  const candidates = [];
  const patterns = [
    /(?:我们|共同|一起)(?:正在|在|想|要|可以|会|已经|之前)?[^。.!?\n]{0,80}(?:探索|讨论|设计|实现|做成|形成|构建)[^。.!?\n]{4,140}/g,
    /(?:sharedMemory|共同记忆|共同项目记忆|关系连续性)[^。.!?\n]{4,140}/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const fragment = compactText(match[0]);
      if (fragment.length < 12) {
        continue;
      }
      candidates.push(createCandidate({
        kind: "shared",
        scope: "shared",
        text: truncateText(fragment, 220),
        confidence: 0.64,
        evidenceRefs: [{
          origin: prompt.includes(fragment) ? "user_message" : response.includes(fragment) ? "assistant_message" : "local_rules",
          quote: fragment
        }]
      }));
      if (candidates.length >= 2) {
        return candidates;
      }
    }
  }

  return candidates;
}

function extractTaskCandidates(prompt, response, activeFilePath, observedAt = Date.now()) {
  if (prompt.length < 12 || response.length < 20) {
    return [];
  }
  if (!hasTaskMemorySignal(prompt, response)) {
    return [];
  }

  const summary = truncateText(prompt, 180);
  const location = activeFilePath ? ` Active note: ${activeFilePath}.` : "";
  return [createCandidate({
    kind: "task",
    scope: "project",
    text: `Recent task: ${summary}.${location}`,
    confidence: 0.55,
    temporal: {
      class: "state",
      containsRelativeTime: containsRelativeTime(prompt),
      validUntil: inferValidUntil(prompt, observedAt)
    },
    event: {
      topic: compactText(activeFilePath) || deriveEventTopic(prompt),
      status: inferEventStatus(`${prompt} ${response}`),
      occurredAt: observedAt
    },
    evidenceRefs: [{ origin: "user_message", speaker: "user", quote: truncateText(prompt, 220) }]
  })];
}

function extractTemporalEventCandidates(prompt, observedAt = Date.now()) {
  const text = compactText(prompt);
  if (text.length < 2 || text.length > 220) {
    return [];
  }
  const topic = deriveEventTopic(text);
  if (!topic || topic === "work_progress" || !/(?:准备|计划|正在|出发|离开|到达|到家|完成|取消|回家|下班|刚刚|已经|currently|planning|leaving|arrived|finished|cancelled)/i.test(text)) {
    return [];
  }
  return [createCandidate({
    kind: "fact",
    scope: "user",
    text: `Event update: ${text}`,
    confidence: 0.72,
    persistence: "state",
    temporal: {
      class: "event",
      containsRelativeTime: containsRelativeTime(text),
      validUntil: inferValidUntil(text, observedAt)
    },
    event: {
      topic,
      instanceKey: createEventInstanceKey(topic, observedAt),
      status: inferEventStatus(text),
      occurredAt: observedAt
    },
    evidenceRefs: [{ origin: "user_message", speaker: "user", quote: text }]
  })];
}

function extractDecisionCandidates(response) {
  const sentences = splitSentences(response);
  const decisionMarkers = [
    "建议",
    "推荐",
    "应该",
    "决定",
    "采用",
    "选用",
    "约定",
    "不要",
    "废弃",
    "MVP",
    "新增",
    "保留",
    "默认"
  ];
  const englishDecisionPatterns = [
    /\bchoose\b/i,
    /\badopt\b/i,
    /\bavoid\b/i,
    /\bdrop\b/i,
    /\bagreed\b/i,
    /\brecommend\b/i,
    /\bshould\b/i,
    /\bdefault\b/i,
    /\bdecision\b/i,
    /\buse\b.{0,40}\b(?:approach|strategy|implementation|default|rule|method)\b/i
  ];
  const candidates = [];

  for (const sentence of sentences) {
    if (candidates.length >= 2) {
      break;
    }
    const compact = compactText(sentence);
    if (compact.length < 18 || compact.length > 220) {
      continue;
    }
    if (!decisionMarkers.some((marker) => compact.includes(marker))
      && !englishDecisionPatterns.some((pattern) => pattern.test(compact))) {
      continue;
    }
    candidates.push(createCandidate({
      kind: "decision",
      scope: "project",
      text: truncateText(compact, 220),
      confidence: 0.62,
      evidenceRefs: [{ origin: "assistant_message", speaker: "assistant", quote: compact }]
    }));
  }

  return candidates;
}

function createCandidate(candidate) {
  return Object.assign({
    source: "auto"
  }, candidate);
}

function contextualizeEvidenceRefs(value, context) {
  return (Array.isArray(value) ? value : [])
    .filter(Boolean)
    .slice(0, 3)
    .map((item) => {
      const evidence = typeof item === "string" ? { quote: item } : Object.assign({}, item);
      const origin = evidence.origin || evidence.source || "unknown";
      evidence.origin = origin;
      evidence.sourceSessionId = evidence.sourceSessionId || context.sourceSessionId || "";
      evidence.observedAt = evidence.observedAt || context.observedAt;
      if (origin === "user_message") {
        evidence.sourceMessageId = evidence.sourceMessageId || context.userMessageId || "";
        evidence.speaker = "user";
      } else if (origin === "assistant_message") {
        evidence.sourceMessageId = evidence.sourceMessageId || context.assistantMessageId || "";
        evidence.speaker = "assistant";
      } else if (origin === "active_note") {
        evidence.filePath = evidence.filePath || context.activeFilePath || "";
        evidence.speaker = "none";
      } else if (origin === "recalled_memory" && evidence.ref) {
        evidence.sourceMemoryId = evidence.sourceMemoryId
          || context.memoryRecallManifest[evidence.ref]?.memoryId
          || "";
      }
      return evidence;
    });
}

function classifyPersistence(candidate) {
  if (["preference", "identity", "shared"].includes(candidate.kind)) {
    return "durable";
  }
  if (candidate.kind === "task") {
    return "state";
  }
  return "project";
}

function normalizeCandidateTemporal(candidate) {
  const source = candidate.temporal && typeof candidate.temporal === "object"
    ? candidate.temporal
    : {};
  return {
    class: source.class || classifyPersistence(candidate),
    validFrom: Number(source.validFrom) || 0,
    validUntil: Number(source.validUntil) || inferValidUntil(candidate.text),
    containsRelativeTime: source.containsRelativeTime === true || containsRelativeTime(candidate.text)
  };
}

function inferValidUntil(text, now = Date.now()) {
  const source = String(text || "");
  const dateMatch = source.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (dateMatch) {
    const end = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]) + 1);
    return end.getTime();
  }
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  if (/(?:明天|明早|tomorrow)/i.test(source)) {
    return date.getTime() + 2 * 86400000;
  }
  if (/(?:今天|今晚|today|tonight)/i.test(source)) {
    return date.getTime() + 86400000;
  }
  return 0;
}

function containsRelativeTime(text) {
  return /(?:今天|明天|昨天|今晚|明早|现在|正在|待会|稍后|刚刚|已经|today|tomorrow|yesterday|tonight|currently|right now|just now|already|later)/i.test(String(text || ""));
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[。.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean);
}

function dedupeExtracted(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = createExtractionKey(item.kind, item.text, item.event);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(Object.assign({}, item, { key }));
  }
  return deduped;
}

function hasTaskMemorySignal(prompt, response) {
  const text = `${prompt}\n${response}`;
  return /(src\/|main\.js|README|AGENTS|manifest\.json|scripts\/|Obsidian|Codex|plugin|commit|build|review|bug|feature|setting|storage|prompt|实现|修复|增加|新增|设计|重构|提交|插件|设置|记忆|代码|文件|测试|脚本|构建|发布|兼容|回归)/i.test(text);
}

function looksLikeUserPreference(text) {
  return /(?:用户|user|我)(?:更)?(?:喜欢|偏好|希望|想要|prefer|likes?|wants?)/i.test(text)
    && !/(?:AI|Agent|assistant|助手|智能体)/i.test(text);
}

function isMemoryKind(kind) {
  return ["preference", "fact", "decision", "task", "identity", "shared"].includes(kind);
}

function normalizeScope(scope) {
  if (["user", "agent", "shared", "project"].includes(scope)) {
    return scope;
  }
  return "project";
}

function createExtractionKey(kind, text, event) {
  const eventInstance = compactText(event?.instanceKey);
  return `${kind}:${compactText(text).toLowerCase().slice(0, 160)}${eventInstance ? `:${eventInstance}` : ""}`;
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 3) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - 3)}...`;
}

module.exports = {
  RuleBasedMemoryCandidateExtractor,
  RuleBasedMemoryClassifier,
  RuleBasedMemoryExtractor
};
