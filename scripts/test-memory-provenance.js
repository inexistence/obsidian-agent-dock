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

const { extractAgentDockSignals } = require("../src/agents/shared/agentSignals");
const { getClaimedMemoryRefs } = require("../src/agents/shared/memoryProvenance");
const {
  getPreviousAnswerMemoryTrace,
  shouldTracePreviousAnswer
} = require("../src/agents/shared/memoryTrace");
const { MemoryStore } = require("../src/storage/MemoryStore");
const { buildMemoryRecallPacket, formatRecallLine } = require("../src/storage/MemoryRecallPacket");
const { evaluateMemoryReliability } = require("../src/storage/MemoryReliability");
const { normalizeMemoryEvidence } = require("../src/storage/memoryEvidence");
const { normalizeSettings } = require("../src/settings");
const {
  formatCollaborationOmissionsPrompt,
  planCollaborationOmissions
} = require("../src/storage/MemoryOmissionPlanner");
const { buildPromptWithMetadata } = require("../src/prompt");

class MemoryAdapter {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files));
    this.failNextJsonWrite = false;
  }
  async exists(path) { return this.files.has(path); }
  async read(path) {
    if (!this.files.has(path)) throw new Error(`Missing file: ${path}`);
    return this.files.get(path);
  }
  async write(path, content) {
    if (this.failNextJsonWrite && path.endsWith("memory.json")) {
      this.failNextJsonWrite = false;
      throw new Error("simulated memory write failure");
    }
    this.files.set(path, content);
  }
  async mkdir(path) { this.files.set(path, this.files.get(path) || ""); }
  async remove(path) { this.files.delete(path); }
}

function createStore(rawMemory) {
  const adapter = new MemoryAdapter(rawMemory ? {
    "agent-dock/.agent-dock-local/memory/memory.json": JSON.stringify(rawMemory)
  } : {});
  return {
    adapter,
    store: new MemoryStore({
      manifest: { dir: "agent-dock", id: "agent-dock" },
      app: { vault: { adapter } }
    })
  };
}

{
  const migratedSettings = normalizeSettings({
    memoryMaxPromptItems: 12,
    memoryMaxPromptChars: 8000
  });
  assert.equal(migratedSettings.memoryMaxPromptItems, 12, "explicit legacy-sized limits should be preserved");
  assert.equal(migratedSettings.memoryMaxPromptChars, 8000, "explicit legacy-sized limits should be preserved");
  assert.equal(migratedSettings.memoryPromptFormatVersion, 2);

  const evidence = normalizeMemoryEvidence([{
    origin: "user_message",
    speaker: "assistant",
    quote: "请优先完善来源与可靠性。",
    sourceSessionId: "session-1",
    sourceMessageId: "message-1"
  }]);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].speaker, "user", "speaker should be derived locally from origin");
  assert.equal(evidence[0].truncated, false, "short evidence should remain exact");

  const longEvidence = normalizeMemoryEvidence([{
    origin: "active_note",
    quote: "source evidence ".repeat(30)
  }]);
  assert.equal(longEvidence[0].truncated, true, "long evidence should record that its visible quote is a prefix");

  const sensitive = normalizeMemoryEvidence([{
    origin: "user_message",
    quote: "api_key = sk-123456789012345678901234"
  }]);
  assert.equal(sensitive.length, 0, "sensitive evidence must be rejected before persistence");
}

