const { normalizePath } = require("obsidian");

const { ensureLocalDataPath, getLegacyPluginPath, getLocalDataPath } = require("./localDataPath");
const { writeJsonAtomically } = require("./atomicJson");

const MEMORY_DIR_NAME = "memory";
const MEMORY_FILE_NAME = "memory.json";

class MemoryRepository {
  constructor(plugin) {
    this.plugin = plugin;
    this.adapter = plugin.app.vault.adapter;
    this.baseDir = getLocalDataPath(plugin, MEMORY_DIR_NAME);
    this.memoryPath = normalizePath(`${this.baseDir}/${MEMORY_FILE_NAME}`);
    this.legacyMemoryPath = getLegacyPluginPath(plugin, MEMORY_DIR_NAME, MEMORY_FILE_NAME);
    this.cache = null;
    this.storageError = null;
    this.writeQueue = Promise.resolve();
  }

  async load(normalizeMemory, createEmptyMemory) {
    if (this.cache) {
      return this.cache;
    }
    try {
      const raw = await this.readMemoryFile();
      if (raw === null) {
        this.cache = createEmptyMemory();
        return this.cache;
      }
      this.cache = normalizeMemory(JSON.parse(raw));
      this.storageError = null;
      return this.cache;
    } catch (error) {
      this.storageError = error;
      this.cache = createEmptyMemory();
      console.warn("Agent Dock could not read memory; writes are disabled to preserve the existing file:", error);
      return this.cache;
    }
  }

  async save(memory, normalizeMemory) {
    if (this.storageError) {
      throw new Error("Memory storage is write-protected because the existing file could not be read.", {
        cause: this.storageError
      });
    }
    await ensureLocalDataPath(this.plugin, this.adapter, this.baseDir);
    const normalized = normalizeMemory(memory);
    await writeJsonAtomically(this.adapter, this.memoryPath, normalized);
    this.cache = normalized;
  }

  async clear(createEmptyMemory) {
    try {
      if (await this.adapter.exists(this.legacyMemoryPath)) {
        await this.adapter.remove(this.legacyMemoryPath);
      }
      if (await this.adapter.exists(this.memoryPath)) {
        await this.adapter.remove(this.memoryPath);
      }
    } catch (error) {
      this.cache = null;
      throw error;
    }
    this.storageError = null;
    this.cache = createEmptyMemory();
  }

  enqueueWrite(operation) {
    const run = this.writeQueue.then(operation, operation);
    this.writeQueue = run.catch(() => {});
    return run;
  }

  async readMemoryFile() {
    if (await this.adapter.exists(this.memoryPath)) {
      return this.adapter.read(this.memoryPath);
    }
    if (await this.adapter.exists(this.legacyMemoryPath)) {
      return this.adapter.read(this.legacyMemoryPath);
    }
    return null;
  }
}

module.exports = {
  MemoryRepository
};
