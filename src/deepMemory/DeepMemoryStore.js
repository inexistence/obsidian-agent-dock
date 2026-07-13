const { normalizePath } = require("obsidian");

const { extractDeepMemoryCandidates } = require("./DeepMemoryExtractor");
const { getPersonaProfile } = require("../persona/PersonaProfile");
const { expandSearchText } = require("../storage/searchQuery");
const { containsSensitiveText } = require("../storage/sensitiveText");
const { ensureLocalDataPath, getLegacyPluginPath, getLocalDataPath } = require("../storage/localDataPath");
const { writeJsonAtomically } = require("../storage/atomicJson");

const DEEP_MEMORY_VERSION = 1;
const DEEP_MEMORY_DIR_NAME = "deep-memory";
const DEEP_MEMORY_FILE_NAME = "deep-memory.json";
const DEFAULT_MAX_ITEMS = 80;
const DEFAULT_MAX_PROMPT_ITEMS = 2;
const DEFAULT_IMPORTANCE_THRESHOLD = 0.68;
const DEFAULT_RECALL_COOLDOWN_DAYS = 3;
const STOP_WORDS = new Set([
  "about",
  "agent",
  "assistant",
  "because",
  "important",
  "memory",
  "really",
  "remember",
  "that",
  "this",
  "with",
  "一个",
  "这个",
  "那个",
  "希望",
  "可以",
  "重要",
  "记忆",
  "记得",
  "真的",
  "我们",
  "你们",
  "他们",
  "用户",
  "继续",
  "问题",
  "功能",
  "内容",
  "相关",
  "进行",
  "已经",
  "一下"
]);

class DeepMemoryStore {
  constructor(plugin, options = {}) {
    this.plugin = plugin;
    this.adapter = plugin.app.vault.adapter;
    this.baseDir = getLocalDataPath(plugin, DEEP_MEMORY_DIR_NAME);
    this.memoryPath = normalizePath(`${this.baseDir}/${DEEP_MEMORY_FILE_NAME}`);
    this.legacyMemoryPath = getLegacyPluginPath(plugin, DEEP_MEMORY_DIR_NAME, DEEP_MEMORY_FILE_NAME);
    this.cache = null;
    this.storageError = null;
    this.extractor = options.extractor || { extractTurn: extractDeepMemoryCandidates };
    this.writeQueue = Promise.resolve();
  }

  async getPromptMemories(query, settings, options = {}) {
    if (!settings.deepMemoryEnabled) {
      return [];
    }

    const memory = await this.loadMemory();
    const active = memory.items.filter(isPromptSafeDeepMemory);
    if (active.length === 0) {
      return [];
    }

    const now = Number(options.now) || Date.now();
    const supportingContextText = [
      options.conversationText || "",
      options.activeFilePath || "",
      options.workingDirectory || ""
    ].filter(Boolean).join(" ");
    const explicitRecall = isExplicitDeepMemoryRecall(query);
    const recallTopicText = explicitRecall ? stripRecallLanguage(query) : query;
    const queryTokens = tokenize(recallTopicText);
    const supportingTokens = tokenize(supportingContextText);
    const specificRecall = explicitRecall && queryTokens.size > 0;
    const cooldownMs = getRecallCooldownDays(settings) * 86400000;
    const scored = active
      .map((item) => scoreDeepMemory(item, queryTokens, explicitRecall, now, {
        specificRecall,
        supportingTokens
      }))
      .filter((entry) => entry.score > 0)
      .filter((entry) => explicitRecall || !isCoolingDown(entry.item, now, cooldownMs))
      .sort(compareScoredDeepMemories);

    const maxItems = Math.max(1, Math.min(Number(settings.deepMemoryMaxPromptItems) || DEFAULT_MAX_PROMPT_ITEMS, scored.length));
    return scored.slice(0, maxItems).map((entry) => entry.item);
  }