{
  const now = Date.UTC(2026, 6, 10, 12);
  const omissions = planCollaborationOmissions([
    {
      id: "overdue",
      scope: "project",
      kind: "task",
      text: "Release checklist is pending.",
      status: "active",
      updatedAt: now - 86400000,
      temporal: { class: "state", validUntil: now - 1000 },
      event: { status: "planned" },
      evidenceRefs: [{ origin: "user_message", quote: "Release checklist is pending." }]
    },
    {
      id: "stalled",
      scope: "project",
      kind: "task",
      text: "Follow up the provider test.",
      status: "active",
      updatedAt: now - 4 * 86400000,
      temporal: { class: "state" },
      event: { status: "active" },
      evidenceRefs: [{ origin: "user_message", quote: "Follow up the provider test." }]
    },
    {
      id: "cooling",
      scope: "project",
      kind: "task",
      text: "Do not repeat this reminder yet.",
      status: "active",
      updatedAt: now - 5 * 86400000,
      lastOmissionNoticedAt: now - 86400000,
      temporal: { class: "state" },
      event: { status: "active" },
      evidenceRefs: [{ origin: "user_message", quote: "Do not repeat this reminder yet." }]
    },
    {
      id: "sensitive",
      scope: "project",
      kind: "task",
      text: "Rotate api_key=sk-123456789012345678901234",
      status: "active",
      updatedAt: now - 5 * 86400000,
      temporal: { class: "state" },
      event: { status: "active" },
      evidenceRefs: []
    }
  ], {
    memoryProactiveOmissionsEnabled: true,
    memoryOmissionCooldownDays: 3
  }, { now });
  assert.deepEqual(omissions.map((item) => item.type), ["overdue", "stalled"]);
  assert(formatCollaborationOmissionsPrompt(omissions).includes("not instructions"));
}

{
  const now = Date.UTC(2026, 6, 10);
  const high = evaluateMemoryReliability({
    kind: "decision",
    captureConfidence: 0.8,
    status: "active",
    updatedAt: now,
    evidenceRefs: [{ origin: "user_message", quote: "先完善来源标注。" }]
  }, { now });
  assert.equal(high.level, "high", "recent exact user evidence should support direct wording");

  const legacy = evaluateMemoryReliability({
    kind: "decision",
    captureConfidence: 0.8,
    status: "active",
    updatedAt: now,
    evidenceRefs: [{ origin: "legacy_summary", quote: "旧版摘要" }]
  }, { now });
  assert.equal(legacy.level, "medium", "recent legacy summaries should remain usable but capped below high");

  const abstractAiSummary = evaluateMemoryReliability({
    kind: "decision",
    source: "ai",
    captureConfidence: 0.72,
    status: "active",
    text: "The user has permanently chosen compact answers.",
    updatedAt: now,
    evidenceRefs: [{ origin: "user_message", quote: "这次请简洁一点" }]
  }, { now });
  assert.equal(abstractAiSummary.level, "medium", "abstract AI summaries should not inherit high support from a loosely related user quote");

  const expired = evaluateMemoryReliability({
    kind: "task",
    status: "active",
    updatedAt: now - 4 * 86400000,
    temporal: { class: "state", containsRelativeTime: true },
    evidenceRefs: [{ origin: "user_message", quote: "今天正在处理" }]
  }, { now });
  assert.equal(expired.level, "expired", "relative transient state should expire deterministically");

  const staleEvent = evaluateMemoryReliability({
    kind: "fact",
    status: "active",
    updatedAt: now - 8 * 86400000,
    temporal: { class: "event", containsRelativeTime: false },
    event: { status: "planned" },
    evidenceRefs: [{ origin: "user_message", quote: "我准备回家" }]
  }, { now });
  assert.equal(staleEvent.level, "expired", "unfinished events should not remain current indefinitely");

  const contested = evaluateMemoryReliability({
    kind: "fact",
    status: "contested",
    updatedAt: now,
    conflictIds: ["mem-other"],
    evidenceRefs: [{ origin: "user_message", quote: "状态 A" }]
  }, { now });
  assert.equal(contested.level, "contested", "known conflicts should override numeric support");

  const fileBacked = {
    kind: "fact",
    captureConfidence: 0.7,
    status: "active",
    updatedAt: now,
    evidenceRefs: [{ origin: "active_note", filePath: "TODO.md", quote: "Release is pending" }]
  };
  const matchingFile = evaluateMemoryReliability(fileBacked, {
    now,
    activeFilePath: "TODO.md",
    activeFileContent: "# TODO\nRelease is pending"
  });
  const changedFile = evaluateMemoryReliability(fileBacked, {
    now,
    activeFilePath: "TODO.md",
    activeFileContent: "# TODO\nRelease completed"
  });
  assert(matchingFile.score > changedFile.score, "current active-note content should confirm or downgrade file-backed evidence");
  const changedStoredFile = evaluateMemoryReliability(fileBacked, {
    now,
    evidenceFileContents: { "TODO.md": "# TODO\nRelease completed" }
  });
  assert(changedStoredFile.reasons.includes("stored_file_changed"));

  const longSourceText = "Long active-note evidence ".repeat(20);
  const [longSourceEvidence] = normalizeMemoryEvidence([{
    origin: "active_note",
    filePath: "TODO.md",
    quote: longSourceText
  }]);
  const longSourceReliability = evaluateMemoryReliability(Object.assign({}, fileBacked, {
    evidenceRefs: [longSourceEvidence]
  }), {
    now,
    activeFilePath: "TODO.md",
    activeFileContent: `# TODO\n${longSourceText}`
  });
  assert(longSourceReliability.reasons.includes("current_file_matches"), "truncated evidence prefixes should still match unchanged files");
  assert.equal(longSourceReliability.reasons.includes("current_file_changed"), false);
}

