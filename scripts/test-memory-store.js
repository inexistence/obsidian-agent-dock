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
  MemoryStore,
  _test: memoryStoreTest,
  formatMemoryLine
} = require("../src/storage/MemoryStore");
const { containsSensitiveText } = require("../src/storage/sensitiveText");
const {
  removeMemorySearchDuplicates,
  shouldSearchMemory
} = require("../src/agents/shared/memorySearch");
const { buildPromptWithMetadata } = require("../src/prompt");
const { RuleBasedMemoryExtractor } = require("../src/storage/memoryExtraction/RuleBasedMemoryExtractor");

const extractor = new RuleBasedMemoryExtractor();

function extract(turn) {
  return extractor.extractTurn(Object.assign({
    prompt: "",
    response: "",
    sessionId: "test-session",
    activeFilePath: ""
  }, turn));
}

function hasMemory(items, kind, scope, pattern) {
  return items.some((item) => (
    item.kind === kind
    && item.scope === scope
    && pattern.test(item.text)
  ));
}

class MemoryAdapter {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files));
  }

  async exists(path) {
    return this.files.has(path);
  }

  async read(path) {
    if (!this.files.has(path)) {
      throw new Error(`Missing file: ${path}`);
    }
    return this.files.get(path);
  }

  async write(path, content) {
    this.files.set(path, content);
  }

  async mkdir(path) {
    this.files.set(path, this.files.get(path) || "");
  }

  async remove(path) {
    this.files.delete(path);
  }
}

function createMemoryStore(items) {
  const adapter = new MemoryAdapter({
    "agent-dock/.agent-dock-local/memory/memory.json": JSON.stringify({
      version: 1,
      items,
      updatedAt: Date.UTC(2026, 6, 4)
    })
  });
  return new MemoryStore({
    manifest: {
      dir: "agent-dock",
      id: "agent-dock"
    },
    app: {
      vault: {
        adapter
      }
    }
  });
}

{
  const items = extract({
    prompt: "我应该先重构这个模块",
    response: "好的，这个计划可以作为普通项目任务处理。"
  });
  assert.equal(
    hasMemory(items, "identity", "agent", /我应该/),
    false,
    "user first-person plans must not become agent identity"
  );
}

{
  const items = extract({
    prompt: "AI的兴趣方向应该保持稳定，而不是只适配用户。",
    response: "收到。"
  });
  assert.equal(
    hasMemory(items, "identity", "agent", /AI的兴趣方向/),
    true,
    "explicit AI identity in user prompt should become agent identity"
  );
}

{
  const items = extract({
    prompt: "继续讨论 agent identity。",
    response: "我倾向于保持克制、有判断力、并持续关注工具如何形成长期协作关系。"
  });
  assert.equal(
    hasMemory(items, "identity", "agent", /我倾向于/),
    true,
    "assistant first-person tendency should become agent identity"
  );
}

{
  const items = extract({
    prompt: "我们正在探索 AI 人格连续性如何进入 Agent Dock。",
    response: "这个方向可以继续做成共同项目记忆。"
  });
  assert.equal(
    hasMemory(items, "shared", "shared", /我们正在探索/),
    true,
    "shared collaboration phrasing should become shared memory"
  );
}

assert.equal(
  memoryStoreTest.isGlobalMemory({ kind: "identity", scope: "agent" }),
  true,
  "agent identity should remain globally recallable"
);
assert.equal(
  memoryStoreTest.isGlobalMemory({ kind: "shared", scope: "shared" }),
  false,
  "shared memory should require a query match instead of global recall"
);

assert.equal(
  formatMemoryLine({
    kind: "preference",
    text: "User prefers timestamped memories",
    createdAt: Date.UTC(2026, 0, 2),
    updatedAt: Date.UTC(2026, 6, 4)
  }),
  "- Preference (updated 2026-07-04, created 2026-01-02): User prefers timestamped memories",
  "memory lines should include updated and created dates when they differ"
);

