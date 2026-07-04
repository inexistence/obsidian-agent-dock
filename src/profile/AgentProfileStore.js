const { normalizePath } = require("obsidian");

const { ProfileObservationExtractor } = require("./ProfileObservationExtractor");
const {
  applyProfileObservations,
  getPromptTraits,
  normalizeProfile
} = require("./ProfileTraitReducer");

const PROFILE_DIR_NAME = "profile";
const PROFILE_FILE_NAME = "agent-profile.json";

class AgentProfileStore {
  constructor(plugin, options = {}) {
    this.plugin = plugin;
    this.adapter = plugin.app.vault.adapter;
    const pluginDir = plugin.manifest.dir || `.obsidian/plugins/${plugin.manifest.id}`;
    this.baseDir = normalizePath(`${pluginDir}/${PROFILE_DIR_NAME}`);
    this.profilePath = normalizePath(`${this.baseDir}/${PROFILE_FILE_NAME}`);
    this.extractor = options.extractor || new ProfileObservationExtractor();
    this.cache = null;
    this.writeQueue = Promise.resolve();
  }

  async getPromptTraits(settings) {
    if (!settings.agentProfileEnabled) {
      return [];
    }
    const profile = await this.loadProfile();
    return getPromptTraits(profile, settings);
  }

  async captureTurn(turn, settings) {
    if (!settings.agentProfileEnabled || !settings.agentProfileAutoCapture) {
      return {
        observations: [],
        traits: []
      };
    }

    return this.enqueueWrite(async () => {
      const profile = await this.loadProfile();
      const observations = this.extractor.extractTurn(turn);
      const result = applyProfileObservations(profile, observations, settings, Date.now());
      this.cache = result.profile;
      await this.saveProfile(result.profile);
      return {
        observations: result.observations,
        traits: result.traits
      };
    });
  }

  async clearProfile() {
    return this.enqueueWrite(async () => {
      this.cache = createEmptyProfile();
      try {
        if (await this.adapter.exists(this.profilePath)) {
          await this.adapter.remove(this.profilePath);
        }
      } catch (error) {
        console.warn("Agent Dock could not clear agent profile:", error);
      }
    });
  }

  async loadProfile() {
    if (this.cache) {
      return this.cache;
    }
    try {
      const raw = await this.adapter.read(this.profilePath);
      this.cache = normalizeProfile(JSON.parse(raw));
      return this.cache;
    } catch {
      this.cache = createEmptyProfile();
      return this.cache;
    }
  }

  async saveProfile(profile) {
    await this.ensureProfileDir();
    this.cache = normalizeProfile(profile);
    await this.adapter.write(this.profilePath, `${JSON.stringify(this.cache, null, 2)}\n`);
  }

  async ensureProfileDir() {
    if (await this.adapter.exists(this.baseDir)) {
      return;
    }
    await this.adapter.mkdir(this.baseDir);
  }

  enqueueWrite(operation) {
    const run = this.writeQueue.then(operation, operation);
    this.writeQueue = run.catch(() => {});
    return run;
  }
}

function createEmptyProfile() {
  return {
    version: 1,
    traits: [],
    observations: [],
    updatedAt: Date.now()
  };
}

module.exports = {
  AgentProfileStore,
  createEmptyProfile
};
