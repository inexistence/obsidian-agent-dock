const { normalizePath } = require("obsidian");

const LOCAL_DATA_DIR_NAME = ".agent-dock-local";

function getPluginDir(plugin) {
  return plugin.manifest.dir || `.obsidian/plugins/${plugin.manifest.id}`;
}

function getLocalDataDir(plugin) {
  return normalizePath(`${getPluginDir(plugin)}/${LOCAL_DATA_DIR_NAME}`);
}

function getLocalDataPath(plugin, ...segments) {
  return normalizePath([getLocalDataDir(plugin)].concat(segments).join("/"));
}

function getLegacyPluginPath(plugin, ...segments) {
  return normalizePath([getPluginDir(plugin)].concat(segments).join("/"));
}

async function ensureLocalDataPath(plugin, adapter, path) {
  const localDataDir = getLocalDataDir(plugin);
  if (!await adapter.exists(localDataDir)) {
    await adapter.mkdir(localDataDir);
  }
  if (!await adapter.exists(path)) {
    await adapter.mkdir(path);
  }
}

module.exports = {
  LOCAL_DATA_DIR_NAME,
  getLocalDataDir,
  getLocalDataPath,
  getLegacyPluginPath,
  ensureLocalDataPath
};