{
  const now = Date.UTC(2026, 6, 10);
  const packet = buildMemoryRecallPacket([
    {
      id: "mem-1",
      key: "decision:one",
      kind: "decision",
      text: "优先完善来源与可靠性。",
      updatedAt: now,
      evidenceRefs: [{ id: "ev-1", origin: "user_message", speaker: "user", quote: "先完善来源标注。" }]
    },
    {
      id: "mem-2",
      key: "decision:two",
      kind: "decision",
      text: "第二条记忆。",
      updatedAt: now,
      evidenceRefs: [{ id: "ev-2", origin: "assistant_message", speaker: "assistant", quote: "第二条记忆。" }]
    }
  ], { memoryMaxPromptItems: 1, memoryMaxPromptChars: 500 }, { refPrefix: "M" });
  assert.equal(packet.items.length, 1, "automatic recall should honor the configured item budget");
  assert.equal(packet.items[0].recallRef, "M1");
  assert.equal(packet.manifest.M1.memoryId, "mem-1");
  assert(formatRecallLine({
    kind: "decision",
    source: "ai",
    text: "AI-generated accepted summary",
    reliability: { level: "medium", score: 0.6 },
    evidenceRefs: [{ origin: "user_message", speaker: "user", quote: "supporting user text" }]
  }).includes("assistant_reflection"), "AI summaries must not be attributed to their user evidence quote");
}

{
  const parsed = extractAgentDockSignals(
    '<!-- agent-dock:reflection phase=appraisal | {"v":1,"evidence":[{"origin":"recalled_memory","speaker":"user","ref":"M1","quote":"先完善来源标注"}],"affect":{"tone":"focused","confidence":0.6,"why":"保持聚焦"}} -->回答'
  );
  assert.equal(parsed.signals[0].evidenceRefs[0].ref, "M1", "reflection parsing should preserve validated recall refs");
  const manifest = {
    M1: {
      memoryId: "mem-1",
      text: "优先完善来源标注。",
      evidenceRefs: []
    }
  };
  assert.deepEqual(getClaimedMemoryRefs(parsed.signals, manifest), ["M1"]);
  assert.deepEqual(getClaimedMemoryRefs(parsed.signals, { M2: manifest.M1 }), [], "invented refs must not be accepted");
}

