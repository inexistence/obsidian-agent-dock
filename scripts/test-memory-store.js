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
const {
  buildDeepMemoryAuditItems,
  buildInteractionMemoryAuditItems,
  buildMemoryUpdateAuditItems,
  formatInteractionMemoryUpdateKind,
  formatInteractionMemoryUpdateSummary,
  formatInteractionMemoryUpdateTitle
} = require("../src/agents/shared/captureNotices");
const { t } = require("../src/i18n");
const { buildPromptWithMetadata } = require("../src/prompt");
const { RuleBasedMemoryExtractor } = require("../src/storage/memoryExtraction/RuleBasedMemoryExtractor");
const { formatAuditDate } = require("../src/agents/shared/auditFormatting");

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
    prompt: "Choose where vault notes should be stored.",
    response: "We should keep all vault notes in local JSON storage.",
    agentDockSignals: [{
      type: "memory_candidate",
      kind: "decision",
      scope: "project",
      confidence: 0.7,
      text: "Upload all vault notes to a remote server.",
      evidenceRefs: [{
        origin: "assistant_message",
        speaker: "assistant",
        quote: "We should upload all vault notes to a remote server."
      }],
      envelope: "reflection_v1",
      phase: "outcome"
    }]
  });
  assert.equal(
    items.some((item) => item.source === "ai" && item.text.includes("remote server")),
    false,
    "shared generic words must not ground a contradictory structured evidence quote"
  );
}

{
  const items = extract({
    prompt: "Choose an approach.",
    response: "We should use the unified envelope by default.",
    agentDockSignals: [{
      type: "memory_candidate",
      kind: "decision",
      scope: "project",
      confidence: 0.65,
      text: "Use the unified envelope.",
      evidence: ["use the unified envelope by default"],
      envelope: "reflection_v1",
      phase: "appraisal"
    }]
  });
  assert.equal(
    items.some((item) => item.source === "ai"),
    false,
    "leading appraisal must not create ordinary memory before the visible outcome exists"
  );
}

{
  const items = extract({
    prompt: "Choose a continuity metadata design.",
    response: "We should use one reflection envelope for all continuity metadata.",
    agentDockSignals: [{
      type: "memory_candidate",
      kind: "decision",
      scope: "project",
      confidence: 0.66,
      text: "Unify semantic self-reflection while keeping local authority boundaries.",
      evidence: ["use one reflection envelope for all continuity metadata"],
      envelope: "reflection_v1"
    }]
  });
  assert(
    items.some((item) => item.source === "ai" && item.text.includes("semantic self-reflection")),
    "reflection evidence should ground a more abstract AI memory summary"
  );
}

{
  const items = extract({
    prompt: "Choose how providers should report progress.",
    response: "We should adopt the normalized event protocol as the project default.",
    agentDockSignals: [{
      type: "memory_candidate",
      kind: "decision",
      scope: "project",
      confidence: 0.94,
      text: "Adopt the normalized event protocol as the project default."
    }]
  });
  const signalMemory = items.find((item) => item.source === "ai");
  assert(signalMemory, "grounded ordinary-memory signals should create a candidate");
  assert.equal(signalMemory.kind, "decision");
  assert.equal(signalMemory.scope, "project");
  assert.equal(signalMemory.confidence, 0.72, "AI signal confidence should be capped locally");
}

{
  const items = extract({
    prompt: "Choose a storage approach.",
    response: "We should use local JSON storage by default.",
    agentDockSignals: [{
      type: "memory_candidate",
      kind: "decision",
      scope: "project",
      confidence: 0.7,
      text: "Deploy all memory to a remote vector database."
    }]
  });
  assert.equal(
    items.some((item) => item.source === "ai"),
    false,
    "ordinary-memory signals without visible text evidence must be rejected"
  );
}