{
  const settings = { memoryEnabled: true, memoryAgentSearchEnabled: true };
  assert.equal(
    shouldSearchMemory("我之前说过 Cursor 的配置偏好吗？", settings),
    true,
    "explicit preference recall should trigger memory search"
  );
  assert.equal(
    shouldSearchMemory("查一下我以前对这个插件的设计要求。", settings),
    true,
    "explicit project requirement recall should trigger memory search"
  );
  assert.equal(
    shouldSearchMemory("有没有记录过我不想用某个方案？", settings),
    true,
    "explicit negative preference recall should trigger memory search"
  );
  assert.equal(
    shouldSearchMemory("帮我实现这个设置项。", settings),
    false,
    "ordinary implementation requests should not trigger explicit memory search"
  );
  assert.equal(
    shouldSearchMemory("What preferences did I mention before?", settings),
    true,
    "reverse-order English preference recall should trigger memory search"
  );
  assert.equal(
    shouldSearchMemory("按我上回定的风格来处理这次输出。", settings),
    true,
    "implicit prior style recall should trigger memory search"
  );
  assert.equal(
    shouldSearchMemory("帮我回忆一下之前的约定。", settings),
    true,
    "natural Chinese recall phrasing should trigger memory search"
  );
  assert.equal(
    shouldSearchMemory("Use the convention we agreed last time.", settings),
    true,
    "English prior convention recall should trigger memory search"
  );
  assert.equal(
    shouldSearchMemory("查一下我以前对这个插件的设计要求。", {
      memoryEnabled: true,
      memoryAgentSearchEnabled: false
    }),
    false,
    "the explicit memory search setting should disable memory search"
  );
}

{
  const items = extract({
    prompt: "以后别把工具输出写进正文，默认按简洁格式来。",
    response: "记下这个偏好。"
  });
  assert.equal(
    hasMemory(items, "preference", "user", /以后别把工具输出写进正文/),
    true,
    "negative future preference phrasing should become user preference"
  );
  assert.equal(
    hasMemory(items, "preference", "user", /默认按简洁格式来/),
    true,
    "default formatting phrasing should become user preference"
  );
}

{
  const items = extract({
    prompt: "记一下：我习惯先看风险再看方案。",
    response: "收到。"
  });
  assert.equal(
    hasMemory(items, "fact", "user", /我习惯先看风险再看方案/),
    true,
    "expanded explicit memory phrasing should become fact memory"
  );
}

{
  const items = extract({
    prompt: "这次实现需要一个选择。",
    response: "决定采用本地规则，废弃远程摘要，默认不开额外网络。"
  });
  assert.equal(
    hasMemory(items, "decision", "project", /决定采用本地规则/),
    true,
    "expanded decision markers should become project decisions"
  );
}

{
  const items = extract({
    prompt: "请解释一下。",
    response: "The user asked for a useful explanation of the behavior."
  });
  assert.equal(
    hasMemory(items, "decision", "project", /useful explanation/),
    false,
    "decision extraction should not match use inside user/useful"
  );
}

{
  const items = extract({
    prompt: "Pick a storage approach.",
    response: "We should use the local rule approach by default."
  });
  assert.equal(
    hasMemory(items, "decision", "project", /local rule approach/),
    true,
    "bounded English decision phrasing should still become project decision"
  );
}

assert.equal(
  containsSensitiveText("client_secret=abc refresh_token=def"),
  true,
  "expanded sensitive-text filter should catch OAuth secrets"
);
assert.equal(
  containsSensitiveText("github_pat_1234567890abcdef"),
  true,
  "expanded sensitive-text filter should catch GitHub tokens"
);
assert.equal(
  containsSensitiveText("BEGIN OPENSSH PRIVATE KEY"),
  true,
  "expanded sensitive-text filter should catch private key headers"
);