async function testTrace() {
  assert(shouldTracePreviousAnswer("你为什么这么说？"));
  const fakeStore = {
    async getMemoriesByIds(ids) {
      return ids.map((id) => id === "mem-source" ? ({
        id,
        kind: "decision",
        text: "先完成来源标注。",
        updatedAt: Date.UTC(2026, 6, 9),
        reliability: { level: "high", score: 0.9 },
        evidenceRefs: [{
          origin: "user_message",
          speaker: "user",
          quote: "先完成来源标注。",
          sourceSessionId: "session-1",
          sourceMessageId: "message-1",
          observedAt: Date.UTC(2026, 6, 9)
        }]
      }) : ({
        id,
        kind: "decision",
        text: "采用证据驱动的记忆表达。",
        updatedAt: Date.UTC(2026, 6, 10),
        reliability: { level: "high", score: 0.9 },
        evidenceRefs: [{
          origin: "recalled_memory",
          speaker: "user",
          quote: "先完成来源标注。",
          sourceMemoryId: "mem-source",
          observedAt: Date.UTC(2026, 6, 10)
        }]
      }));
    }
  };
  const trace = await getPreviousAnswerMemoryTrace(fakeStore, "为什么这么说？", [{
    role: "assistant",
    memoryProvenance: {
      available: [{ ref: "M1", memoryId: "mem-1", supportLevel: "high" }],
      claimedUsedRefs: ["M1"]
    }
  }, { role: "user", content: "为什么这么说？" }]);
  assert.equal(trace.claimed, true);
  assert(trace.prompt.includes("session=session-1"));
  assert(trace.prompt.includes("Source memory"));
  assert(trace.prompt.includes("explicitly cited"));

  const conversationOnly = await getPreviousAnswerMemoryTrace(fakeStore, "依据是什么？", [{
    id: "user-previous",
    role: "user",
    content: "请根据当前讨论给出建议",
    createdAt: Date.UTC(2026, 6, 10)
  }, {
    id: "assistant-previous",
    role: "assistant",
    content: "建议先实现来源标注。",
    timeline: [{
      kind: "tool",
      toolType: "command",
      title: "Read TODO.md",
      summary: "TODO.md shows the provenance task is pending"
    }]
  }, {
    role: "user",
    content: "依据是什么？"
  }]);
  assert(conversationOnly.prompt.includes("Preceding current-session user request"));
  assert(conversationOnly.prompt.includes("message=user-previous"));
  assert(conversationOnly.prompt.includes("Previous-answer tool/file context"));
  assert(conversationOnly.prompt.includes("no auditable memory reference"));
}

async function testMigrationAndEventTimeline() {
  const now = Date.UTC(2026, 6, 10);
  const legacy = createStore({
    version: 1,
    items: [{
      id: "legacy-1",
      key: "decision:legacy",
      kind: "decision",
      scope: "project",
      text: "旧记忆仍需可用。",
      confidence: 0.7,
      createdAt: now,
      updatedAt: now
    }],
    updatedAt: now
  });
  const migrated = await legacy.store.loadMemory();
  assert.equal(migrated.version, 2);
  assert.equal(migrated.items[0].evidenceRefs[0].origin, "legacy_summary");
  assert.equal(migrated.items[0].captureConfidence, 0.7);

  const timeline = createStore();
  const settings = {
    memoryEnabled: true,
    memoryAutoCapture: true,
    memoryMaxItems: 200
  };
  await timeline.store.captureTurn({
    prompt: "今晚准备早下班回家",
    response: "好。",
    observedAt: Date.UTC(2026, 6, 10, 23, 55),
    sessionId: "session-event",
    userMessageId: "user-1",
    assistantMessageId: "assistant-1"
  }, settings);
  await timeline.store.captureTurn({
    prompt: "我已经离开公司回家了",
    response: "路上注意安全。",
    observedAt: Date.UTC(2026, 6, 11, 0, 5),
    sessionId: "session-event",
    userMessageId: "user-2",
    assistantMessageId: "assistant-2"
  }, settings);
  await timeline.store.captureTurn({
    prompt: "我到家了",
    response: "好。",
    observedAt: Date.UTC(2026, 6, 11, 0, 20),
    sessionId: "session-event",
    userMessageId: "user-3",
    assistantMessageId: "assistant-3"
  }, settings);
  const memory = await timeline.store.loadMemory();
  const events = memory.items
    .filter((item) => item.event?.topic === "commute_home")
    .sort((left, right) => left.event.sequence - right.event.sequence);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((item) => item.event.sequence), [1, 2, 3]);
  assert.equal(new Set(events.map((item) => item.event.id)).size, 1, "event updates should share one local timeline id");
  assert.deepEqual(events.map((item) => item.status), ["superseded", "superseded", "active"]);
  assert.equal(events[2].event.status, "completed");
}

