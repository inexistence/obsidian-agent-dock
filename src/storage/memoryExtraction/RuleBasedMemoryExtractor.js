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
      ...extractPreferenceCandidates(context.prompt),
      ...extractExplicitMemoryCandidates(context.prompt),
      ...extractAgentIdentityCandidates(context.prompt, context.response),
      ...extractSharedCandidates(context.prompt, context.response),
      ...extractTaskCandidates(context.prompt, context.response, context.activeFilePath),
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
    activeFilePath: turn?.activeFilePath || ""
  };
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
    sourceSessionId: candidate.sourceSessionId || context.sourceSessionId || ""
  };
}

function extractPreferenceCandidates(text) {
  const candidates = [];
  const patterns = [
    /(?:我|用户)(?:更)?(?:喜欢|偏好|希望|想要)([^。.!?\n]{2,80})/g,
    /(?:以后|之后|今后)(?:都|请)?([^。.!?\n]{2,80})/g,
    /\b(?:prefer|likes?|wants?)\b([^.!?\n]{2,100})/gi,
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
          confidence: 0.76
        }));
      }
    }
  }

  return candidates;
}

function extractExplicitMemoryCandidates(text) {
  const match = text.match(/(?:记住|remember(?: that)?)(?:[:：\s，,]*)([^。.!?\n]{4,180})/i);
  if (!match) {
    return [];
  }

  return [createCandidate({
    kind: "fact",
    scope: "user",
    text: truncateText(compactText(match[1]), 220),
    confidence: 0.9
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

  return extractIdentityCandidatesByPatterns(text, patterns, 0.68);
}

function extractResponseAgentIdentityCandidates(text) {
  const patterns = [
    /(?:AI|Agent|assistant|助手|智能体)(?:的)?(?:自己|自身|人格|性格|兴趣|偏好|判断|气质)[^。.!?\n]{4,140}/gi,
    /(?:AI|Agent|assistant|助手|智能体)(?:应该|倾向于|偏好|喜欢|持续关注|感兴趣)[^。.!?\n]{4,140}/gi,
    /(?:我)(?:倾向于|偏好|喜欢|持续关注|感兴趣)[^。.!?\n]{4,140}/gi,
    /(?:agentMemory|Agent Identity|协作气质|兴趣方向)[^。.!?\n]{4,140}/gi
  ];

  return extractIdentityCandidatesByPatterns(text, patterns, 0.66);
}

function extractIdentityCandidatesByPatterns(text, patterns, confidence) {
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
        confidence
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
        confidence: 0.64
      }));
      if (candidates.length >= 2) {
        return candidates;
      }
    }
  }

  return candidates;
}

function extractTaskCandidates(prompt, response, activeFilePath) {
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
    confidence: 0.55
  })];
}

function extractDecisionCandidates(response) {
  const sentences = splitSentences(response);
  const decisionMarkers = [
    "建议",
    "推荐",
    "应该",
    "MVP",
    "新增",
    "保留",
    "默认",
    "recommend",
    "should",
    "default",
    "decision"
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
    if (!decisionMarkers.some((marker) => compact.toLowerCase().includes(marker.toLowerCase()))) {
      continue;
    }
    candidates.push(createCandidate({
      kind: "decision",
      scope: "project",
      text: truncateText(compact, 220),
      confidence: 0.62
    }));
  }

  return candidates;
}

function createCandidate(candidate) {
  return Object.assign({
    source: "auto"
  }, candidate);
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
    const key = createExtractionKey(item.kind, item.text);
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
  return /(src\/|main\.js|README|AGENTS|manifest\.json|scripts\/|Obsidian|Codex|plugin|commit|build|review|bug|feature|setting|storage|prompt|实现|修复|增加|设计|重构|提交|插件|设置|记忆|代码|文件)/i.test(text);
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

function createExtractionKey(kind, text) {
  return `${kind}:${compactText(text).toLowerCase().slice(0, 160)}`;
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