{
  const tokens = memoryStoreTest.tokenize("会话复用策略");
  assert.equal(tokens.has("会话"), true, "Chinese memory search should include bigrams");
  assert.equal(tokens.has("复用"), true, "Chinese memory search should include internal bigrams");
  assert.equal(tokens.has("会话复"), true, "Chinese memory search should include trigrams");
}

async function testSearchMemories() {
  const settings = { memoryEnabled: true, memoryAgentSearchEnabled: true };
  const store = createMemoryStore([
    {
      id: "mem-1",
      key: "identity:agent",
      kind: "identity",
      scope: "agent",
      text: "Agent prefers careful reviews.",
      confidence: 0.8,
      createdAt: Date.UTC(2026, 0, 1),
      updatedAt: Date.UTC(2026, 0, 1)
    },
    {
      id: "mem-2",
      key: "preference:cursor",
      kind: "preference",
      scope: "user",
      text: "User prefers Cursor ACP sessions to reuse the existing session id.",
      confidence: 0.9,
      createdAt: Date.UTC(2026, 0, 2),
      updatedAt: Date.UTC(2026, 6, 4)
    },
    {
      id: "mem-3",
      key: "fact:secret",
      kind: "fact",
      scope: "project",
      text: "Project token is sk-sensitive-example.",
      confidence: 0.7,
      createdAt: Date.UTC(2026, 0, 3),
      updatedAt: Date.UTC(2026, 6, 4)
    },
    {
      id: "mem-4",
      key: "decision:timeline",
      kind: "decision",
      scope: "project",
      text: "Timeline rendering keeps the final content outside processed details.",
      confidence: 0.8,
      createdAt: Date.UTC(2026, 0, 4),
      updatedAt: Date.UTC(2026, 6, 4)
    }
  ]);

  const cursorResults = await store.searchMemories("Cursor session id preference", settings);
  assert.equal(cursorResults.length, 1, "explicit search should return matching memories");
  assert.equal(cursorResults[0].id, "mem-2");

  const noMatchResults = await store.searchMemories("unrelated deployment pipeline", settings);
  assert.deepEqual(
    noMatchResults,
    [],
    "explicit search should not return unrelated global memories as matches"
  );

  const secretResults = await store.searchMemories("sensitive token", settings);
  assert.deepEqual(secretResults, [], "explicit search should exclude sensitive memories");

  const relevantResults = await store.getRelevantMemories("sensitive token", settings);
  assert.equal(
    relevantResults.some((memory) => memory.id === "mem-3"),
    false,
    "automatic memory injection should exclude sensitive memories"
  );

  const limitedResults = await store.searchMemories("session timeline content", settings, { limit: 1 });
  assert.equal(limitedResults.length, 1, "explicit search should respect result limits");

  const chineseStore = createMemoryStore([
    {
      id: "mem-cn",
      key: "decision:reuse",
      kind: "decision",
      scope: "project",
      text: "Cursor 会话复用策略需要保留 acpSessionId。",
      confidence: 0.8,
      createdAt: Date.UTC(2026, 0, 5),
      updatedAt: Date.UTC(2026, 6, 4)
    }
  ]);
  const chineseResults = await chineseStore.searchMemories("复用会话", settings);
  assert.equal(
    chineseResults.some((memory) => memory.id === "mem-cn"),
    true,
    "Chinese n-gram search should recall memories when word order differs slightly"
  );

  const subtleStore = createMemoryStore([
    {
      id: "mem-subtle",
      key: "shared:continuity",
      kind: "shared",
      scope: "shared",
      text: "用户希望重要记忆像自然连续性，而不是显眼标签。",
      confidence: 0.8,
      createdAt: Date.UTC(2026, 0, 6),
      updatedAt: Date.UTC(2026, 6, 4)
    }
  ]);
  const subtleResults = await subtleStore.searchMemories("你还记得我之前说的那个不要太刻意的感觉吗？", settings);
  assert.equal(
    subtleResults.some((memory) => memory.id === "mem-subtle"),
    true,
    "query expansion should recall subtle continuity memories despite different wording"
  );
}