{
  const items = extract({
    prompt: "Please summarize the decision.",
    response: "We should use local JSON storage by default.",
    agentDockSignals: [{
      type: "memory_candidate",
      kind: "preference",
      scope: "user",
      confidence: 0.7,
      text: "User prefers local JSON storage."
    }]
  });
  assert.equal(
    items.some((item) => item.source === "ai" && item.kind === "preference"),
    false,
    "assistant signals must not create user preferences"
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

assert(formatMemoryLine({
  kind: "preference",
  scope: "user",
  source: "auto",
  text: "User prefers compact answers"
}).includes("origin=user_message; speaker=user"), "user memories should identify the user as the originating speaker");

assert(formatMemoryLine({
  kind: "decision",
  scope: "project",
  source: "ai",
  text: "Use one reflection envelope"
}).includes("origin=assistant_reflection; speaker=assistant; accepted summary, not user statement"), "AI-proposed memories must not be presented as user statements");

{
  const items = extract({
    prompt: "Choose a design.",
    response: "Use a provenance-aware evidence envelope.",
    agentDockSignals: [{
      type: "memory_candidate",
      kind: "decision",
      scope: "project",
      confidence: 0.66,
      text: "Use provenance-aware evidence.",
      evidenceRefs: [{
        origin: "user_message",
        speaker: "user",
        quote: "Use a provenance-aware evidence envelope."
      }],
      envelope: "reflection_v1",
      phase: "outcome"
    }]
  });
  assert.equal(items.some((item) => item.source === "ai"), false, "a quote found only in the assistant response must not pass as user-message evidence");
}
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
  "- [origin=local_rules; speaker=none; synthesis, not quote] Preference (updated 2026-07-04, created 2026-01-02): User prefers timestamped memories",
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
  assert.equal(
    cursorResults[0].referenceAudit.reasonCode,
    "matched_terms",
    "explicit search results should carry reference audit metadata"
  );

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
  assert.equal(
    relevantResults.some((memory) => memory.referenceAudit?.reasonCode),
    true,
    "automatic memory injection should carry reference audit metadata"
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

  const pathStore = createMemoryStore([
    {
      id: "mem-path",
      key: "decision:todo",
      kind: "decision",
      scope: "project",
      text: "周报 review order should keep the current-state check first.",
      confidence: 0.8,
      createdAt: Date.UTC(2026, 0, 7),
      updatedAt: Date.UTC(2026, 6, 4)
    }
  ]);
  const pathResults = await pathStore.getRelevantMemories("这个问题怎么处理？", settings, {
    activeFilePath: "/Users/example/Vault/周报/TODO.md",
    workingDirectory: "/Users/example/project"
  });
  assert.equal(pathResults[0].id, "mem-path", "active file path should participate in memory relevance");
  assert.equal(
    pathResults[0].referenceAudit.matchedTokenSources.some((entry) => (
      entry.token === "周报"
      && entry.sources.includes("activeFilePath")
    )),
    true,
    "reference audit should identify matches that came from the active file path"
  );

  const projectStatusStore = createMemoryStore([
    {
      id: "mem-provider-check",
      key: "task:provider-check",
      kind: "task",
      scope: "project",
      text: "Agent Dock prompt provider validation is still pending.",
      confidence: 0.8,
      createdAt: Date.UTC(2026, 0, 8),
      updatedAt: Date.UTC(2026, 6, 4)
    },
    {
      id: "mem-prompt-check",
      key: "decision:prompt-check",
      kind: "decision",
      scope: "project",
      text: "检查 prompt 的最终内容时应报告最终构造区段。",
      confidence: 0.8,
      createdAt: Date.UTC(2026, 0, 9),
      updatedAt: Date.UTC(2026, 6, 4)
    }
  ]);
  const promptResults = await projectStatusStore.getRelevantMemories("检查 prompt 的最终内容", settings, {
    workingDirectory: "/Users/example/Agent Dock"
  });
  assert.deepEqual(
    promptResults.map((memory) => memory.id),
    ["mem-prompt-check"],
    "working-directory matches alone should not inject unrelated project status"
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

async function testCaptureAuditReason() {
  const adapter = new MemoryAdapter();
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
  }, {
    extractor: {
      extractTurn() {
        return [{
          kind: "preference",
          scope: "user",
          text: "User prefers compact audit panels",
          confidence: 0.82,
          source: "auto"
        }];
      }
    }
  });

  const saved = await store.captureTurn({ sessionId: "audit-session" }, {
    memoryEnabled: true,
    memoryAutoCapture: true
  });
  assert.equal(saved.length, 1, "memory capture should save the injected candidate");
  assert.equal(
    saved[0].updateAudit.reasonCode,
    "local_rule_capture",
    "captured memories should carry update audit metadata"
  );

  const aiStore = new MemoryStore({
    manifest: {
      dir: "agent-dock-ai",
      id: "agent-dock-ai"
    },
    app: {
      vault: {
        adapter: new MemoryAdapter()
      }
    }
  }, {
    extractor: {
      extractTurn() {
        return [{
          kind: "decision",
          scope: "project",
          text: "Use normalized agent events",
          confidence: 0.68,
          source: "ai"
        }];
      }
    }
  });
  const aiSaved = await aiStore.captureTurn({ sessionId: "ai-audit-session" }, {
    memoryEnabled: true,
    memoryAutoCapture: true
  });
  assert.equal(aiSaved[0].source, "ai", "AI signal provenance should be persisted");
  assert.equal(
    aiSaved[0].updateAudit.reasonCode,
    "ai_signal_capture",
    "AI-proposed ordinary memories should have a distinct audit reason"
  );
}

async function testEventRelationshipsStayScoped() {
  const settings = {
    memoryEnabled: true,
    memoryAutoCapture: true,
    memoryMaxItems: 200
  };
  const store = createMemoryStore([]);
  await store.captureTurn({
    prompt: "计划修复登录模块的严重 bug",
    response: "好的，我会先定位登录模块并完成必要的修复和回归测试。",
    observedAt: Date.UTC(2026, 6, 10, 9)
  }, settings);
  await store.captureTurn({
    prompt: "已经完成记忆系统的完整测试",
    response: "记忆系统的测试已经完成，相关结果也已经检查完毕。",
    observedAt: Date.UTC(2026, 6, 10, 10)
  }, settings);
  const taskItems = (await store.loadMemory()).items.filter((item) => item.kind === "task");
  assert.equal(taskItems.length, 2);
  assert.notEqual(taskItems[0].event.id, taskItems[1].event.id, "generic work topics must not merge unrelated tasks");
  assert.equal(taskItems[0].status, "active", "an unrelated completed task must not supersede the earlier task");

  const commuteStore = createMemoryStore([]);
  for (const [prompt, observedAt] of [
    ["准备下班", new Date(2026, 6, 10, 17).getTime()],
    ["离开公司", new Date(2026, 6, 10, 18).getTime()],
    ["到家", new Date(2026, 6, 10, 19).getTime()]
  ]) {
    await commuteStore.captureTurn({ prompt, response: "收到。", observedAt }, settings);
  }
  const commuteItems = (await commuteStore.loadMemory()).items
    .filter((item) => item.event?.topic === "commute_home")
    .sort((left, right) => left.event.sequence - right.event.sequence);
  assert.deepEqual(commuteItems.map((item) => item.event.sequence), [1, 2, 3]);
  assert.equal(new Set(commuteItems.map((item) => item.event.id)).size, 1, "same-day commute updates should share an event id");

  await commuteStore.captureTurn({
    prompt: "准备下班",
    response: "收到。",
    observedAt: new Date(2026, 6, 11, 17).getTime()
  }, settings);
  const nextDay = (await commuteStore.loadMemory()).items
    .filter((item) => item.event?.topic === "commute_home")
    .find((item) => item.event.instanceKey.endsWith("2026-07-11"));
  assert(nextDay, "the next-day commute should create another event instance");
  assert.notEqual(nextDay.event.id, commuteItems[0].event.id);
}

async function testUnreadableMemoryIsWriteProtected() {
  const memoryPath = "agent-dock/.agent-dock-local/memory/memory.json";
  const adapter = new MemoryAdapter({ [memoryPath]: "{broken json" });
  const store = new MemoryStore({
    manifest: { dir: "agent-dock", id: "agent-dock" },
    app: { vault: { adapter } }
  }, {
    extractor: {
      extractTurn() {
        return [{ kind: "decision", scope: "project", text: "Use protected writes", confidence: 0.8 }];
      }
    }
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  const loaded = await store.loadMemory();
  console.warn = originalWarn;
  assert.deepEqual(loaded.items, [], "unreadable memory should degrade to an empty in-memory view");
  await assert.rejects(() => store.captureTurn({}, {
    memoryEnabled: true,
    memoryAutoCapture: true
  }), /write-protected/);
  assert.equal(adapter.files.get(memoryPath), "{broken json", "capture must not overwrite an unreadable memory file");
}

async function testClearMemoryFailurePropagates() {
  const memoryPath = "agent-dock/.agent-dock-local/memory/memory.json";
  class FailingRemoveAdapter extends MemoryAdapter {
    async remove() {
      throw new Error("remove denied");
    }
  }
  const adapter = new FailingRemoveAdapter({ [memoryPath]: JSON.stringify({ version: 2, items: [] }) });
  const store = new MemoryStore({
    manifest: { dir: "agent-dock", id: "agent-dock" },
    app: { vault: { adapter } }
  });
  await assert.rejects(() => store.clearMemory(), /remove denied/);
  assert.equal(adapter.files.has(memoryPath), true, "failed deletion must preserve the existing file");
}

testSearchMemories().then(() => {
  return testExplicitMemorySearchSurvivesCompression();
}).then(() => {
  return testLegacyMemoryPathFallback();
}).then(() => {
  return testCaptureAuditReason();
}).then(() => {
  return testEventRelationshipsStayScoped();
}).then(() => {
  return testUnreadableMemoryIsWriteProtected();
}).then(() => {
  return testClearMemoryFailurePropagates();
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

{
  const settings = { language: "zh" };
  const createdAt = new Date(2026, 6, 8, 12).getTime();
  const updatedAt = new Date(2026, 6, 9, 12).getTime();
  const timezoneBoundary = Date.UTC(2026, 6, 8, 16, 30);
  assert.equal(
    formatAuditDate(timezoneBoundary, { timeZone: "Asia/Shanghai" }),
    "2026-07-09",
    "audit dates should follow the user's calendar day rather than UTC"
  );
  assert.equal(
    formatAuditDate(timezoneBoundary, { timeZone: "America/Los_Angeles" }),
    "2026-07-08",
    "audit date formatting should remain deterministic across time zones"
  );
  const memoryItems = buildMemoryUpdateAuditItems([{
    kind: "decision",
    scope: "project",
    text: "统一审计日期",
    confidence: 0.8,
    createdAt,
    updatedAt
  }], settings, "codex", t);
  const memoryFields = Object.fromEntries(memoryItems[0].fields.map((field) => [field.label, field.value]));
  assert.equal(memoryFields["创建日期"], "2026-07-08", "ordinary memory audit should show its creation date");
  assert.equal(memoryFields["更新日期"], "2026-07-09", "ordinary memory audit should show its update date");

  const deepItems = buildDeepMemoryAuditItems([{
    kind: "repair",
    summary: "一次重要校准",
    whyItMatters: "这次修复能帮助之后更稳地协作。",
    importance: 0.82,
    confidence: 0.74,
    createdAt,
    updatedAt
  }], settings, "codex", t);
  assert.equal(deepItems[0].fields[0].label, "原因", "deep memory audit should lead with reason");
  assert.equal(deepItems[0].fields[1].label, "来源", "deep memory audit should show source after reason");
  assert.match(deepItems[0].fields[0].value, /这次修复/);
  const deepFields = Object.fromEntries(deepItems[0].fields.map((field) => [field.label, field.value]));
  assert.equal(deepFields["创建日期"], "2026-07-08", "deep memory audit should show its creation date");
  assert.equal(deepFields["更新日期"], "2026-07-09", "deep memory audit should show its update date");

  const interactionItems = buildInteractionMemoryAuditItems({
    closedEpisodes: [{
      context: "review",
      phase: "repair",
      userExcerpt: "这里不对",
      assistantExcerpt: "我来修",
      reaction: { excerpt: "好了" },
      memoryRole: "pattern_evidence",
      eventWeight: 0.62,
      createdAt,
      updatedAt
    }],
    updatedPatterns: [{
      summary: "用户希望先看风险",
      evidenceCount: 2,
      confidence: 0.61,
      strength: 0.53,
      createdAt,
      updatedAt
    }],
    updatedTensions: [],
    updatedStableImpressions: []
  }, settings, "codex", t);
  assert.equal(interactionItems[0].fields[0].label, "原因", "interaction episode audit should lead with reason");
  assert.equal(interactionItems[0].fields[1].label, "来源", "interaction episode audit should show source after reason");
  assert.equal(interactionItems[1].fields[0].label, "原因", "interaction change audit should lead with reason");
  assert.equal(interactionItems[1].fields[1].label, "来源", "interaction change audit should show source after reason");
  const episodeFields = Object.fromEntries(interactionItems[0].fields.map((field) => [field.label, field.value]));
  const patternFields = Object.fromEntries(interactionItems[1].fields.map((field) => [field.label, field.value]));
  assert.equal(episodeFields["创建日期"], "2026-07-08", "interaction episode audit should show its creation date");
  assert.equal(episodeFields["更新日期"], "2026-07-09", "interaction episode audit should show its update date");
  assert.equal(patternFields["创建日期"], "2026-07-08", "derived interaction audit should show its creation date");
  assert.equal(patternFields["更新日期"], "2026-07-09", "derived interaction audit should show its update date");

  const topicShiftItems = buildInteractionMemoryAuditItems({
    closedEpisodes: [{
      id: "episode-topic-shift",
      context: "general",
      phase: "implementation",
      userExcerpt: "我今天都和你聊了什么？",
      assistantExcerpt: "正在查今天的对话记录。",
      reaction: {
        kind: "topic_shift",
        outcomeHint: "topic_shift",
        excerpt: "hello",
        signals: []
      },
      outcomeHint: "topic_shift",
      aiReflectionContribution: {
        source: "ai_outcome_reflection",
        summary: "助手采用了独立判断并解释依据。",
        shapes: ["independent_judgment"],
        confidence: 0.6,
        weight: 0.048,
        validation: "grounded_visible_evidence",
        patternCandidate: {
          key: "decide_with_visible_tradeoffs",
          axis: "decision_style",
          evidenceQuote: "我今天都和你聊了什么？",
          summary: "相似决策中先给建议，再公开取舍。",
          confidence: 0.6,
          evidenceOrigin: "user_message"
        }
      },
      memoryRole: "short_term_episode",
      eventWeight: 0.12
    }],
    updatedPatterns: [],
    updatedTensions: [],
    updatedStableImpressions: [],
    patternCandidateUpdates: [{
      episodeId: "episode-topic-shift",
      key: "decide_with_visible_tradeoffs",
      axis: "decision_style",
      summary: "相似决策中先给建议，再公开取舍。",
      evidenceQuote: "我今天都和你聊了什么？",
      evidenceCount: 0,
      minEvidence: 2,
      status: "rejected",
      reason: "follow_up_not_supportive"
    }]
  }, settings, "codex", t);
  const topicShiftFields = Object.fromEntries(topicShiftItems[0].fields.map((field) => [field.label, field.value]));
  assert.match(topicShiftFields["原因"], /下一条用户消息/, "episode audit should explain why the later message closed the previous turn");
  assert.match(topicShiftFields["原因"], /被关闭的上一轮/, "episode audit should clarify what context and phase describe");
  assert.match(topicShiftFields["反应判定"], /topic_shift/, "episode audit should expose the local reaction classification");
  assert.match(topicShiftFields["反应判定"], /没有识别到明确反馈/, "episode audit should explain the reaction classification");
  assert.match(topicShiftFields["AI 反思贡献"], /通过可见证据校验/, "episode audit should show that the AI outcome contribution passed local validation");
  assert.match(topicShiftFields["AI 反思贡献"], /independent_judgment/, "episode audit should show contributed assistant shapes");
  assert.match(topicShiftFields["AI 反思贡献"], /\+0\.05/, "episode audit should show the bounded AI weight contribution");
  assert.match(topicShiftFields["长期模式候选状态"], /未提供支持证据/, "episode audit should explain why an AI pattern nomination was rejected");
  assert.match(topicShiftFields["长期模式候选状态"], /decide_with_visible_tradeoffs/, "episode audit should identify the nominated candidate key");
  assert.match(topicShiftItems[0].source, /AI outcome 反思/, "episode audit source should include validated AI reflection provenance");
  assert.match(topicShiftFields["实际影响"], /没有更新模式、张力或稳定印象/, "low-weight episode audit should state that no derived memory changed");
  assert.match(topicShiftFields["实际影响"], /不会直接注入后续提示词/, "low-weight episode audit should state that the episode is not directly prompted");

  const interactionSummary = formatInteractionMemoryUpdateSummary(settings, "codex", t, {
    closedEpisodes: [{
      context: "review",
      phase: "repair",
      userExcerpt: "这里不对",
      reaction: { excerpt: "好了" }
    }],
    updatedPatterns: [{
      summary: "用户希望先看风险",
      evidenceCount: 2
    }],
    updatedTensions: [],
    updatedStableImpressions: []
  });
  assert.match(interactionSummary, /本轮关闭/, "interaction summary should include closed episode context");
  assert.match(interactionSummary, /影响到的经验/, "interaction summary should include affected experience when present");
  assert.match(interactionSummary, /这里不对/, "interaction summary should include the closed episode user excerpt");
  assert.match(interactionSummary, /好了/, "interaction summary should include the closed episode reaction");
  assert.match(interactionSummary, /用户希望先看风险/, "interaction summary should include the affected experience content");
  assert.match(interactionSummary, /2 条证据/, "interaction summary should include the affected experience evidence count");

  const unchangedInteractionSummary = formatInteractionMemoryUpdateSummary(settings, "codex", t, {
    closedEpisodes: [{ userExcerpt: "上一轮", reaction: { excerpt: "hello" } }],
    updatedPatterns: [],
    updatedTensions: [],
    updatedStableImpressions: []
  });
  assert.match(unchangedInteractionSummary, /没有更新模式、张力或稳定印象/, "interaction summary should distinguish episode storage from derived-memory changes");
  assert.equal(
    formatInteractionMemoryUpdateKind({
      updatedPatterns: [],
      updatedTensions: [],
      updatedStableImpressions: []
    }),
    "activity",
    "episode-only interaction updates should be debug activity"
  );
  assert.equal(
    formatInteractionMemoryUpdateKind({
      updatedPatterns: [{ id: "pattern-1" }],
      updatedTensions: [],
      updatedStableImpressions: []
    }),
    "notice",
    "derived interaction changes should remain visible notices"
  );
  assert.equal(
    formatInteractionMemoryUpdateTitle(settings, "codex", t, {
      updatedPatterns: [],
      updatedTensions: [],
      updatedStableImpressions: []
    }),
    "互动 episode 已处理",
    "interaction notice title should not claim derived memory changed when only an episode closed"
  );
  assert.equal(
    formatInteractionMemoryUpdateTitle(settings, "codex", t, {
      updatedPatterns: [{ id: "pattern-1" }],
      updatedTensions: [],
      updatedStableImpressions: []
    }),
    "互动经验已更新",
    "interaction notice title should identify real derived-memory changes"
  );
}
