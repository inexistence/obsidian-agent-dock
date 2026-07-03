const { normalizePath } = require("obsidian");

const MEMORY_VERSION = 1;
const MEMORY_DIR_NAME = "memory";
const MEMORY_FILE_NAME = "memory.json";
const MAX_EXTRACTED_ITEMS_PER_TURN = 4;
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "agent",
  "because",
  "before",
  "could",
  "from",
  "have",
  "into",
  "that",
  "the",
  "this",
  "with",
  "would",
  "一个",
  "这个",
  "那个",
  "可以",
  "怎么",
  "什么",
  "我们",
  "你们",
  "他们",
  "功能",
  "用户"
]);

class MemoryStore {
  constructor(plugin) {
    this.plugin = plugin;
    this.adapter = plugin.app.vault.adapter;
    const pluginDir = plugin.manifest.dir || `.obsidian/plugins/${plugin.manifest.id}`;
    this.baseDir = normalizePath(`${pluginDir}/${MEMORY_DIR_NAME}`);
    this.memoryPath = normalizePath(`${this.baseDir}/${MEMORY_FILE_NAME}`);
    this.cache = null;
  }

  async getRelevantMemories(query, settings, options = {}) {
    if (!settings.memoryEnabled) {
      return [];
    }

    const memory = await this.loadMemory();
    const items = memory.items.filter((item) => item && item.text);
    if (items.length === 0) {
      return [];
    }

    const queryText = [
      query,
      options.activeFilePath || "",
      options.workingDirectory || ""
    ].filter(Boolean).join(" ");
    const queryTokens = tokenize(queryText);
    const scored = items
      .map((item) => scoreMemory(item, queryTokens))
      .filter((entry) => entry.matchScore > 0 || isGlobalMemory(entry.item))
      .sort((left, right) => {
        if (right.totalScore !== left.totalScore) {
          return right.totalScore - left.totalScore;
        }
        return normalizeTimestamp(right.item.updatedAt, 0) - normalizeTimestamp(left.item.updatedAt, 0);
      });

    const maxChars = Number(settings.memoryMaxPromptChars) || 8000;
    const maxItems = Math.min(Number(settings.memoryMaxPromptItems) || 12, scored.length);
    const selected = [];
    let used = 0;

    for (const entry of scored) {
      if (selected.length >= maxItems) {
        break;
      }
      const text = formatMemoryLine(entry.item);
      if (used + text.length + 1 > maxChars) {
        continue;
      }
      selected.push(entry.item);
      used += text.length + 1;
    }

    return selected;
  }

  async captureTurn(turn, settings) {
    if (!settings.memoryEnabled || !settings.memoryAutoCapture) {
      return [];
    }

    const memory = await this.loadMemory();
    const extracted = extractMemories(turn)
      .filter((item) => item.text && !containsSensitiveText(item.text))
      .slice(0, MAX_EXTRACTED_ITEMS_PER_TURN);

    if (extracted.length === 0) {
      return [];
    }

    const now = Date.now();
    const existingByKey = new Map(memory.items.map((item) => [item.key, item]));
    const saved = [];

    for (const item of extracted) {
      const key = item.key || createMemoryKey(item.kind, item.text);
      const previous = existingByKey.get(key);
      if (previous) {
        previous.text = item.text;
        previous.kind = item.kind;
        previous.scope = item.scope || previous.scope || "project";
        previous.confidence = Math.max(Number(previous.confidence) || 0, Number(item.confidence) || 0.6);
        previous.updatedAt = now;
        previous.sourceSessionId = item.sourceSessionId || previous.sourceSessionId || "";
        previous.source = item.source || previous.source || "auto";
        saved.push(previous);
        continue;
      }

      const next = {
        id: createMemoryId(),
        key,
        kind: item.kind,
        scope: item.scope || "project",
        text: item.text,
        confidence: Number(item.confidence) || 0.6,
        source: item.source || "auto",
        sourceSessionId: item.sourceSessionId || "",
        createdAt: now,
        updatedAt: now
      };
      memory.items.push(next);
      existingByKey.set(key, next);
      saved.push(next);
    }

    memory.items = limitMemoryItems(memory.items, settings);
    memory.updatedAt = now;
    await this.saveMemory(memory);
    return saved;
  }

  async clearMemory() {
    this.cache = createEmptyMemory();
    try {
      if (await this.adapter.exists(this.memoryPath)) {
        await this.adapter.remove(this.memoryPath);
      }
    } catch (error) {
      console.warn("Agent Dock could not clear memory:", error);
    }
  }

  async loadMemory() {
    if (this.cache) {
      return this.cache;
    }

    try {
      const raw = await this.adapter.read(this.memoryPath);
      this.cache = normalizeMemory(JSON.parse(raw));
      return this.cache;
    } catch {
      this.cache = createEmptyMemory();
      return this.cache;
    }
  }

  async saveMemory(memory) {
    await this.ensureMemoryDir();
    this.cache = normalizeMemory(memory);
    await this.adapter.write(this.memoryPath, `${JSON.stringify(this.cache, null, 2)}\n`);
  }

