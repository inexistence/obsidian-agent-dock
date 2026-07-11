const { RuleBasedMemoryExtractor } = require("./memoryExtraction/RuleBasedMemoryExtractor");
const { expandSearchText } = require("./searchQuery");
const { containsSensitiveText } = require("./sensitiveText");
const {
  createLegacySummaryEvidence,
  mergeMemoryEvidence,
  normalizeMemoryEvidence
} = require("./memoryEvidence");
const {
  evaluateMemoryReliability,
  inferTemporalClass,
  normalizeTemporal
} = require("./MemoryReliability");
const { planCollaborationOmissions } = require("./MemoryOmissionPlanner");
const { MemoryRepository } = require("./MemoryRepository");
const {
  applyMemoryRelationship: reduceMemoryRelationship,
  mergeEvent: mergeMemoryEvent,
  mergeTemporal,
  normalizeMemoryEvent: normalizeMemoryEventValue
} = require("./MemoryRelationshipReducer");

const MEMORY_VERSION = 2;
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
    this.extractor = options.extractor || new RuleBasedMemoryExtractor();
    this.repository = options.repository || new MemoryRepository(plugin);
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
      .map((item) => scoreMemory(item, queryTokenInfo.tokens, queryTokenInfo.sources, options))
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
        reliability: entry.reliability,
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
      .map((item) => scoreMemory(item, queryTokenInfo.tokens, queryTokenInfo.sources, options))
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
        reliability: entry.reliability,
        referenceAudit: createReferenceAudit(entry)
      }));
      used += text.length + 1;
    }

    return selected;
  }

  async getMemoriesByIds(ids, options = {}) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).filter(Boolean));
    if (wanted.size === 0) {
      return [];
    }
    const memory = await this.loadMemory();
    return memory.items
      .filter((item) => wanted.has(item.id))
      .filter((item) => item.text && !containsSensitiveText(item.text))
      .map((item) => Object.assign({}, item, {
        reliability: evaluateMemoryReliability(item, options)
      }));
  }

  async getCollaborationOmissions(settings, options = {}) {
    if (!settings.memoryEnabled || settings.memoryProactiveOmissionsEnabled === false) {
      return [];
    }
    const memory = await this.loadMemory();
    const evidenceFileContents = await this.readEvidenceFileContents(memory.items);
    return planCollaborationOmissions(memory.items, settings, Object.assign({}, options, {
      evidenceFileContents
    }));
  }

  async readEvidenceFileContents(items) {
    const vault = this.plugin?.app?.vault;
    if (typeof vault?.getAbstractFileByPath !== "function" || typeof vault?.cachedRead !== "function") {
      return {};
    }
    const paths = [...new Set((Array.isArray(items) ? items : [])
      .filter((item) => item?.scope === "project" && ["active", "contested"].includes(item.status || "active"))
      .flatMap((item) => (item.evidenceRefs || [])
        .filter((evidence) => evidence.origin === "active_note")
        .map((evidence) => evidence.filePath))
      .filter(Boolean))].slice(0, 6);
    const entries = await Promise.all(paths.map(async (path) => {
      const file = vault.getAbstractFileByPath(path);
      if (!file || file.children) {
        return null;
      }
      try {
        return [path, await vault.cachedRead(file)];
      } catch {
        // A missing or temporarily unreadable file is not evidence of contradiction.
        return null;
      }
    }));
    return Object.fromEntries(entries.filter(Boolean));
  }

  async markOmissionsNotified(omissions, now = Date.now()) {
    const ids = new Set((Array.isArray(omissions) ? omissions : [])
      .map((omission) => omission?.item?.id)
      .filter(Boolean));
    if (ids.size === 0) {
      return;
    }
    return this.enqueueWrite(async () => {
      const memory = await this.loadMemoryForWrite();
      let changed = false;
      for (const item of memory.items) {
        if (!ids.has(item.id)) {
          continue;
        }
        item.lastOmissionNoticedAt = now;
        changed = true;
      }
      if (changed) {
        memory.updatedAt = now;
        await this.saveMemory(memory);
      }
    });
  }

  async captureTurn(turn, settings) {
    if (!settings.memoryEnabled || !settings.memoryAutoCapture) {
      return [];
    }

    return this.enqueueWrite(() => this.captureTurnUnlocked(turn, settings));
  }

  async captureTurnUnlocked(turn, settings) {
    const memory = await this.loadMemoryForWrite();
    const extracted = this.extractor.extractTurn(turn)
      .filter((item) => item.text && !containsSensitiveText(item.text))
      .filter((item) => item.persistence !== "current_turn")
      .slice(0, MAX_EXTRACTED_ITEMS_PER_TURN);

    if (extracted.length === 0) {
      return [];
    }

    const now = Date.now();
    const existingByKey = new Map(memory.items
      .filter((item) => item.status === "active" || item.status === "contested")
      .map((item) => [item.key, item]));
    const saved = [];

    for (const item of extracted) {
      const key = item.key || createMemoryKey(item.kind, item.text);
      const previous = existingByKey.get(key);
      if (previous) {
        previous.text = item.text;
        previous.kind = item.kind;
        previous.scope = item.scope || previous.scope || "project";
        previous.captureConfidence = Math.max(
          Number(previous.captureConfidence ?? previous.confidence) || 0,
          Number(item.confidence) || 0.6
        );
        previous.confidence = previous.captureConfidence;
        previous.evidenceRefs = mergeMemoryEvidence(previous.evidenceRefs, item.evidenceRefs, {
          sourceSessionId: item.sourceSessionId || previous.sourceSessionId || "",
          filePath: turn?.activeFilePath || "",
          observedAt: now
        });
        previous.temporal = mergeTemporal(previous.temporal, item.temporal, item.kind);
        previous.event = mergeEvent(previous.event, item.event, previous.id);
        previous.persistence = item.persistence || previous.persistence || inferTemporalClass(item.kind);
        previous.status = (previous.conflictIds || []).length > 0 ? "contested" : "active";
        previous.updatedAt = now;
        previous.sourceSessionId = item.sourceSessionId || previous.sourceSessionId || "";
        previous.source = item.source || previous.source || "auto";
        previous.updateAudit = createUpdateAudit(item, true);
        saved.push(previous);
        continue;
      }

      const nextId = createMemoryId();
      const next = {
        id: nextId,
        key,
        kind: item.kind,
        scope: item.scope || "project",
        text: item.text,
        captureConfidence: Number(item.confidence) || 0.6,
        confidence: Number(item.confidence) || 0.6,
        source: item.source || "auto",
        sourceSessionId: item.sourceSessionId || "",
        evidenceRefs: normalizeMemoryEvidence(item.evidenceRefs, {
          sourceSessionId: item.sourceSessionId || turn?.sessionId || "",
          filePath: turn?.activeFilePath || "",
          observedAt: now
        }),
        persistence: item.persistence || inferTemporalClass(item.kind),
        temporal: normalizeTemporal(item.temporal, item.kind),
        event: normalizeMemoryEvent(item.event, item.kind, nextId),
        status: "active",
        supersedes: [],
        conflictIds: [],
        createdAt: now,
        updatedAt: now,
        updateAudit: createUpdateAudit(item, false)
      };
      applyMemoryRelationship(next, memory.items, now);
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
    return this.enqueueWrite(() => this.repository.clear(createEmptyMemory));
  }

  async loadMemory() {
    return this.repository.load(normalizeMemory, createEmptyMemory);
  }

  async saveMemory(memory) {
    return this.repository.save(memory, normalizeMemory);
  }

  async loadMemoryForWrite() {
    return cloneMemory(await this.loadMemory());
  }

  enqueueWrite(operation) {
    return this.repository.enqueueWrite(operation);
  }
}