  async captureTurn(turn, settings) {
    if (!settings.deepMemoryEnabled || !settings.deepMemoryAutoCapture) {
      return [];
    }

    return this.enqueueWrite(async () => {
      const now = Date.now();
      const threshold = getImportanceThreshold(settings);
      const personaProfile = getPersonaProfile(settings);
      const memory = await this.loadMemory();
      const extracted = this.extractor.extractTurn(Object.assign({}, turn, { now }), { threshold, now, personaProfile })
        .filter((item) => isPromptSafeDeepMemory(item) && item.importance >= threshold);
      if (extracted.length === 0) {
        return [];
      }

      const existingByKey = new Map(memory.items.map((item) => [item.key, item]));
      const saved = [];
      for (const item of extracted) {
        if (containsSensitiveText(formatSearchText(item))) {
          continue;
        }

        const previous = existingByKey.get(item.key);
        if (previous) {
          previous.summary = item.summary || previous.summary;
          previous.whyItMatters = item.whyItMatters || previous.whyItMatters;
          previous.feltSense = item.feltSense || previous.feltSense;
          previous.userExcerpt = item.userExcerpt || previous.userExcerpt;
          previous.assistantExcerpt = item.assistantExcerpt || previous.assistantExcerpt;
          previous.salienceAxes = mergeStrings(previous.salienceAxes, item.salienceAxes);
          previous.topics = mergeStrings(previous.topics, item.topics);
          previous.importance = Math.max(Number(previous.importance) || 0, Number(item.importance) || 0);
          previous.confidence = Math.max(Number(previous.confidence) || 0, Number(item.confidence) || 0);
          previous.updatedAt = now;
          previous.status = "active";
          saved.push(previous);
          continue;
        }

        const next = normalizeDeepMemoryItem(Object.assign({}, item, {
          id: createDeepMemoryId(),
          recallCount: 0,
          lastRecalledAt: 0,
          createdAt: now,
          updatedAt: now
        }));
        memory.items.push(next);
        existingByKey.set(next.key, next);
        saved.push(next);
      }

      if (saved.length === 0) {
        return [];
      }

      memory.items = limitDeepMemoryItems(memory.items, settings);
      memory.updatedAt = now;
      await this.saveMemory(memory);
      return saved;
    });
  }

  async clearMemory() {
    return this.enqueueWrite(async () => {
      try {
        if (await this.adapter.exists(this.memoryPath)) {
          await this.adapter.remove(this.memoryPath);
        }
        if (await this.adapter.exists(this.legacyMemoryPath)) {
          await this.adapter.remove(this.legacyMemoryPath);
        }
      } catch (error) {
        this.cache = null;
        throw error;
      }
      this.storageError = null;
      this.cache = createEmptyDeepMemory();
    });
  }

  async loadMemory() {
    if (this.cache) {
      return this.cache;
    }
    try {
      const raw = await this.readMemoryFile();
      this.cache = normalizeDeepMemory(JSON.parse(raw));
      return this.cache;
    } catch (error) {
      if (await this.hasStoredMemoryFile()) {
        this.storageError = error;
        console.warn("Agent Dock could not read deep memory; writes are disabled to preserve the existing file:", error);
      }
      this.cache = createEmptyDeepMemory();
      return this.cache;
    }
  }

  async saveMemory(memory) {
    if (this.storageError) {
      throw new Error("Deep memory storage is write-protected because the existing file could not be read.", {
        cause: this.storageError
      });
    }
    await this.ensureDeepMemoryDir();
    this.cache = normalizeDeepMemory(memory);
    await writeJsonAtomically(this.adapter, this.memoryPath, this.cache);
  }

  async ensureDeepMemoryDir() {
    await ensureLocalDataPath(this.plugin, this.adapter, this.baseDir);
  }

  async readMemoryFile() {
    if (await this.adapter.exists(this.memoryPath)) {
      return this.adapter.read(this.memoryPath);
    }
    return this.adapter.read(this.legacyMemoryPath);
  }

  async hasStoredMemoryFile() {
    return await this.adapter.exists(this.memoryPath)
      || await this.adapter.exists(this.legacyMemoryPath);
  }

  async markRecalled(items, now) {
    return this.enqueueWrite(async () => {
      const memory = await this.loadMemory();
      const ids = new Set(items.map((item) => item.id).filter(Boolean));
      let changed = false;
      for (const item of memory.items) {
        if (!ids.has(item.id)) {
          continue;
        }
        item.recallCount = (Number(item.recallCount) || 0) + 1;
        item.lastRecalledAt = now;
        changed = true;
      }
      if (changed) {
        memory.updatedAt = now;
        await this.saveMemory(memory);
      }
    });
  }

  enqueueWrite(operation) {
    const run = this.writeQueue.then(operation, operation);
    this.writeQueue = run.catch(() => {});
    return run;
  }
}

function createEmptyDeepMemory() {
  return {
    version: DEEP_MEMORY_VERSION,
    items: [],
    updatedAt: Date.now()
  };
}

function normalizeDeepMemory(memory) {
  const raw = memory && typeof memory === "object" ? memory : {};
  return {
    version: DEEP_MEMORY_VERSION,
    items: Array.isArray(raw.items) ? raw.items.map(normalizeDeepMemoryItem).filter(Boolean) : [],
    updatedAt: normalizeTimestamp(raw.updatedAt, Date.now())
  };
}

function normalizeDeepMemoryItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const summary = compactText(item.summary);
  if (!summary) {
    return null;
  }
  return {
    id: compactText(item.id) || createDeepMemoryId(),
    key: compactText(item.key) || createMemoryKey(item.kind, summary, item.userExcerpt),
    kind: normalizeKind(item.kind),
    summary,
    whyItMatters: compactText(item.whyItMatters),
    feltSense: compactText(item.feltSense),
    userExcerpt: compactText(item.userExcerpt),
    assistantExcerpt: compactText(item.assistantExcerpt),
    salienceAxes: normalizeStringArray(item.salienceAxes),
    topics: normalizeStringArray(item.topics),
    emotionalValence: compactText(item.emotionalValence) || "warm",
    importance: clampUnit(item.importance, 0.7),
    confidence: clampUnit(item.confidence, 0.65),
    recallCount: Math.max(0, Number.parseInt(item.recallCount, 10) || 0),
    lastRecalledAt: normalizeTimestamp(item.lastRecalledAt, 0),
    sourceSessionId: compactText(item.sourceSessionId),
    activeFilePath: compactText(item.activeFilePath),
    status: ["active", "corrected", "archived"].includes(item.status) ? item.status : "active",
    createdAt: normalizeTimestamp(item.createdAt, Date.now()),
    updatedAt: normalizeTimestamp(item.updatedAt, Date.now())
  };
}

function limitDeepMemoryItems(items, settings) {
  const maxItems = Number(settings.deepMemoryMaxItems) || DEFAULT_MAX_ITEMS;
  return [...items]
    .sort((left, right) => {
      const scoreDelta = retentionScore(right) - retentionScore(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return normalizeTimestamp(right.updatedAt, 0) - normalizeTimestamp(left.updatedAt, 0);
    })
    .slice(0, maxItems)
    .sort((left, right) => normalizeTimestamp(left.createdAt, 0) - normalizeTimestamp(right.createdAt, 0));
}

function scoreDeepMemory(item, queryTokens, explicitRecall, now, options = {}) {
  const itemTokens = tokenize(formatSearchText(item));
  const primaryMatch = tokenMatchScore(queryTokens, itemTokens);
  const supportingMatch = tokenMatchScore(options.supportingTokens, itemTokens);
  const matchScore = Math.min(4, primaryMatch) + Math.min(1, supportingMatch * 0.3);
  if (options.specificRecall && primaryMatch === 0) {
    return { item, matchScore: 0, score: 0 };
  }
  const importance = Number(item.importance) || 0;
  const confidence = Number(item.confidence) || 0;
  const ageDays = Math.max(0, (now - normalizeTimestamp(item.updatedAt, now)) / 86400000);
  const recency = Math.max(0, 0.8 - ageDays / 60);
  const recallPenalty = Math.min(0.5, (Number(item.recallCount) || 0) * 0.08);
  const relationshipBoost = item.kind === "relationship_insight" ? 0.3 : 0;
  const explicitBoost = explicitRecall ? 1.2 : 0;
  const score = matchScore + importance * 1.6 + confidence + recency + relationshipBoost + explicitBoost - recallPenalty;
  return {
    item,
    matchScore,
    score: matchScore > 0 || (explicitRecall && !options.specificRecall) ? score : 0
  };
}

function tokenMatchScore(queryTokens, itemTokens) {
  if (!(queryTokens instanceof Set) || queryTokens.size === 0 || !(itemTokens instanceof Set)) {
    return 0;
  }
  let score = 0;
  for (const token of queryTokens) {
    if (itemTokens.has(token)) {
      score += getTokenMatchWeight(token);
    }
  }
  return score;
}

function getTokenMatchWeight(token) {
  if (/^[\u4e00-\u9fff]+$/.test(token)) {
    if (token.length === 2) {
      return 0.4;
    }
    if (token.length === 3) {
      return 0.75;
    }
    return 1.4;
  }
  if (token.length <= 3) {
    return 0.45;
  }
  if (token.length <= 6) {
    return 0.85;
  }
  return 1.25;
}

function compareScoredDeepMemories(left, right) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  return normalizeTimestamp(right.item.updatedAt, 0) - normalizeTimestamp(left.item.updatedAt, 0);
}

function isPromptSafeDeepMemory(item) {
  return item
    && item.status !== "archived"
    && item.status !== "corrected"
    && item.summary
    && !containsSensitiveText(formatSearchText(item));
}

