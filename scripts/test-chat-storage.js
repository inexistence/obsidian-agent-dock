const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      normalizePath: (path) => String(path || "").replace(/\\/g, "/")
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { ChatStorage } = require("../src/storage/ChatStorage");

async function testPruneDeletesAssociatedPastedImages() {
  const removedFiles = [];
  const deletedImagePaths = [];
  const adapter = {
    async exists() {
      return true;
    },
    async list(path) {
      assert.strictEqual(path, ".obsidian/plugins/agent-dock/sessions");
      return {
        files: [
          ".obsidian/plugins/agent-dock/sessions/keep.json",
          ".obsidian/plugins/agent-dock/sessions/delete.json"
        ],
        folders: []
      };
    },
    async read(path) {
      assert.strictEqual(path, ".obsidian/plugins/agent-dock/sessions/delete.json");
      return JSON.stringify({
        pastedImagePaths: [
          ".agent-dock-cache/pasted-images/a.png",
          ".agent-dock-cache/pasted-images/a.png",
          "",
          "Attachments/not-cache.png"
        ]
      });
    },
    async remove(path) {
      removedFiles.push(path);
    }
  };
  const storage = new ChatStorage({
    manifest: {
      id: "agent-dock",
      dir: ".obsidian/plugins/agent-dock"
    },
    app: {
      vault: {
        adapter
      }
    },
    async deletePastedImageCacheFiles(paths) {
      deletedImagePaths.push(paths);
    }
  });

  await storage.pruneSessionFiles(new Set(["keep.json"]));

  assert.deepStrictEqual(removedFiles, [".obsidian/plugins/agent-dock/sessions/delete.json"]);
  assert.deepStrictEqual(deletedImagePaths, [[
    ".agent-dock-cache/pasted-images/a.png",
    "Attachments/not-cache.png"
  ]]);
}

async function testAssistantTimelinePersistsAcrossSaveLoad() {
  const files = new Map();
  const adapter = {
    async exists(path) {
      return path === ".obsidian/plugins/agent-dock/sessions" || files.has(path);
    },
    async mkdir(path) {
      assert.strictEqual(path, ".obsidian/plugins/agent-dock/sessions");
    },
    async list(path) {
      assert.strictEqual(path, ".obsidian/plugins/agent-dock/sessions");
      return {
        files: [...files.keys()].filter((filePath) => filePath.startsWith(`${path}/`)),
        folders: []
      };
    },
    async read(path) {
      if (!files.has(path)) {
        throw new Error(`missing file: ${path}`);
      }
      return files.get(path);
    },
    async write(path, content) {
      files.set(path, content);
    },
    async remove(path) {
      files.delete(path);
    }
  };
  const plugin = {
    manifest: {
      id: "agent-dock",
      dir: ".obsidian/plugins/agent-dock"
    },
    app: {
      vault: {
        adapter
      }
    },
    chatState: {},
    async savePluginData() {}
  };
  const storage = new ChatStorage(plugin);
  const settings = {
    persistChatHistory: true,
    maxPersistedMessagesPerSession: 20,
    maxPersistedSessions: 10
  };

  await storage.saveSessions({
    activeSessionId: "session-a",
    sessions: [{
      id: "session-a",
      title: "Timeline",
      createdAt: 1000,
      updatedAt: 2000,
      messages: [{
        role: "assistant",
        content: "final answer",
        agentLabel: "Codex",
        agentId: "codex",
        createdAt: 1500,
        timeline: [
          { kind: "reasoning", title: "Thinking", detail: "plan", transient: true },
          { kind: "tool", title: "Command", summary: "node test | exit 0", detail: "full output", toolCallId: "tool-1", toolType: "command" },
          { kind: "content", text: "intermediate" },
          { kind: "notice", title: "Notice", summary: "context compressed", noticeType: "memory_referenced" },
          { kind: "activity", title: "Raw", detail: "debug-only provider output" },
          { kind: "content", text: "final answer" }
        ]
      }]
    }]
  }, settings);

  const raw = JSON.parse(files.get(".obsidian/plugins/agent-dock/sessions/session-a.json"));
  const persistedMessage = raw.messages[0];
  assert.strictEqual(persistedMessage.agentLabel, "Codex");
  assert.strictEqual(persistedMessage.timeline.length, 6);
  assert.strictEqual(persistedMessage.timeline[0].detail, "plan");
  assert.strictEqual(persistedMessage.timeline[0].transient, undefined);
  assert(persistedMessage.timeline.some((entry) => entry.kind === "activity"), "debug activity should be persisted");

  const restored = await storage.loadSessions(plugin.chatState, settings);
  const restoredMessage = restored.sessions[0].messages[0];
  assert.strictEqual(restoredMessage.agentLabel, "Codex");
  assert.deepStrictEqual(
    restoredMessage.timeline.map((entry) => entry.kind),
    ["reasoning", "tool", "content", "notice", "activity", "content"]
  );
  assert.strictEqual(restoredMessage.timeline[1].detail, "full output");
  assert.strictEqual(restoredMessage.timeline[1].toolType, "command");
  assert.strictEqual(restoredMessage.timeline[3].noticeType, "memory_referenced");
  assert.strictEqual(restoredMessage.timeline[4].detail, "debug-only provider output");
  assert.strictEqual(restoredMessage.timeline[5].text, "final answer");
}

async function testAssistantTimelineRedactsAndTruncatesDetails() {
  const files = new Map();
  const adapter = {
    async exists(path) {
      return path === ".obsidian/plugins/agent-dock/sessions" || files.has(path);
    },
    async mkdir() {},
    async list(path) {
      return {
        files: [...files.keys()].filter((filePath) => filePath.startsWith(`${path}/`)),
        folders: []
      };
    },
    async read(path) {
      return files.get(path);
    },
    async write(path, content) {
      files.set(path, content);
    },
    async remove(path) {
      files.delete(path);
    }
  };
  const plugin = {
    manifest: {
      id: "agent-dock",
      dir: ".obsidian/plugins/agent-dock"
    },
    app: {
      vault: {
        adapter
      }
    },
    chatState: {},
    async savePluginData() {}
  };
  const storage = new ChatStorage(plugin);
  const settings = {
    persistChatHistory: true,
    maxPersistedMessagesPerSession: 20,
    maxPersistedSessions: 10
  };

  await storage.saveSessions({
    activeSessionId: "session-b",
    sessions: [{
      id: "session-b",
      title: "Large timeline",
      createdAt: 1000,
      updatedAt: 2000,
      messages: [{
        role: "assistant",
        content: "final answer",
        createdAt: 1500,
        timeline: [
          { kind: "tool", title: "Command", summary: "api_key=abc123", detail: "x".repeat(13000) },
          { kind: "content", text: "final answer" }
        ]
      }]
    }]
  }, settings);

  const raw = JSON.parse(files.get(".obsidian/plugins/agent-dock/sessions/session-b.json"));
  const toolEntry = raw.messages[0].timeline[0];
  assert.strictEqual(toolEntry.summary, "[Sensitive content omitted]");
  assert(toolEntry.detail.length < 12100, "tool detail should be bounded");
  assert(toolEntry.detail.includes("[Persisted timeline detail truncated]"));
}

Promise.resolve()
  .then(testPruneDeletesAssociatedPastedImages)
  .then(testAssistantTimelinePersistsAcrossSaveLoad)
  .then(testAssistantTimelineRedactsAndTruncatesDetails)
  .then(() => {
    console.log("chat storage tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