function limitMemoryItems(items, settings) {
  const maxItems = Number(settings.memoryMaxItems) || 200;
  return [...items]
    .sort((left, right) => {
      const statusDelta = memoryStatusPriority(right.status) - memoryStatusPriority(left.status);
      if (statusDelta !== 0) {
        return statusDelta;
      }
      const kindDelta = kindPriority(right.kind) - kindPriority(left.kind);
      if (kindDelta !== 0) {
        return kindDelta;
      }
      return normalizeTimestamp(right.updatedAt, 0) - normalizeTimestamp(left.updatedAt, 0);
    })
    .slice(0, maxItems)
    .sort((left, right) => normalizeTimestamp(left.createdAt, 0) - normalizeTimestamp(right.createdAt, 0));
}

function memoryStatusPriority(status) {
  if (status === "active") {
    return 4;
  }
  if (status === "contested") {
    return 3;
  }
  if (status === "expired") {
    return 2;
  }
  return 1;
}

function applyMemoryRelationship(next, existingItems, now) {
  return reduceMemoryRelationship(next, existingItems, now, tokenize);
}

function mergeEvent(existing, incoming, seed) {
  return mergeMemoryEvent(existing, incoming, seed, normalizeMemoryEvent);
}

function scoreMemory(item, queryTokens, queryTokenSources = new Map(), options = {}) {
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
  const reliability = evaluateMemoryReliability(item, options);
  const ageDays = Math.max(0, (Date.now() - normalizeTimestamp(item.updatedAt, Date.now())) / 86400000);
  const recencyScore = Math.max(0, 2 - ageDays / 30);
  const reliabilityScore = reliability.level === "high"
    ? 1.2
    : reliability.level === "medium" ? 0.5 : reliability.level === "contested" ? -0.2 : -1;
  const totalScore = matchScore + priorityScore + recencyScore + reliabilityScore;
  const automaticScore = promptMatchScore
    + activeFilePathMatchScore
    + workingDirectoryMatchScore * WORKING_DIRECTORY_SCORE_WEIGHT
    + priorityScore
    + recencyScore
    + reliabilityScore;
  return {
    item,
    matchScore,
    totalScore,
    automaticScore,
    promptMatchScore,
    activeFilePathMatchScore,
    workingDirectoryMatchScore,
    matchedTokens,
    matchedTokenSources,
    reliability
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
  if (item?.source === "ai") {
    return "origin=assistant_reflection; speaker=assistant; accepted summary, not user statement";
  }
  const evidence = Array.isArray(item?.evidenceRefs) ? item.evidenceRefs : [];
  const primary = evidence.find((entry) => entry.origin === "user_message") || evidence[0];
  if (primary) {
    return `origin=${primary.origin}; speaker=${primary.speaker}; local summary, not quote`;
  }
  if (item?.scope === "user" || item?.source === "user") {
    return "origin=user_message; speaker=user; legacy local summary, not quote";
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
  return item
    && item.text
    && !["corrected", "superseded"].includes(item.status)
    && !containsSensitiveText(item.text)
    && !(item.evidenceRefs || []).some((entry) => containsSensitiveText(entry.quote));
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

  const id = typeof item.id === "string" && item.id ? item.id : createMemoryId();
  return {
    id,
    key: typeof item.key === "string" && item.key ? item.key : createMemoryKey(kind, text),
    kind,
    scope: normalizeScope(item.scope),
    text,
    captureConfidence: Number.isFinite(Number(item.captureConfidence ?? item.confidence))
      ? Number(item.captureConfidence ?? item.confidence)
      : 0.6,
    confidence: Number.isFinite(Number(item.captureConfidence ?? item.confidence))
      ? Number(item.captureConfidence ?? item.confidence)
      : 0.6,
    source: typeof item.source === "string" && item.source ? item.source : "auto",
    sourceSessionId: typeof item.sourceSessionId === "string" ? item.sourceSessionId : "",
    evidenceRefs: normalizePersistedEvidence(item),
    persistence: normalizePersistence(item.persistence, kind),
    temporal: normalizeTemporal(item.temporal, kind),
    event: normalizeMemoryEvent(item.event, kind, id),
    status: normalizeMemoryStatus(item.status),
    supersedes: normalizeStringArray(item.supersedes),
    conflictIds: normalizeStringArray(item.conflictIds),
    lastOmissionNoticedAt: normalizeTimestamp(item.lastOmissionNoticedAt, 0),
    createdAt: normalizeTimestamp(item.createdAt, Date.now()),
    updatedAt: normalizeTimestamp(item.updatedAt, Date.now())
  };
}

function normalizeMemoryEvent(value, kind, seed = "") {
  return normalizeMemoryEventValue(value, kind, seed, {
    compactText,
    createEventId,
    normalizeTimestamp
  });
}

function createEventId(seed) {
  const value = compactText(seed).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").slice(0, 48);
  return `event-${value || Date.now().toString(36)}`;
}

function normalizePersistedEvidence(item) {
  const evidence = normalizeMemoryEvidence(item.evidenceRefs, {
    sourceSessionId: item.sourceSessionId || "",
    observedAt: item.updatedAt || item.createdAt || Date.now()
  });
  return evidence.length > 0 ? evidence : createLegacySummaryEvidence(item);
}

function normalizePersistence(value, kind) {
  return ["durable", "project", "state", "current_turn"].includes(value)
    ? value
    : inferTemporalClass(kind);
}

function normalizeMemoryStatus(value) {
  return ["active", "contested", "superseded", "expired", "corrected"].includes(value)
    ? value
    : "active";
}

function normalizeStringArray(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(compactText).filter(Boolean))].slice(0, 12);
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

function cloneMemory(memory) {
  return JSON.parse(JSON.stringify(memory));
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
