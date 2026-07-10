const { normalizePath } = require("obsidian");

const { extractEpisodeDraft, isSensitiveEpisode } = require("./LocalSignalExtractor");
const {
  applyEpisodes,
  getPromptStance,
  normalizeInteractionMemory
} = require("./PatternReducer");
const { ensureLocalDataPath, getLegacyPluginPath, getLocalDataPath } = require("../storage/localDataPath");

const INTERACTION_DIR_NAME = "interaction";
const INTERACTION_FILE_NAME = "interaction-memory.json";
const LEGACY_PROFILE_DIR_NAME = "profile";
const LEGACY_PROFILE_FILE_NAME = "agent-profile.json";
const MAX_PENDING_EPISODES = 40;

class InteractionMemoryStore {
  constructor(plugin) {
    this.plugin = plugin;
    this.adapter = plugin.app.vault.adapter;
    this.baseDir = getLocalDataPath(plugin, INTERACTION_DIR_NAME);
    this.memoryPath = normalizePath(`${this.baseDir}/${INTERACTION_FILE_NAME}`);
    this.legacyMemoryPath = getLegacyPluginPath(plugin, INTERACTION_DIR_NAME, INTERACTION_FILE_NAME);
    this.legacyProfilePath = getLegacyPluginPath(plugin, LEGACY_PROFILE_DIR_NAME, LEGACY_PROFILE_FILE_NAME);
    this.cache = null;
    this.writeQueue = Promise.resolve();
  }

  async getPromptStance(settings, context = {}) {
    if (!settings.interactionMemoryEnabled) {
      return [];
    }
    const memory = await this.loadMemory();
    return getPromptStance(memory, settings, context);
  }

  async captureTurn(turn, settings) {
    if (!settings.interactionMemoryEnabled || !settings.interactionMemoryAutoCapture) {
      return {
        closedEpisodes: [],
        pendingEpisode: null,
        patterns: [],
        tensions: [],
        stableImpressions: []
      };
    }

    return this.enqueueWrite(async () => {
      const now = Number(turn?.now) || Date.now();
      const memory = await this.loadMemory();
      const pendingForSession = findPendingForSession(memory.pendingEpisodes, turn?.sessionId || "");
      const draft = extractEpisodeDraft(Object.assign({}, turn, { now }), pendingForSession);
      const pendingEpisode = createPendingEpisode(draft, now);

      const remainingPending = memory.pendingEpisodes.filter((episode) => episode.id !== pendingForSession?.id);
      const closedEpisodes = [];
      if (pendingForSession) {
        const closed = closePendingEpisode(pendingForSession, draft, now);
        if (!isSensitiveEpisode(closed)) {
          closedEpisodes.push(closed);
        }
      }

      const pendingEpisodes = limitPendingEpisodes(remainingPending.concat(pendingEpisode));
      const next = applyEpisodes(Object.assign({}, memory, {
        pendingEpisodes
      }), closedEpisodes, settings, now);
      next.pendingEpisodes = pendingEpisodes;
      this.cache = next;
      await this.saveMemory(next);

      return {
        closedEpisodes,
        pendingEpisode,
        patterns: next.patterns,
        tensions: next.tensions,
        stableImpressions: next.stableImpressions
      };
    });
  }

  async clearMemory() {
    return this.enqueueWrite(async () => {
      this.cache = createEmptyInteractionMemory();
      try {
        if (await this.adapter.exists(this.memoryPath)) {
          await this.adapter.remove(this.memoryPath);
        }
        if (await this.adapter.exists(this.legacyMemoryPath)) {
          await this.adapter.remove(this.legacyMemoryPath);
        }
        if (await this.adapter.exists(this.legacyProfilePath)) {
          await this.adapter.remove(this.legacyProfilePath);
        }
      } catch (error) {
        console.warn("Agent Dock could not clear interaction memory:", error);
      }
    });
  }

  async loadMemory() {
    if (this.cache) {
      return this.cache;
    }
    try {
      const raw = await this.readMemoryFile();
      this.cache = normalizeInteractionMemory(JSON.parse(raw));
      this.cache.pendingEpisodes = limitPendingEpisodes(this.cache.pendingEpisodes);
      return this.cache;
    } catch {
      this.cache = createEmptyInteractionMemory();
      return this.cache;
    }
  }

  async saveMemory(memory) {
    await this.ensureInteractionDir();
    this.cache = normalizeInteractionMemory(memory);
    this.cache.pendingEpisodes = limitPendingEpisodes(this.cache.pendingEpisodes);
    await this.adapter.write(this.memoryPath, `${JSON.stringify(this.cache, null, 2)}\n`);
  }

  async ensureInteractionDir() {
    await ensureLocalDataPath(this.plugin, this.adapter, this.baseDir);
  }

  async readMemoryFile() {
    if (await this.adapter.exists(this.memoryPath)) {
      return this.adapter.read(this.memoryPath);
    }
    return this.adapter.read(this.legacyMemoryPath);
  }

  enqueueWrite(operation) {
    const run = this.writeQueue.then(operation, operation);
    this.writeQueue = run.catch(() => {});
    return run;
  }
}

function createEmptyInteractionMemory() {
  return {
    version: 1,
    pendingEpisodes: [],
    episodes: [],
    patterns: [],
    tensions: [],
    stableImpressions: [],
    updatedAt: Date.now()
  };
}

function limitPendingEpisodes(episodes) {
  return (Array.isArray(episodes) ? episodes : [])
    .filter(Boolean)
    .sort((left, right) => Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0))
    .slice(0, MAX_PENDING_EPISODES)
    .sort((left, right) => Number(left.createdAt || left.updatedAt || 0) - Number(right.createdAt || right.updatedAt || 0));
}

function findPendingForSession(pendingEpisodes, sessionId) {
  const normalizedSessionId = String(sessionId || "");
  for (let index = pendingEpisodes.length - 1; index >= 0; index -= 1) {
    const episode = pendingEpisodes[index];
    if ((episode.sourceSessionId || "") === normalizedSessionId) {
      return episode;
    }
  }
  return null;
}

function createPendingEpisode(draft, now) {
  return {
    id: createInteractionId("episode"),
    status: "pending",
    context: draft.context,
    userExcerpt: draft.userExcerpt,
    assistantExcerpt: draft.assistantExcerpt,
    userSignals: draft.userSignals,
    assistantShape: draft.assistantShape,
    reaction: null,
    outcomeHint: "",
    sourceSessionId: draft.sourceSessionId,
    createdAt: now,
    updatedAt: now
  };
}

function closePendingEpisode(pending, draft, now) {
  return Object.assign({}, pending, {
    status: "closed",
    reaction: draft.reaction,
    outcomeHint: draft.outcomeHint,
    updatedAt: now
  });
}

function createInteractionId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  InteractionMemoryStore,
  createEmptyInteractionMemory,
  limitPendingEpisodes,
  MAX_PENDING_EPISODES
};