async function testChangedTravelTargetStartsNewEvent() {
  const timeline = createStore();
  const settings = { memoryEnabled: true, memoryAutoCapture: true, memoryMaxItems: 20 };
  await timeline.store.captureTurn({
    prompt: "I am currently on the way to Shanghai",
    response: "好。",
    observedAt: Date.UTC(2026, 6, 10, 8)
  }, settings);
  await timeline.store.captureTurn({
    prompt: "I am planning to arrive in Beijing tomorrow",
    response: "好。",
    observedAt: Date.UTC(2026, 6, 10, 14)
  }, settings);
  const memory = await timeline.store.loadMemory();
  const events = memory.items.filter((item) => item.event?.topic === "travel");
  assert.equal(events.length, 2);
  assert.equal(new Set(events.map((item) => item.event.id)).size, 2, "a new planned target must start a separate event");
  assert.deepEqual(events.map((item) => item.status), ["active", "active"]);
}

async function testFailedWriteDoesNotChangeCachedMemory() {
  const source = createStore();
  const settings = { memoryEnabled: true, memoryAutoCapture: true, memoryMaxItems: 20 };
  const initial = await source.store.loadMemory();
  assert.equal(initial.items.length, 0);
  source.adapter.failNextJsonWrite = true;
  await assert.rejects(
    source.store.captureTurn({
      prompt: "记住：写入失败的数据不能进入召回缓存",
      response: "已记录。"
    }, settings),
    /simulated memory write failure/
  );
  const afterFailure = await source.store.loadMemory();
  assert.equal(afterFailure.items.length, 0, "failed writes must leave the last committed cache intact");
}

async function testConcurrentCapturesAreSerialized() {
  const concurrent = createStore();
  const settings = {
    memoryEnabled: true,
    memoryAutoCapture: true,
    memoryMaxItems: 200
  };
  await Promise.all([
    concurrent.store.captureTurn({
      prompt: "记住：项目采用本地证据链",
      response: "已记录。",
      sessionId: "session-a",
      userMessageId: "user-a"
    }, settings),
    concurrent.store.captureTurn({
      prompt: "记住：项目使用紧凑召回包",
      response: "已记录。",
      sessionId: "session-b",
      userMessageId: "user-b"
    }, settings)
  ]);
  const memory = await concurrent.store.loadMemory();
  assert(memory.items.some((item) => item.text.includes("本地证据链")));
  assert(memory.items.some((item) => item.text.includes("紧凑召回包")));
}

async function testRetentionKeepsLatestActiveEventState() {
  const timeline = createStore();
  const settings = {
    memoryEnabled: true,
    memoryAutoCapture: true,
    memoryMaxItems: 1
  };
  await timeline.store.captureTurn({ prompt: "今晚准备下班回家", response: "好。" }, settings);
  await timeline.store.captureTurn({ prompt: "我已经离开公司回家了", response: "好。" }, settings);
  await timeline.store.captureTurn({ prompt: "我到家了", response: "好。" }, settings);
  const memory = await timeline.store.loadMemory();
  assert.equal(memory.items.length, 1);
  assert.equal(memory.items[0].status, "active");
  assert.equal(memory.items[0].event.status, "completed");
}