  async ensureMemoryDir() {
    if (await this.adapter.exists(this.baseDir)) {
      return;
    }
    await this.adapter.mkdir(this.baseDir);
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
  const memories = [];
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
    const key = createMemoryKey(item.kind, item.text);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(Object.assign({}, item, { key }));
  }
  return deduped;
}

function limitMemoryItems(items, settings) {
  const maxItems = Number(settings.memoryMaxItems) || 200;
  return [...items]
    .sort((left, right) => {
      const kindDelta = kindPriority(right.kind) - kindPriority(left.kind);
      if (kindDelta !== 0) {
        return kindDelta;
      }
      return normalizeTimestamp(right.updatedAt, 0) - normalizeTimestamp(left.updatedAt, 0);
    })
    .slice(0, maxItems)
    .sort((left, right) => normalizeTimestamp(left.createdAt, 0) - normalizeTimestamp(right.createdAt, 0));
}

function scoreMemory(item, queryTokens) {
  const itemTokens = tokenize(item.text);
  let matchScore = 0;
  for (const token of itemTokens) {
    if (queryTokens.has(token)) {
      matchScore += token.length > 8 ? 3 : 1;
    }
  }
  let totalScore = matchScore;
  totalScore += kindPriority(item.kind);
  const ageDays = Math.max(0, (Date.now() - normalizeTimestamp(item.updatedAt, Date.now())) / 86400000);
  totalScore += Math.max(0, 2 - ageDays / 30);
  return {
    item,
    matchScore,
    totalScore
  };
}

function isGlobalMemory(item) {
  return (item.kind === "preference" && item.scope === "user")
    || item.kind === "identity";
}

function hasTaskMemorySignal(prompt, response) {
  const text = `${prompt}\n${response}`;
  return /(src\/|main\.js|README|AGENTS|manifest\.json|scripts\/|Obsidian|Codex|plugin|commit|build|review|bug|feature|setting|storage|prompt|实现|修复|增加|设计|重构|提交|插件|设置|记忆|代码|文件)/i.test(text);
}

function kindPriority(kind) {
  if (kind === "identity") {
    return 6;
  }
  if (kind === "preference") {
    return 5;
  }
  if (kind === "shared") {
    return 4;
  }
  if (kind === "fact") {
    return 4;
  }
  if (kind === "decision") {
    return 3;
  }
  return 1;
}

function tokenize(text) {
  const tokens = new Set();
  const normalized = String(text || "").toLowerCase();
  const matches = normalized.match(/[a-z0-9_./-]{3,}|[\u4e00-\u9fff]{2,}/g) || [];
  for (const match of matches) {
    if (!STOP_WORDS.has(match)) {
      tokens.add(match);
    }
  }
  return tokens;
}

function formatMemoryLine(item) {
  const labels = {
    decision: "Decision",
    fact: "Fact",
    identity: "Agent identity",
    preference: "Preference",
    shared: "Shared memory",
    task: "Recent task"
  };
  const label = labels[item.kind] || "Fact";
  return `- ${label}: ${item.text}`;
}

function containsSensitiveText(text) {
  return /(api[_-]?key|password|passwd|secret|token|bearer|private[_-]?key|ssh-rsa|sk-[a-z0-9]|密码|密钥|令牌)/i.test(text);
}

function normalizeMemory(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const items = Array.isArray(source.items)
    ? source.items.map(normalizeMemoryItem).filter(Boolean)
    : [];

  return {
    version: MEMORY_VERSION,
    items,
    updatedAt: normalizeTimestamp(source.updatedAt, Date.now())
  };
}

function normalizeMemoryItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const text = compactText(item.text);
  if (!text) {
    return null;
  }

  const kind = ["preference", "fact", "decision", "task", "identity", "shared"].includes(item.kind)
    ? item.kind
    : "fact";

  return {
    id: typeof item.id === "string" && item.id ? item.id : createMemoryId(),
    key: typeof item.key === "string" && item.key ? item.key : createMemoryKey(kind, text),
    kind,
    scope: normalizeScope(item.scope),
    text,
    confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0.6,
    source: typeof item.source === "string" && item.source ? item.source : "auto",
    sourceSessionId: typeof item.sourceSessionId === "string" ? item.sourceSessionId : "",
    createdAt: normalizeTimestamp(item.createdAt, Date.now()),
    updatedAt: normalizeTimestamp(item.updatedAt, Date.now())
  };
}

function normalizeScope(scope) {
  if (["user", "agent", "shared", "project"].includes(scope)) {
    return scope;
  }
  return "project";
}

function createEmptyMemory() {
  return {
    version: MEMORY_VERSION,
    items: [],
    updatedAt: Date.now()
  };
}

function createMemoryId() {
  return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createMemoryKey(kind, text) {
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

function normalizeTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

module.exports = {
  MemoryStore,
  formatMemoryLine,
  _test: {
    extractMemories,
    isGlobalMemory
  }
};
