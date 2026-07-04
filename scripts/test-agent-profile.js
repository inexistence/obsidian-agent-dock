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

const { AgentProfileStore } = require("../src/profile/AgentProfileStore");
const { ProfileObservationExtractor } = require("../src/profile/ProfileObservationExtractor");
const {
  applyProfileObservations,
  getPromptTraits,
  shouldPersistObservation
} = require("../src/profile/ProfileTraitReducer");
const { buildPromptWithMetadata, formatAgentProfilePrompt } = require("../src/prompt");

const settings = {
  assistantStyle: "collaborative",
  contextLimitChars: 258000,
  agentProfileEnabled: true,
  agentProfileAutoCapture: true,
  agentProfileMaxPromptTraits: 6,
  agentProfileMinEvidence: 2,
  agentProfileHalfLifeDays: 30
};

class ProfileAdapter {
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

function createStore(files) {
  const adapter = new ProfileAdapter(files);
  return {
    adapter,
    store: new AgentProfileStore({
      manifest: {
        dir: "agent-dock",
        id: "agent-dock"
      },
      app: {
        vault: {
          adapter
        }
      }
    })
  };
}

{
  const extractor = new ProfileObservationExtractor();
  const observations = extractor.extractTurn({
    prompt: "你这些都只是加设置，那怎么能达到这个效果呢？",
    previousAssistantResponse: "可以加一个自然生长模式，在设置里提供开关和选项。",
    response: "光加设置达不到，需要行为塑形机制。",
    sessionId: "session-a"
  });

  assert(
    observations.some((item) => item.kind === "correction" && item.signal < 0 && /settings-centered/.test(item.behavior)),
    "settings-centered answers should be recognized as rejected when the user says it is only settings"
  );
  assert(
    observations.some((item) => item.axis === "decision_style" && item.signal > 0),
    "concrete mechanism requests should create a decision-style signal"
  );
}

{
  const extractor = new ProfileObservationExtractor();
  const observations = extractor.extractTurn({
    prompt: "你真蠢，闭嘴",
    previousAssistantResponse: "我会解释一下。",
    response: "我会保持稳定。"
  });
  const hostile = observations.find((item) => item.kind === "hostility");
  assert(hostile, "hostility should be recognized");
  assert.equal(hostile.durable, false, "hostility should not become durable profile evidence");
  assert.equal(shouldPersistObservation(hostile), false, "hostility must not persist into long-term traits");
}

{
  const now = Date.UTC(2026, 6, 4);
  const first = applyProfileObservations(null, [
    {
      kind: "request_shape",
      axis: "decision_style",
      context: "agent_continuity",
      behavior: "user pushed the discussion toward concrete mechanisms, implementation, or tasks",
      signal: 0.46,
      confidence: 0.7,
      evidenceText: "给出具体可实施的设计方案和任务",
      createdAt: now
    }
  ], settings, now);
  assert.equal(getPromptTraits(first.profile, settings, now).length, 0, "one observation should not be enough");

  const second = applyProfileObservations(first.profile, [
    {
      kind: "request_shape",
      axis: "decision_style",
      context: "agent_continuity",
      behavior: "user pushed the discussion toward concrete mechanisms, implementation, or tasks",
      signal: 0.46,
      confidence: 0.72,
      evidenceText: "那怎么识别/判断",
      createdAt: now + 1000
    }
  ], settings, now + 1000);
  const traits = getPromptTraits(second.profile, settings, now + 1000);
  assert.equal(traits.length, 1, "two observations should allow a stable tendency into prompt");
  assert(/concrete mechanisms/.test(traits[0].text), "trait text should describe behavior, not fixed personality");
}

{
  const now = Date.UTC(2026, 6, 4);
  const first = applyProfileObservations(null, [
    {
      kind: "correction",
      axis: "collaboration_style",
      context: "agent_continuity",
      behavior: "settings-centered framing was rejected or insufficient",
      signal: -0.7,
      confidence: 0.82,
      evidenceText: "你这些都只是加设置",
      createdAt: now
    }
  ], settings, now);
  const second = applyProfileObservations(first.profile, [
    {
      kind: "correction",
      axis: "collaboration_style",
      context: "agent_continuity",
      behavior: "settings-centered framing was rejected or insufficient",
      signal: -0.7,
      confidence: 0.82,
      evidenceText: "还是只是设置，没有机制",
      createdAt: now + 1000
    }
  ], settings, now + 1000);
  const traits = getPromptTraits(second.profile, settings, now + 1000);
  assert.equal(traits.length, 1, "repeated corrections should become an avoid/revise prompt trait");
  assert(/avoid or revise/.test(traits[0].text), "negative traits should retain avoid/revise direction");
}

{
  const prompt = formatAgentProfilePrompt([
    {
      axis: "decision_style",
      context: "agent_continuity",
      confidence: 0.7,
      text: "In agent continuity conversations, the assistant tends to be more useful when it explains mechanisms."
    }
  ]);
  assert(prompt.includes("Emergent agent profile:"), "profile prompt should be clearly labeled");
  assert(prompt.includes("not identity claims"), "profile prompt should include boundary language");
}

async function testStoreAndPrompt() {
  const { store } = createStore();
  await store.captureTurn({
    prompt: "Agent 连续性这个机制，给出具体可实施的设计方案和任务",
    previousAssistantResponse: "可以从设置项开始。",
    response: "下面是数据模型、流程和任务拆分。",
    sessionId: "session-a"
  }, settings);
  await store.captureTurn({
    prompt: "Agent 连续性里那怎么识别/判断，难道用文本匹配吗？",
    previousAssistantResponse: "方案包含 AgentProfileStore 和 reducer。",
    response: "第一版用本地 observation 规则。",
    sessionId: "session-a"
  }, settings);

  const traits = await store.getPromptTraits(settings);
  assert(traits.length > 0, "store should return prompt traits after repeated evidence");

  const result = await buildPromptWithMetadata(null, settings, "继续", [], {
    agentProfileTraits: traits
  });
  assert(result.prompt.includes("Emergent agent profile:"), "prompt should include profile traits");
  assert(result.prompt.includes("User request:"), "prompt should still include user request");

  await store.captureTurn({
    prompt: "谢谢，这个 token sk-secret1234567890 的方案很清楚",
    previousAssistantResponse: "我给了一个实现方案。",
    response: "收到。",
    sessionId: "session-b"
  }, settings);
  const profile = await store.loadProfile();
  const serialized = JSON.stringify(profile);
  assert(!serialized.includes("sk-secret1234567890"), "profile must not persist raw secret-like evidence");
  assert(serialized.includes("[Sensitive content omitted]"), "sensitive evidence should be redacted");
}

async function testConcurrentCaptures() {
  const { store } = createStore();
  await Promise.all([
    store.captureTurn({
      prompt: "Agent 连续性这个机制，给出具体可实施的设计方案和任务",
      previousAssistantResponse: "可以从设置项开始。",
      response: "下面是数据模型、流程和任务拆分。",
      sessionId: "session-a"
    }, settings),
    store.captureTurn({
      prompt: "你怎么看这个 agent profile 机制？给个结论",
      previousAssistantResponse: "可以继续讨论。",
      response: "我建议先做本地 observation。",
      sessionId: "session-b"
    }, settings)
  ]);

  const profile = await store.loadProfile();
  assert(
    profile.observations.some((item) => item.sourceSessionId === "session-a"),
    "concurrent profile capture should keep first session observation"
  );
  assert(
    profile.observations.some((item) => item.sourceSessionId === "session-b"),
    "concurrent profile capture should keep second session observation"
  );
}

testStoreAndPrompt()
  .then(testConcurrentCaptures)
  .then(() => {
    console.log("Agent profile tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
