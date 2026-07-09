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

const {
  buildAgentTurnContext,
  buildPromptResultForTurnContext
} = require("../src/agents/shared/TurnContextBuilder");

const now = Date.UTC(2026, 6, 9);

function createMemory(id, text, scope = "project") {
  return {
    id,
    kind: "note",
    scope,
    text,
    confidence: 0.8,
    createdAt: now,
    updatedAt: now
  };
}

function createPlugin() {
  return {
    app: {
      workspace: {
        getActiveFile: () => ({ path: "Notes/Active.md" })
      },
      vault: {
        getAllLoadedFiles: () => [],
        getAbstractFileByPath: () => null
      }
    },
    memoryStore: {
      async getRelevantMemories() {
        return [
          createMemory("auto-duplicate", "Use compact final answers for this project.", "user"),
          createMemory("auto-project", "Keep architecture docs updated.", "project")
        ];
      },
      async searchMemories() {
        return [
          createMemory("explicit", "Use compact final answers for this project.", "user")
        ];
      }
    },
    interactionMemoryStore: {
      async getPromptStance() {
        return [
          {
            kind: "pattern",
            axis: "collaboration_style",
            text: "Low confidence stance should be filtered.",
            confidence: 0.2,
            evidenceCount: 2
          },
          {
            kind: "pattern",
            axis: "collaboration_style",
            text: "Prefer concise implementation notes.",
            confidence: 0.7,
            evidenceCount: 3
          }
        ];
      }
    },
    getPromptWorkingAffect() {
      return {
        transient: true,
        label: "steady"
      };
    }
  };
}

function translate(key, params = {}) {
  if (key.endsWith(".summary")) {
    return `${key}:${JSON.stringify(params)}`;
  }
  return key;
}

async function testBuildAgentTurnContext() {
  const notices = [];
  const result = await buildAgentTurnContext({
    plugin: createPlugin(),
    settings: {
      assistantStyle: "collaborative",
      contextLimitChars: 8000,
      memoryEnabled: true,
      memoryAgentSearchEnabled: true,
      interactionMemoryEnabled: true
    },
    prompt: "之前说过偏好是什么？",
    conversation: [{ role: "user", content: "之前说过偏好是什么？" }],
    cwd: "/tmp/vault",
    onUpdate: (update) => notices.push(update),
    translate,
    keyPrefix: "codex"
  });

  assert.equal(result.activeFilePath, "Notes/Active.md");
  assert(result.promptResult.prompt.includes("Explicit local memory search results"));
  assert(result.promptResult.prompt.includes("Use compact final answers"));
  assert(result.promptResult.prompt.includes("Keep architecture docs updated"));
  assert(!result.promptResult.prompt.includes("Low confidence stance should be filtered"));
  assert(result.promptResult.prompt.includes("Prefer concise implementation notes"));
  assert(!result.promptResult.prompt.includes("Current turn tone signal"));
  assert.deepEqual(
    result.promptSignals.memories.map((memory) => memory.id),
    ["auto-project"],
    "automatic memory should be planned after explicit-search de-duplication"
  );
  assert(notices.some((notice) => notice.noticeType === "memory_search"));
  assert(notices.some((notice) => notice.noticeType === "memory_referenced"));
}

async function testBuildPromptResultForTurnContextUsesSessionPrompt() {
  const promptSignals = {
    memories: [],
    memorySearchResults: [],
    memorySearchPerformed: false,
    interactionStance: [],
    workingAffect: null
  };
  const result = await buildPromptResultForTurnContext({
    app: createPlugin().app,
    settings: {
      assistantStyle: "collaborative",
      contextLimitChars: 8000
    },
    prompt: "session scoped request",
    conversation: [{ role: "user", content: "older message" }],
    promptSignals,
    useFullPrompt: false
  });

  assert(result.prompt.includes("User request:\nsession scoped request"));
  assert(!result.prompt.includes("Conversation so far:"));
}

Promise.resolve()
  .then(testBuildAgentTurnContext)
  .then(testBuildPromptResultForTurnContextUsesSessionPrompt)
  .then(() => {
    console.log("Turn context builder tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
