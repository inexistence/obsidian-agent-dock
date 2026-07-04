const { CodexAgent } = require("./codex/CodexAgent");
const { CursorAgent } = require("./cursor/CursorAgent");

function createAgent(plugin) {
  switch (plugin.settings.agentId) {
    case "cursor":
      return new CursorAgent(plugin);
    case "codex":
    default:
      return new CodexAgent(plugin);
  }
}

const AGENT_OPTIONS = {
  codex: {
    label: "Codex",
    description: "OpenAI Codex CLI"
  },
  cursor: {
    label: "Cursor",
    description: "Cursor CLI via ACP"
  }
};

module.exports = {
  AGENT_OPTIONS,
  createAgent
};
