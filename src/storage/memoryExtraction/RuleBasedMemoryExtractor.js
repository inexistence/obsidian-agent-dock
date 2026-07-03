class RuleBasedMemoryExtractor {
  extractTurn(turn) {
    return extractMemories(turn);
  }
}

function extractMemories(turn) {
  const prompt = compactText(turn.prompt);
  const response = compactText(turn.response);
  const sourceSessionId = turn.sessionId || "";
  const activeFilePath = turn.activeFilePath || "";
  const items = [];

  for (const preference of extractPreferenceMemories(prompt)) {
    items.push(Object.assign(preference, { sourceSessionId }));
  }

  const explicit = extractExplicitMemory(prompt);
  if (explicit) {
    items.push(Object.assign(explicit, { sourceSessionId }));
  }

  for (const identity of extractAgentIdentityMemories(prompt, response)) {
    items.push(Object.assign(identity, { sourceSessionId }));
  }

  for (const shared of extractSharedMemories(prompt, response)) {
    items.push(Object.assign(shared, { sourceSessionId }));
  }

  const task = summarizeTurnTask(prompt, response, activeFilePath);
  if (task) {
    items.push(Object.assign(task, { sourceSessionId }));
  }

  for (const decision of extractDecisionMemories(response, sourceSessionId)) {
    items.push(decision);
  }

  return dedupeExtracted(items);
}

function extractPreferenceMemories(text) {
  const memories = [];
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
        memories.push({
          kind: "preference",
          scope: "user",
          text: truncateText(fragment, 180),
          confidence: 0.76,
          source: "auto"
        });
      }
    }
  }

  return memories;
}

function extractAgentIdentityMemories(prompt, response) {
  return [
    ...extractPromptAgentIdentityMemories(prompt),
    ...extractResponseAgentIdentityMemories(response)
  ].slice(0, 2);
}

function extractPromptAgentIdentityMemories(text) {
  const patterns = [
    /(?:AI|Agent|assistant|助手|智能体)(?:的)?(?:自己|自身|人格|性格|兴趣|偏好|判断|气质)[^。.!?\n]{4,140}/gi,
    /(?:AI|Agent|assistant|助手|智能体)(?:应该|倾向于|偏好|喜欢|持续关注|感兴趣)[^。.!?\n]{4,140}/gi,
    /(?:agentMemory|Agent Identity|协作气质|兴趣方向)[^。.!?\n]{4,140}/gi
  ];

  return extractIdentityByPatterns(text, patterns, 0.68);
}

function extractResponseAgentIdentityMemories(text) {
  const patterns = [
    /(?:AI|Agent|assistant|助手|智能体)(?:的)?(?:自己|自身|人格|性格|兴趣|偏好|判断|气质)[^。.!?\n]{4,140}/gi,
    /(?:AI|Agent|assistant|助手|智能体)(?:应该|倾向于|偏好|喜欢|持续关注|感兴趣)[^。.!?\n]{4,140}/gi,
    /(?:我)(?:倾向于|偏好|喜欢|持续关注|感兴趣)[^。.!?\n]{4,140}/gi,
    /(?:agentMemory|Agent Identity|协作气质|兴趣方向)[^。.!?\n]{4,140}/gi
  ];

  return extractIdentityByPatterns(text, patterns, 0.66);
}

function extractIdentityByPatterns(text, patterns, confidence) {
  const memories = [];
  const source = compactText(text);

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const fragment = compactText(match[0]);
      if (fragment.length < 12 || looksLikeUserPreference(fragment)) {
        continue;
      }
      memories.push({
        kind: "identity",
        scope: "agent",
        text: truncateText(fragment, 220),
        confidence,
        source: "auto"
      });
      if (memories.length >= 2) {
        return memories;
      }
    }
  }

  return memories;
}

function extractSharedMemories(prompt, response) {
  const text = compactText(`${prompt} ${response}`);
  const memories = [];
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
      memories.push({
        kind: "shared",
        scope: "shared",
        text: truncateText(fragment, 220),
        confidence: 0.64,
        source: "auto"
      });
      if (memories.length >= 2) {
        return memories;
      }
    }
  }

  return memories;
}

function extractExplicitMemory(text) {
  const match = text.match(/(?:记住|remember(?: that)?)(?:[:：\s，,]*)([^。.!?\n]{4,180})/i);
  if (!match) {
    return null;
  }

  return {
    kind: "fact",
    scope: "user",
    text: truncateText(compactText(match[1]), 220),
    confidence: 0.9,
    source: "auto"
  };
}

function looksLikeUserPreference(text) {
  return /(?:用户|user|我)(?:更)?(?:喜欢|偏好|希望|想要|prefer|likes?|wants?)/i.test(text)
    && !/(?:AI|Agent|assistant|助手|智能体)/i.test(text);
}

function summarizeTurnTask(prompt, response, activeFilePath) {
  if (prompt.length < 12 || response.length < 20) {
    return null;
  }
  if (!hasTaskMemorySignal(prompt, response)) {
    return null;
  }

  const summary = truncateText(prompt, 180);
  const location = activeFilePath ? ` Active note: ${activeFilePath}.` : "";
  return {
    kind: "task",
    scope: "project",
    text: `Recent task: ${summary}.${location}`,
    confidence: 0.55,
    source: "auto"
  };
}

function extractDecisionMemories(response, sourceSessionId) {
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
  const memories = [];

  for (const sentence of sentences) {
    if (memories.length >= 2) {
      break;
    }
    const compact = compactText(sentence);
    if (compact.length < 18 || compact.length > 220) {
      continue;
    }
    if (!decisionMarkers.some((marker) => compact.toLowerCase().includes(marker.toLowerCase()))) {
      continue;
    }
    memories.push({
      kind: "decision",
      scope: "project",
      text: truncateText(compact, 220),
      confidence: 0.62,
      source: "auto",
      sourceSessionId
    });
  }

  return memories;
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
  RuleBasedMemoryExtractor
};