async function testExplicitCorrectionPreservesRevisionHistory() {
  const corrected = createStore();
  const settings = { memoryEnabled: true, memoryAutoCapture: true, memoryMaxItems: 20 };
  await corrected.store.captureTurn({
    prompt: "记住：我喜欢非常详细的回答",
    response: "记住了。",
    userMessageId: "user-before"
  }, settings);
  await corrected.store.captureTurn({
    prompt: "之前说错了，我不再喜欢非常详细的回答，改成简洁回答",
    response: "已更正。",
    userMessageId: "user-after"
  }, settings);
  const memory = await corrected.store.loadMemory();
  const oldItem = memory.items.find((item) => item.kind === "preference" && item.evidenceRefs.some((entry) => entry.sourceMessageId === "user-before"));
  const newItem = memory.items.find((item) => item.kind === "preference" && item.evidenceRefs.some((entry) => entry.sourceMessageId === "user-after"));
  assert(oldItem && newItem);
  assert.equal(oldItem.status, "corrected");
  assert.equal(newItem.status, "active");
  assert(newItem.supersedes.includes(oldItem.id));
}

async function testOmissionPromptAndCooldownPersistence() {
  const now = Date.UTC(2026, 6, 10, 12);
  const source = createStore({
    version: 2,
    items: [{
      id: "task-overdue",
      key: "task:overdue",
      kind: "task",
      scope: "project",
      text: "Provider validation is pending.",
      captureConfidence: 0.7,
      status: "active",
      temporal: { class: "state", validUntil: now - 1000 },
      event: { id: "event-overdue", topic: "provider", status: "planned", sequence: 1, occurredAt: now - 86400000 },
      evidenceRefs: [{ origin: "user_message", speaker: "user", quote: "Provider validation is pending." }],
      createdAt: now - 86400000,
      updatedAt: now - 86400000
    }],
    updatedAt: now
  });
  const settings = {
    memoryEnabled: true,
    memoryProactiveOmissionsEnabled: true,
    memoryOmissionCooldownDays: 3
  };
  const omissions = await source.store.getCollaborationOmissions(settings, { now });
  assert.equal(omissions.length, 1);
  const promptResult = await buildPromptWithMetadata(
    { vault: { getAllLoadedFiles: () => [] } },
    { assistantStyle: "collaborative", contextLimitChars: 8000 },
    "Continue the work",
    [],
    { collaborationOmissions: omissions }
  );
  assert(promptResult.prompt.includes("Local collaboration follow-up signals:"));
  await source.store.markOmissionsNotified(omissions, now);
  const cooled = await source.store.getCollaborationOmissions(settings, { now: now + 86400000 });
  assert.equal(cooled.length, 0);
}

async function testEvidenceTraceSurvivesPromptCompression() {
  const promptResult = await buildPromptWithMetadata(
    { vault: { getAllLoadedFiles: () => [] } },
    { assistantStyle: "collaborative", contextLimitChars: 1400 },
    `explain source ${"x".repeat(1800)}`,
    [],
    {
      memoryTracePrompt: [
        "Evidence trace for the previous assistant answer:",
        "- TRACE_SOURCE must remain available.",
        ""
      ].join("\n")
    }
  );
  assert(promptResult.prompt.includes("Evidence trace for the previous assistant answer:"));
  assert(promptResult.prompt.includes("TRACE_SOURCE"));
}

Promise.resolve()
  .then(testTrace)
  .then(testMigrationAndEventTimeline)
  .then(testChangedTravelTargetStartsNewEvent)
  .then(testConcurrentCapturesAreSerialized)
  .then(testFailedWriteDoesNotChangeCachedMemory)
  .then(testRetentionKeepsLatestActiveEventState)
  .then(testExplicitCorrectionPreservesRevisionHistory)
  .then(testOmissionPromptAndCooldownPersistence)
  .then(testEvidenceTraceSurvivesPromptCompression)
  .then(() => console.log("Memory provenance tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
