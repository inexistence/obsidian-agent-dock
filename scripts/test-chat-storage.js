const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") return { normalizePath: (value) => String(value).replace(/\\/g, "/") };
  return originalLoad.call(this, request, parent, isMain);
};

const { ChatStorage } = require("../src/storage/ChatStorage");

async function main() {
  const files = new Map();
  const adapter = {
    async exists(path) { return path.endsWith(".agent-dock-local") || path.endsWith("sessions") || files.has(path); },
    async mkdir() {},
    async list(path) { return { files: [...files.keys()].filter((file) => file.startsWith(`${path}/`)), folders: [] }; },
    async read(path) { if (!files.has(path)) throw new Error(`missing ${path}`); return files.get(path); },
    async write(path, value) { files.set(path, value); },
    async remove(path) { files.delete(path); }
  };
  const plugin = {
    manifest: { id: "agent-dock", dir: ".obsidian/plugins/agent-dock" },
    app: { vault: { adapter } },
    chatState: {},
    async savePluginData() {}
  };
  const storage = new ChatStorage(plugin);
  const settings = { persistChatHistory: true, maxPersistedSessions: 10, maxPersistedMessagesPerSession: 20 };
  await storage.saveSessions({
    activeSessionId: "s1",
    sessions: [{
      id: "s1", title: "Test", createdAt: 1, updatedAt: 2,
      messages: [{
        id: "a1", role: "assistant", content: "done", createdAt: 2,
        toneCapsule: { id: "starry-eyed" },
        timeline: [
          { kind: "tool", toolType: "file_change", title: "Edited", paths: ["A.md", "B.md"] },
          { kind: "activity", title: "Prompt", detail: "private", persist: false },
          { kind: "content", text: "done" }
        ]
      }]
    }]
  }, settings);
  const stored = JSON.parse(files.get(".obsidian/plugins/agent-dock/.agent-dock-local/sessions/s1.json"));
  assert.equal(stored.messages[0].toneCapsule, undefined);
  assert.deepEqual(stored.messages[0].timeline[0].paths, ["A.md", "B.md"]);
  assert.equal(stored.messages[0].timeline.length, 2);
  const restored = await storage.loadSessions(plugin.chatState, settings);
  assert.equal(restored.sessions[0].messages[0].content, "done");
  assert.equal(restored.sessions[0].messages[0].toneCapsule, undefined);
  console.log("chat storage tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