function isExplicitDeepMemoryRecall(text) {
  const source = compactText(text);
  return /你还?记得|还记得|记不记得|有没有印象|有印象(?:吗|么|嘛|\?|？|$)|是否记得|能否回忆|回忆一下|想起来|记得.{0,24}(?:之前|以前|过去|上次|那次)|(?:查|找|搜索|看看|读取).{0,12}(?:深刻记忆|重要时刻|记忆|记录)|(?:之前|以前|过去|上次|那次).{0,24}(?:说过|提过|聊过|决定|约定|发生|完成)/.test(source)
    || /(?:do you|can you|could you|what do you)\s+(?:still\s+)?(?:remember(?!\s+to\b)|recall)|(?:search|find|look up|check).{0,24}(?:memories?|past notes?|history)|(?:remember|recall).{0,32}(?:before|previously|last time|that time)/i.test(source);
}

function stripRecallLanguage(text) {
  return compactText(text)
    .replace(/你还?记得|还记得|记不记得|有没有印象|有印象|是否记得|能否回忆|记得|记住|回忆(?:一下)?|想起来|(?:查|找|搜索|看看|读取|翻看)(?:一下)?|深刻记忆|重要时刻|记忆|记录|之前(?:说的|提过的)?|以前|过去|上次|那次|我(?:曾经|之前)?说的|那个|一些|关于|事情|内容|感觉|有没有|里|吗|呢|一下/gi, " ")
    .replace(/\b(?:do you|can you|could you|what do you|please|still|remember|recall|search|find|look up|check|memories?|previous(?:ly)?|past|history|important moments?|the|that|thing|things|about|what|i|we|said|mentioned|last time)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCoolingDown(item, now, cooldownMs) {
  const lastRecalledAt = normalizeTimestamp(item.lastRecalledAt, 0);
  return lastRecalledAt > 0 && now - lastRecalledAt < cooldownMs;
}

function formatSearchText(item) {
  return [
    item.summary,
    item.whyItMatters,
    item.feltSense,
    item.userExcerpt,
    item.assistantExcerpt,
    Array.isArray(item.salienceAxes) ? item.salienceAxes.join(" ") : "",
    Array.isArray(item.topics) ? item.topics.join(" ") : ""
  ].filter(Boolean).join(" ");
}

function retentionScore(item) {
  return (Number(item.importance) || 0) * 2
    + (Number(item.confidence) || 0)
    + Math.min(0.6, (Number(item.recallCount) || 0) * 0.06)
    + normalizeTimestamp(item.updatedAt, 0) / 10000000000000;
}

function tokenize(text) {
  const normalized = expandSearchText(compactText(text)).toLowerCase();
  const tokens = new Set();
  for (const token of normalized.match(/[\p{L}\p{N}_-]{2,}/gu) || []) {
    if (!STOP_WORDS.has(token)) {
      tokens.add(token);
      addCjkNgrams(tokens, token);
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

function getImportanceThreshold(settings) {
  const number = Number(settings.deepMemoryImportanceThreshold);
  return Number.isFinite(number) && number > 0 ? clampUnit(number, DEFAULT_IMPORTANCE_THRESHOLD) : DEFAULT_IMPORTANCE_THRESHOLD;
}

function getRecallCooldownDays(settings) {
  const number = Number(settings.deepMemoryRecallCooldownDays);
  return Number.isFinite(number) && number >= 0 ? number : DEFAULT_RECALL_COOLDOWN_DAYS;
}

function normalizeKind(kind) {
  return [
    "beauty_moment",
    "hard_won_achievement",
    "meaningful_episode",
    "moral_stance",
    "relationship_insight",
    "turning_point",
    "visible_reflection"
  ].includes(kind)
    ? kind
    : "meaningful_episode";
}

function normalizeStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map(compactText)
    .filter(Boolean)
    .slice(0, 8);
}

function mergeStrings(left, right) {
  return Array.from(new Set(normalizeStringArray(left).concat(normalizeStringArray(right)))).slice(0, 8);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function clampUnit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, number));
}

function createDeepMemoryId() {
  return `deep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createMemoryKey(kind, summary, excerpt) {
  return `${kind || "deep"}:${compactText(summary).slice(0, 80)}:${compactText(excerpt).slice(0, 80)}`;
}

module.exports = {
  DeepMemoryStore,
  createEmptyDeepMemory,
  getImportanceThreshold,
  getRecallCooldownDays,
  normalizeDeepMemory,
  _test: {
    isExplicitDeepMemoryRecall,
    isPromptSafeDeepMemory,
    scoreDeepMemory,
    stripRecallLanguage,
    tokenMatchScore,
    tokenize
  }
};
