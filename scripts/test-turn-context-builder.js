const assert = require("assert");

const { buildAgentTurnContext } = require("../src/agents/shared/TurnContextBuilder");

async function main() {
  const notices = [];
  const plugin = {
    app: {
      workspace: { getActiveFile: () => ({ path: "Notes/Active.md" }) },
      vault: {
        adapter: { basePath: "/Users/example/Vault" },
        getAbstractFileByPath: (path) => path === "Notes/Active.md" ? { path, name: "Active.md" } : null,
        getAllLoadedFiles: () => []
      }
    }
  };
  const result = await buildAgentTurnContext({
    plugin,
    settings: { assistantStyle: "concise", contextLimitChars: 4000 },
    prompt: "请阅读 [[Notes/Active.md]] 和 ![[.agent-dock-cache/pasted-images/chart.png]] 后回答",
    conversation: [{ role: "user", content: "Earlier question" }],
    onUpdate: (update) => notices.push(update),
    translate: (key) => key,
    useFullPrompt: true
  });
  assert.equal(result.activeFilePath, "Notes/Active.md");
  assert(result.promptResult.prompt.includes("Active Obsidian note:"));
  assert(result.promptResult.prompt.includes("Referenced Obsidian paths:"));
  assert(result.promptResult.prompt.includes("/Users/example/Vault/.agent-dock-cache/pasted-images/chart.png (pasted image; absolute local path)"));
  assert(result.promptResult.prompt.includes("Conversation so far:"));
  assert(result.promptResult.prompt.includes("User request:"));
  assert(!/memory|reflection|affect|persona|salience/i.test(result.promptResult.prompt));
  assert.equal(notices.length, 0);
  console.log("turn context builder tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
