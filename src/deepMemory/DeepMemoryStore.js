const { normalizePath } = require("obsidian");

const { extractDeepMemoryCandidates } = require("./DeepMemoryExtractor");
const { getPersonaProfile } = require("../persona/PersonaProfile");
const { expandSearchText } = require("../storage/searchQuery");
const { containsSensitiveText } = require("../storage/sensitiveText");
const { ensureLocalDataPath, getLegacyPluginPath, getLocalDataPath } = require("../storage/localDataPath");

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
  "真的"
]);

class DeepMemoryStore {
  constructor(plugin, options = {}) {
    this.plugin = plugin;
    this.adapter = plugin.app.vault.adapter;
    this.baseDir = getLocalDataPath(plugin, DEEP_MEMORY_DIR_NAME);
    this.memoryPath = normalizePath(`${this.baseDir}/${DEEP_MEMORY_FILE_NAME}`);
    this.legacyMemoryPath = getLegacyPluginPath(plugin, DEEP_MEMORY_DIR_NAME, DEEP_MEMORY_FILE_NAME);
    this.cache = null;
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
    const contextText = [
      query,
      options.conversationText || "",
      options.activeFilePath || "",
      options.workingDirectory || ""
    ].filter(Boolean).join(" ");
    const queryTokens = tokenize(contextText);
    const explicitRecall = isExplicitDeepMemoryRecall(contextText);
    const cooldownMs = getRecallCooldownDays(settings) * 86400000;
    const scored = active
      .map((item) => scoreDeepMemory(item, queryTokens, explicitRecall, now))
      .filter((entry) => entry.score > 0)
      .filter((entry) => explicitRecall || !isCoolingDown(entry.item, now, cooldownMs))
      .sort(compareScoredDeepMemories);

    const maxItems = Math.max(1, Math.min(Number(settings.deepMemoryMaxPromptItems) || DEFAULT_MAX_PROMPT_ITEMS, scored.length));
    const selected = scored.slice(0, maxItems).map((entry) => entry.item);
    if (selected.length > 0) {
      await this.markRecalled(selected, now);
    }
    return selected;
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
      this.cache = createEmptyDeepMemory();
      try {
        if (await this.adapter.exists(this.memoryPath)) {
          await this.adapter.remove(this.memoryPath);
        }
        if (await this.adapter.exists(this.legacyMemoryPath)) {
          await this.adapter.remove(this.legacyMemoryPath);
        }
      } catch (error) {
        console.warn("Agent Dock could not clear deep memory:", error);
      }
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
    } catch {
      this.cache = createEmptyDeepMemory();
      return this.cache;
    }
  }

  async saveMemory(memory) {
    await this.ensureDeepMemoryDir();
    this.cache = normalizeDeepMemory(memory);
    await this.adapter.write(this.memoryPath, `${JSON.stringify(this.cache, null, 2)}\n`);
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

function scoreDeepMemory(item, queryTokens, explicitRecall, now) {
  const itemTokens = tokenize(formatSearchText(item));
  let matchScore = 0;
  for (const token of itemTokens) {
    if (queryTokens.has(token)) {
      matchScore += token.length > 6 ? 2 : 1;
    }
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
    score: matchScore > 0 || explicitRecall ? score : 0
  };
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
  return /(记得|记住|回忆|之前|过去|那次|重要时刻|深刻记忆|remember|memory|memories|previous|important moment)/i.test(text || "");
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
    tokenize
  }
};
