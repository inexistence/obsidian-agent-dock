const { normalizePath } = require("obsidian");

const { RuleBasedMemoryExtractor } = require("./memoryExtraction/RuleBasedMemoryExtractor");
const { expandSearchText } = require("./searchQuery");
const { containsSensitiveText } = require("./sensitiveText");
const { ensureLocalDataPath, getLegacyPluginPath, getLocalDataPath } = require("./localDataPath");

const MEMORY_VERSION = 1;
const MEMORY_DIR_NAME = "memory";
const MEMORY_FILE_NAME = "memory.json";
const MAX_EXTRACTED_ITEMS_PER_TURN = 4;
const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_SEARCH_MAX_CHARS = 3000;
const MIN_AUTOMATIC_PROMPT_MATCH_SCORE = 2;
const WORKING_DIRECTORY_SCORE_WEIGHT = 0.1;
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
  constructor(plugin, options = {}) {
    this.plugin = plugin;
    this.adapter = plugin.app.vault.adapter;
    this.baseDir = getLocalDataPath(plugin, MEMORY_DIR_NAME);
    this.memoryPath = normalizePath(`${this.baseDir}/${MEMORY_FILE_NAME}`);
    this.legacyMemoryPath = getLegacyPluginPath(plugin, MEMORY_DIR_NAME, MEMORY_FILE_NAME);
    this.cache = null;
    this.extractor = options.extractor || new RuleBasedMemoryExtractor();
  }

  async getRelevantMemories(query, settings, options = {}) {
    if (!settings.memoryEnabled) {
      return [];
    }

    const memory = await this.loadMemory();
    const items = memory.items.filter(isPromptSafeMemory);
    if (items.length === 0) {
      return [];
    }

    const queryTokenInfo = buildQueryTokenInfo([
      { source: "prompt", text: query },
      { source: "activeFilePath", text: options.activeFilePath || "" },
      { source: "workingDirectory", text: options.workingDirectory || "" }
    ]);
    const scored = items
      .map((item) => scoreMemory(item, queryTokenInfo.tokens, queryTokenInfo.sources))
      .filter((entry) => isAutomaticallyRelevant(entry))
      .sort(compareAutomaticallyRelevantMemories);

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
      selected.push(Object.assign({}, entry.item, {
        referenceAudit: createReferenceAudit(entry)
      }));
      used += text.length + 1;
    }

    return selected;
  }

  async searchMemories(query, settings, options = {}) {
    if (!settings.memoryEnabled || !settings.memoryAgentSearchEnabled) {
      return [];
    }

    const memory = await this.loadMemory();
    const items = memory.items.filter(isPromptSafeMemory);
    if (items.length === 0) {
      return [];
    }

    const queryTokenInfo = buildQueryTokenInfo([{ source: "prompt", text: query }]);
    const scored = items
      .map((item) => scoreMemory(item, queryTokenInfo.tokens, queryTokenInfo.sources))
      .filter((entry) => entry.matchScore > 0)
      .sort(compareScoredMemories);

    const limit = Math.max(1, Math.min(Number(options.limit) || DEFAULT_SEARCH_LIMIT, scored.length));
    const maxChars = Number(options.maxChars) || DEFAULT_SEARCH_MAX_CHARS;
    const selected = [];
    let used = 0;

    for (const entry of scored) {
      if (selected.length >= limit) {
        break;
      }
      const text = formatMemoryLine(entry.item);
      if (used + text.length + 1 > maxChars) {
        continue;
      }
      selected.push(Object.assign({}, entry.item, {
        matchScore: entry.matchScore,
        score: entry.totalScore,
        referenceAudit: createReferenceAudit(entry)
      }));
      used += text.length + 1;
    }

    return selected;
  }

  async captureTurn(turn, settings) {
    if (!settings.memoryEnabled || !settings.memoryAutoCapture) {
      return [];
    }

    const memory = await this.loadMemory();
    const extracted = this.extractor.extractTurn(turn)
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
        previous.updateAudit = createUpdateAudit(item, true);
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
        updatedAt: now,
        updateAudit: createUpdateAudit(item, false)
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
      if (await this.adapter.exists(this.legacyMemoryPath)) {
        await this.adapter.remove(this.legacyMemoryPath);
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
      const raw = await this.readMemoryFile();
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
    await ensureLocalDataPath(this.plugin, this.adapter, this.baseDir);
  }

  async readMemoryFile() {
    if (await this.adapter.exists(this.memoryPath)) {
      return this.adapter.read(this.memoryPath);
    }
    return this.adapter.read(this.legacyMemoryPath);
  }
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

function scoreMemory(item, queryTokens, queryTokenSources = new Map()) {
  const itemTokens = tokenize(item.text);
  let matchScore = 0;
  let promptMatchScore = 0;
  let activeFilePathMatchScore = 0;
  let workingDirectoryMatchScore = 0;
  const matchedTokens = [];
  const matchedTokenSources = [];
  for (const token of itemTokens) {
    if (queryTokens.has(token)) {
      const tokenScore = token.length > 8 ? 3 : 1;
      const sources = Array.from(queryTokenSources.get(token) || []);
      matchScore += tokenScore;
      if (sources.some((source) => source === "prompt" || source === "promptExpansion")) {
        promptMatchScore += tokenScore;
      }
      if (sources.some((source) => source === "activeFilePath" || source === "activeFilePathExpansion")) {
        activeFilePathMatchScore += tokenScore;
      }
      if (sources.some((source) => source === "workingDirectory" || source === "workingDirectoryExpansion")) {
        workingDirectoryMatchScore += tokenScore;
      }
      matchedTokens.push(token);
      matchedTokenSources.push({
        token,
        sources
      });
    }
  }
  const priorityScore = kindPriority(item.kind);
  const ageDays = Math.max(0, (Date.now() - normalizeTimestamp(item.updatedAt, Date.now())) / 86400000);
  const recencyScore = Math.max(0, 2 - ageDays / 30);
  const totalScore = matchScore + priorityScore + recencyScore;
  const automaticScore = promptMatchScore
    + activeFilePathMatchScore
    + workingDirectoryMatchScore * WORKING_DIRECTORY_SCORE_WEIGHT
    + priorityScore
    + recencyScore;
  return {
    item,
    matchScore,
    totalScore,
    automaticScore,
    promptMatchScore,
    activeFilePathMatchScore,
    workingDirectoryMatchScore,
    matchedTokens,
    matchedTokenSources
  };
}

function createReferenceAudit(entry) {
  const matchedTokens = Array.isArray(entry.matchedTokens)
    ? entry.matchedTokens.slice(0, 8)
    : [];
  const matchedTokenSources = Array.isArray(entry.matchedTokenSources)
    ? entry.matchedTokenSources.slice(0, 8)
    : [];
  return {
    reasonCode: entry.matchScore > 0 ? "matched_terms" : "global_memory",
    matchScore: entry.matchScore,
    score: entry.automaticScore ?? entry.totalScore,
    matchedTokens,
    matchedTokenSources
  };
}

function createUpdateAudit(item, existing) {
  return {
    reasonCode: existing
      ? "existing_memory_refreshed"
      : item.source === "ai" ? "ai_signal_capture" : "local_rule_capture",
    kind: item.kind,
    scope: item.scope || "project",
    confidence: Number(item.confidence) || 0.6,
    source: item.source || "auto"
  };
}

function compareScoredMemories(left, right) {
  if (right.totalScore !== left.totalScore) {
    return right.totalScore - left.totalScore;
  }
  return normalizeTimestamp(right.item.updatedAt, 0) - normalizeTimestamp(left.item.updatedAt, 0);
}

function compareAutomaticallyRelevantMemories(left, right) {
  if (right.automaticScore !== left.automaticScore) {
    return right.automaticScore - left.automaticScore;
  }
  return compareScoredMemories(left, right);
}

function isGlobalMemory(item) {
  return (item.kind === "preference" && item.scope === "user")
    || item.kind === "identity";
}

function isAutomaticallyRelevant(entry) {
  if (isGlobalMemory(entry.item)) {
    return true;
  }
  return entry.promptMatchScore >= MIN_AUTOMATIC_PROMPT_MATCH_SCORE
    || entry.activeFilePathMatchScore > 0;
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
  return tokenizeRaw(expandSearchText(String(text || "")));
}

function buildQueryTokenInfo(parts) {
  const tokens = new Set();
  const sources = new Map();
  for (const part of parts) {
    const source = part?.source || "prompt";
    const text = part?.text || "";
    if (!text) {
      continue;
    }
    const rawTokens = tokenizeRaw(text);
    const expandedTokens = tokenizeRaw(expandSearchText(text));
    for (const token of expandedTokens) {
      tokens.add(token);
      const labels = sources.get(token) || new Set();
      labels.add(rawTokens.has(token) ? source : `${source}Expansion`);
      sources.set(token, labels);
    }
  }
  return { tokens, sources };
}

function tokenizeRaw(text) {
  const tokens = new Set();
  const normalized = String(text || "").toLowerCase();
  const matches = normalized.match(/[a-z0-9_./-]{3,}|[\u4e00-\u9fff]{2,}/g) || [];
  for (const match of matches) {
    if (!STOP_WORDS.has(match)) {
      tokens.add(match);
      addCjkNgrams(tokens, match);
    }
  }
  return tokens;
}

function addCjkNgrams(tokens, token) {
  if (!/^[\u4e00-\u9fff]{3,}$/.test(token)) {
    return;
  }
  for (const size of [2, 3]) {
    for (let index = 0; index <= token.length - size; index += 1) {
      const gram = token.slice(index, index + size);
      if (!STOP_WORDS.has(gram)) {
        tokens.add(gram);
      }
    }
  }
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
  const updatedDate = formatMemoryDate(item.updatedAt);
  const createdDate = formatMemoryDate(item.createdAt);
  const metadata = [
    updatedDate ? `updated ${updatedDate}` : "",
    createdDate && createdDate !== updatedDate ? `created ${createdDate}` : ""
  ].filter(Boolean).join(", ");
  const suffix = metadata ? ` (${metadata})` : "";
  const provenance = formatMemoryProvenance(item);
  return `- [${provenance}] ${label}${suffix}: ${item.text}`;
}

function formatMemoryProvenance(item) {
  if (item?.scope === "user" || item?.source === "user") {
    return "origin=user_message; speaker=user; local summary, not quote";
  }
  if (item?.source === "ai") {
    return "origin=assistant_reflection; speaker=assistant; accepted summary, not user statement";
  }
  return "origin=local_rules; speaker=none; synthesis, not quote";
}

function formatMemoryDate(value) {
  const timestamp = normalizeTimestamp(value, 0);
  if (!timestamp) {
    return "";
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

function isPromptSafeMemory(item) {
  return item && item.text && !containsSensitiveText(item.text);
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

function normalizeTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

module.exports = {
  MemoryStore,
  formatMemoryLine,
  _test: {
    createEmptyMemory,
    compareAutomaticallyRelevantMemories,
    isAutomaticallyRelevant,
    isPromptSafeMemory,
    isGlobalMemory,
    scoreMemory,
    tokenize
  }
};
