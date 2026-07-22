const CURSOR_MODE_BY_PLUGIN_MODE = {
  readOnly: "ask",
  workspaceWrite: "agent"
};

function toCursorMode(pluginMode, defaultMode = "readOnly") {
  return CURSOR_MODE_BY_PLUGIN_MODE[pluginMode]
    || CURSOR_MODE_BY_PLUGIN_MODE[defaultMode]
    || "ask";
}

module.exports = {
  CURSOR_MODE_BY_PLUGIN_MODE,
  toCursorMode
};