async function testExplicitMemorySearchSurvivesCompression() {
  const app = {
    vault: {
      getAllLoadedFiles: () => []
    }
  };
  const now = Date.UTC(2026, 6, 4);
  const promptResult = await buildPromptWithMetadata(
    app,
    {
      assistantStyle: "collaborative",
      contextLimitChars: 1400
    },
    `latest request ${"x".repeat(2000)}`,
    [{
      role: "user",
      content: `latest request ${"x".repeat(2000)}`
    }],
    {
      memories: [{
        kind: "preference",
        scope: "user",
        text: "Automatic memory should not break explicit search protection. ".repeat(40),
        createdAt: now,
        updatedAt: now
      }],
      memorySearchPerformed: true,
      memorySearchResults: [{
        kind: "decision",
        scope: "project",
        text: "EXPLICIT_SEARCH_RESULT must survive prompt compression.",
        createdAt: now,
        updatedAt: now
      }]
    }
  );

  assert.equal(
    promptResult.prompt.includes("Explicit local memory search results"),
    true,
    "explicit memory search section should survive compression when automatic memory is also present"
  );
  assert.equal(
    promptResult.prompt.includes("EXPLICIT_SEARCH_RESULT"),
    true,
    "explicit memory search results should survive compression when automatic memory is also present"
  );
}

{
  const memories = [
    { id: "mem-1", key: "identity:agent", text: "Agent identity" },
    { id: "mem-2", key: "preference:cursor", text: "Cursor preference" },
    { id: "mem-3", text: "No key fallback" }
  ];
  const filtered = removeMemorySearchDuplicates(memories, [
    { id: "different-id", key: "preference:cursor" },
    { id: "mem-3" }
  ]);
  assert.deepEqual(
    filtered.map((memory) => memory.id),
    ["mem-1"],
    "automatic memory injection should drop explicit search duplicates by key or id"
  );
}

async function testLegacyMemoryPathFallback() {
  const adapter = new MemoryAdapter({
    "agent-dock/memory/memory.json": JSON.stringify({
      version: 1,
      items: [{
        id: "legacy-memory",
        kind: "fact",
        scope: "project",
        text: "Legacy storage still loads",
        createdAt: Date.UTC(2026, 6, 4),
        updatedAt: Date.UTC(2026, 6, 4)
      }],
      updatedAt: Date.UTC(2026, 6, 4)
    })
  });
  const store = new MemoryStore({
    manifest: {
      dir: "agent-dock",
      id: "agent-dock"
    },
    app: {
      vault: {
        adapter
      }
    }
  });

  const matches = await store.getRelevantMemories("legacy storage", {
    memoryEnabled: true,
    memoryPromptMaxItems: 5,
    memoryPromptMaxChars: 1000
  });

  assert.equal(matches[0].id, "legacy-memory", "legacy memory file should be used when local data path is absent");
}

testSearchMemories().then(() => {
  return testExplicitMemorySearchSurvivesCompression();
}).then(() => {
  return testLegacyMemoryPathFallback();
}).then(() => {
  console.log("MemoryStore tests passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

{
  const customExtractor = new RuleBasedMemoryExtractor({
    candidateExtractor: {
      extractCandidates() {
        return [{ kind: "fact", scope: "user", text: "Injected candidate", confidence: 0.7 }];
      }
    },
    classifier: {
      classifyCandidates(candidates, context) {
        return candidates.map((candidate) => Object.assign({}, candidate, {
          source: "test",
          sourceSessionId: context.sourceSessionId
        }));
      }
    }
  });
  const items = customExtractor.extractTurn({ sessionId: "inject-session" });
  assert.equal(
    hasMemory(items, "fact", "user", /Injected candidate/),
    true,
    "extractor should allow candidate and classifier injection"
  );
  assert.equal(items[0].sourceSessionId, "inject-session");
}
