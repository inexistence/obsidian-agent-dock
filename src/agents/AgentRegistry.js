const { CodexAgent } = require("./codex/CodexAgent");
const { CursorAgent } = require("./cursor/CursorAgent");

const AGENT_DESCRIPTORS = {
  codex: {
    label: "Codex",
    description: "OpenAI Codex CLI",
    create: (plugin) => new CodexAgent(plugin)
  },
  cursor: {
    label: "Cursor",
    description: "Cursor CLI via ACP",
    create: (plugin) => new CursorAgent(plugin)
  }
};

const AGENT_OPTIONS = Object.fromEntries(
  Object.entries(AGENT_DESCRIPTORS).map(([id, descriptor]) => [id, {
    label: descriptor.label,
    description: descriptor.description
  }])
);

function createAgent(plugin) {
  const descriptor = AGENT_DESCRIPTORS[plugin.settings.agentId]
    || AGENT_DESCRIPTORS.codex;
  const agent = descriptor.create(plugin);
  if (!agent || typeof agent.run !== "function" || typeof agent.openInteractive !== "function") {
    throw new Error(`Invalid agent adapter: ${plugin.settings.agentId || "codex"}`);
  }
  return agent;
}

module.exports = {
  AGENT_OPTIONS,
  createAgent
};
