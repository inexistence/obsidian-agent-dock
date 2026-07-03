const { CodexAgent } = require("./codex/CodexAgent");

function createAgent(plugin) {
  switch (plugin.settings.agentId) {
    case "codex":
    default:
      return new CodexAgent(plugin);
  }
}

const AGENT_OPTIONS = {
  codex: {
    label: "Codex",
    description: "OpenAI Codex CLI"
  }
};

module.exports = {
  AGENT_OPTIONS,
  createAgent
};
