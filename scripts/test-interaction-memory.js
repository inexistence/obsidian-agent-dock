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
  InteractionMemoryStore,
  MAX_PENDING_EPISODES
} = require("../src/interaction/InteractionMemoryStore");
const { formatInteractionStancePrompt } = require("../src/interaction/InteractionPromptFormatter");
const {
  buildPromptInteractionContext,
  _test: signalTest
} = require("../src/interaction/LocalSignalExtractor");
const {
  getPromptStance,
  applyEpisodes,
  scoreTension
} = require("../src/interaction/PatternReducer");
const { buildPromptWithMetadata } = require("../src/prompt");
const { normalizeSettings } = require("../src/settings");

const settings = {
  assistantStyle: "collaborative",
  contextLimitChars: 258000,
  interactionMemoryEnabled: true,
  interactionMemoryAutoCapture: true,
  interactionMemoryMaxPromptItems: 6,
  interactionMemoryMaxPersonaItems: 2,
  interactionMemoryMaxStanceItems: 4,
  interactionMemoryMinEvidence: 2,
  interactionMemoryHalfLifeDays: 30
};

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

function createStore(files) {
  const adapter = new MemoryAdapter(files);
  return {
    adapter,
    store: new InteractionMemoryStore({
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

async function testEpisodeClosureAndStance() {
  const now = Date.UTC(2026, 6, 9);
  const { store } = createStore();

  await store.captureTurn({
    prompt: "如果完全重新设计 interaction memory，机制应该怎么做？",
    response: "我会把它设计成 episode、pattern 和 stance，而不是硬偏好规则。",
    sessionId: "session-a",
    now
  }, settings);

  let memory = await store.loadMemory();
  assert.equal(memory.pendingEpisodes.length, 1, "first turn should create a pending episode");
  assert.equal(memory.episodes.length, 0, "first turn should not close an episode yet");

  await store.captureTurn({
    prompt: "这个 prompt 设计不要压成具体要求prompt，要保留微妙区别和不同风格",
    response: "那应该保留 tendencies、textures 和 tensions。",
    sessionId: "session-a",
    now: now + 1000
  }, settings);

  await store.captureTurn({
    prompt: "继续，这个 prompt 方案也要保留微妙区别，别压扁",
    response: "我会把长期人格和本轮 stance 分开。",
    sessionId: "session-a",
    now: now + 2000
  }, settings);

  await store.captureTurn({
    prompt: "继续，这个 prompt 也要注意 token 成本，别每轮总结",
    response: "AI reflection 应该低频、可选、缓存，并由本地 episode 摘录喂给它。",
    sessionId: "session-a",
    now: now + 3000
  }, settings);

  await store.captureTurn({
    prompt: "继续，这个 prompt 不能像偏好清单，还是要保留分寸",
    response: "那它应该只补当前上下文缺失的历史互动经验。",
    sessionId: "session-a",
    now: now + 4000
  }, settings);

  memory = await store.loadMemory();
  assert.equal(memory.episodes.length, 4, "subsequent turns should close previous pending episodes");
  assert(
    memory.episodes.some((episode) => episode.outcomeHint === "new_request"),
    "a topic change should be closed as a new request rather than productive deepening"
  );
  assert(
    memory.patterns.some((pattern) => pattern.key === "nuance_over_rigid_profile_rules"),
    "repeated nuance/flattening signals should become a deterministic pattern"
  );
  assert(
    memory.patterns.some((pattern) => pattern.key === "token_cost_as_design_constraint"),
    "token-cost concern should become a deterministic pattern"
  );
  assert(
    memory.stableImpressions.some((impression) => impression.key === "nuanced_not_promptlike"),
    "repeated nuance evidence should promote into a long-term persona impression"
  );
  const stable = memory.stableImpressions.find((impression) => impression.key === "nuanced_not_promptlike");
  assert(stable.sourceHash, "stable impressions should cache their source hash");
  assert(stable.evidenceEpisodeIds.length > 0, "stable impressions should retain episode evidence ids");
  assert.equal(stable.generatedBy, "local", "local stable impressions should record their generator");
  assert.equal(stable.reviewStatus, "auto", "local stable impressions should record review status");

  const stance = await store.getPromptStance(settings, buildPromptInteractionContext(
    "继续设计 interaction memory 的落地方案",
    []
  ));
  assert(stance.length > 0, "closed episodes should produce prompt stance items");
  assert(stance.some((item) => item.kind === "stable_persona"), "prompt stance should include stable persona items when they mature");
  assert(stance.every((item) => item.axis !== "identity"), "stance should describe interaction texture rather than fixed identity");

  const prompt = formatInteractionStancePrompt(stance);
  assert(prompt.includes("Interaction memory:"), "stance prompt should be clearly labeled");
  assert(prompt.includes("Long-term interaction persona:"), "stance prompt should separate long-term persona from turn-local stance");
  assert(prompt.includes("Relevant interaction stance for this turn:"), "stance prompt should separate turn-local stance");
  assert(prompt.includes("episodes]"), "stance prompt should expose evidence count");
  assert(prompt.includes("soft local interaction notes"), "stance prompt should preserve its local context label");
}

async function testPromptIntegrationAndSensitiveFiltering() {
  const now = Date.UTC(2026, 6, 9);
  const { store } = createStore();

  await store.captureTurn({
    prompt: "这个 prompt 机制需要保留微妙区别，不要压成偏好清单",
    response: "我会把它拆成互动 episode 和 stance。",
    sessionId: "session-b",
    now
  }, settings);
  await store.captureTurn({
    prompt: "继续，这个 prompt 的 token 成本也要控制，不能每轮总结 sk-secret1234567890",
    response: "使用本地结构化摘录和低频候选归纳。",
    sessionId: "session-b",
    now: now + 1000
  }, settings);

  const memory = await store.loadMemory();
  assert(!JSON.stringify(memory).includes("sk-secret1234567890"), "interaction memory must redact secret-like text");

  const stance = getPromptStance(memory, Object.assign({}, settings, {
    interactionMemoryMinEvidence: 1
  }), buildPromptInteractionContext("继续，这个 prompt 机制还是要保留微妙区别", []), now + 1000);
  const result = await buildPromptWithMetadata(null, settings, "继续，这个 prompt 机制还是要保留微妙区别", [], {
    interactionStance: stance
  });
  assert(result.prompt.includes("Assistant continuity context:"), "buildPrompt should include continuity context");
  assert(result.prompt.includes("Collaboration stance:"), "buildPrompt should include interaction stance");
  assert(result.prompt.includes("User request:"), "buildPrompt should still include the user request");
}

function testReactionClassification() {
  const reaction = signalTest.classifyReaction({
    context: "agent_continuity",
    userSignals: ["asks_for_mechanism"]
  }, "帮我规划今天的 TODO，列出任务");
  assert.equal(reaction.kind, "new_request", "new requests should not become productive reactions just because they have signals");

  const continuation = signalTest.classifyReaction({
    context: "implementation",
    userSignals: ["pushes_for_nuance"]
  }, "继续，这个 prompt 还是别压扁微妙区别");
  assert.equal(continuation.kind, "deepening", "explicit same-context continuation should remain productive deepening");

  const clarification = signalTest.classifyReaction({
    context: "agent_continuity",
    userSignals: ["asks_for_mechanism"],
    assistantShape: ["mechanism_explanation"]
  }, "没懂，举例说明一下");
  assert.equal(clarification.outcomeHint, "clarification_requested", "clarification follow-up should be classified separately");

  const implementationFollowup = signalTest.classifyReaction({
    context: "agent_continuity",
    userSignals: ["asks_for_mechanism"],
    assistantShape: ["mechanism_explanation"]
  }, "好，那具体怎么实现？");
  assert.equal(implementationFollowup.outcomeHint, "implementation_followup", "concept-to-implementation follow-up should be classified separately");

  const styleFeedback = signalTest.classifyReaction({
    context: "general",
    userSignals: []
  }, "这个回答太像客服了，语气不对");
  assert.equal(styleFeedback.outcomeHint, "style_recalibration", "style feedback should calibrate style separately");
}

function testSignalRuleStrengthAndBlocking() {
  const weakGeneral = signalTest.matchesRule(
    "这个自然就好",
    signalTest.USER_SIGNAL_RULES.find((rule) => rule.id === "pushes_for_nuance"),
    "planning"
  );
  assert.equal(weakGeneral, false, "weak nuance words should not fire outside allowed contexts");

  const weakContextual = signalTest.matchesRule(
    "这个 agent 气质要自然一点",
    signalTest.USER_SIGNAL_RULES.find((rule) => rule.id === "pushes_for_nuance"),
    "agent_continuity"
  );
  assert.equal(weakContextual, true, "weak nuance words should fire in relevant contexts");

  const blocked = signalTest.matchesRule(
    "不用解释机制，直接改代码",
    signalTest.USER_SIGNAL_RULES.find((rule) => rule.id === "asks_for_mechanism"),
    "implementation"
  );
  assert.equal(blocked, false, "blocked mechanism phrasing should not fire");
}

function testZeroPromptLimitsAreRespected() {
  const normalized = normalizeSettings({
    interactionMemoryMaxPersonaItems: 0,
    interactionMemoryMaxStanceItems: 0
  });
  assert.equal(normalized.interactionMemoryMaxPersonaItems, 0, "persona limit should preserve explicit zero");
  assert.equal(normalized.interactionMemoryMaxStanceItems, 0, "stance limit should preserve explicit zero");

  const memory = {
    stableImpressions: [{
      key: "nuanced_not_promptlike",
      axis: "long_term_persona",
      text: "The assistant should preserve nuance.",
      evidenceCount: 4,
      strength: 0.8,
      confidence: 0.8,
      updatedAt: Date.UTC(2026, 6, 9)
    }],
    patterns: [{
      key: "token_cost_as_design_constraint",
      axis: "attention_pattern",
      summary: "Token cost matters.",
      signals: ["asks_about_cost"],
      contexts: { agent_continuity: 2 },
      evidenceCount: 2,
      strength: 0.8,
      confidence: 0.8,
      updatedAt: Date.UTC(2026, 6, 9)
    }]
  };
  const stance = getPromptStance(memory, Object.assign({}, settings, {
    interactionMemoryMaxPersonaItems: 0,
    interactionMemoryMaxStanceItems: 0
  }), buildPromptInteractionContext("继续", []), Date.UTC(2026, 6, 9));
  assert.equal(stance.length, 0, "zero persona and stance limits should produce no prompt stance");
}

async function testPendingEpisodesAreBoundedAndLegacyProfileClears() {
  const pendingEpisodes = Array.from({ length: MAX_PENDING_EPISODES + 5 }, (_, index) => ({
    id: `pending-${index}`,
    status: "pending",
    context: "general",
    userExcerpt: `prompt ${index}`,
    assistantExcerpt: `response ${index}`,
    userSignals: [],
    assistantShape: [],
    sourceSessionId: `session-${index}`,
    createdAt: index + 1,
    updatedAt: index + 1
  }));
  const { adapter, store } = createStore({
    "agent-dock/interaction/interaction-memory.json": JSON.stringify({
      version: 1,
      pendingEpisodes,
      episodes: [],
      patterns: [],
      tensions: [],
      stableImpressions: []
    }),
    "agent-dock/profile/agent-profile.json": JSON.stringify({ version: 1 })
  });

  const memory = await store.loadMemory();
  assert.equal(memory.pendingEpisodes.length, MAX_PENDING_EPISODES, "loaded pending episodes should be capped");
  assert.equal(memory.pendingEpisodes[0].id, "pending-5", "oldest pending episodes should be dropped first");

  await store.clearMemory();
  assert.equal(await adapter.exists("agent-dock/interaction/interaction-memory.json"), false, "interaction memory file should be removed");
  assert.equal(await adapter.exists("agent-dock/profile/agent-profile.json"), false, "legacy profile file should be removed with interaction memory");
  assert.equal(await adapter.exists("agent-dock/.agent-dock-local/interaction/interaction-memory.json"), false, "local interaction memory file should be removed");
}

function testTensionSignalBoostUsesSignals() {
  const tension = {
    confidence: 0.5,
    evidenceCount: 2,
    signals: ["asks_about_cost", "pushes_for_nuance"]
  };
  assert(
    scoreTension(tension, ["asks_about_cost"]) > scoreTension(tension, ["asks_for_depth"]),
    "tension scoring should boost when current prompt signals match stored tension signals"
  );
}

function testAssistantShapeReviewStatusAndNegativeEvidence() {
  const now = Date.UTC(2026, 6, 9);
  const positiveEpisodes = [
    {
      id: "positive-1",
      status: "closed",
      context: "agent_continuity",
      userSignals: ["asks_for_mechanism"],
      assistantShape: ["mechanism_explanation"],
      outcomeHint: "productive_deepening",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "positive-2",
      status: "closed",
      context: "agent_continuity",
      userSignals: ["asks_for_mechanism"],
      assistantShape: ["mechanism_explanation"],
      outcomeHint: "implementation_followup",
      createdAt: now + 1000,
      updatedAt: now + 1000
    }
  ];
  const negativeEpisode = {
    id: "negative-1",
    status: "closed",
    context: "agent_continuity",
    userSignals: ["asks_for_mechanism", "style_feedback"],
    assistantShape: ["settings_framing"],
    outcomeHint: "style_recalibration",
    createdAt: now + 2000,
    updatedAt: now + 2000
  };

  const positiveMemory = applyEpisodes({}, positiveEpisodes, Object.assign({}, settings, {
    interactionMemoryMinEvidence: 1
  }), now + 1000);
  const penalizedMemory = applyEpisodes({}, positiveEpisodes.concat(negativeEpisode), Object.assign({}, settings, {
    interactionMemoryMinEvidence: 1
  }), now + 2000);
  const positivePattern = positiveMemory.patterns.find((pattern) => pattern.key === "mechanism_before_settings");
  const penalizedPattern = penalizedMemory.patterns.find((pattern) => pattern.key === "mechanism_before_settings");
  assert(positivePattern, "assistant mechanism shape should support mechanism-oriented patterns");
  assert(penalizedPattern.negativeEvidenceCount > 0, "negative style/settings evidence should be counted");
  assert(penalizedPattern.strength < positivePattern.strength, "negative evidence should suppress pattern strength");

  const dismissedMemory = {
    stableImpressions: [{
      key: "dismissed",
      axis: "long_term_persona",
      text: "Dismissed persona should not appear.",
      reviewStatus: "dismissed",
      evidenceCount: 10,
      strength: 1,
      confidence: 1,
      updatedAt: now
    }]
  };
  assert.equal(getPromptStance(dismissedMemory, settings, buildPromptInteractionContext("继续 interaction memory", []), now).length, 0, "dismissed stable impressions should not enter prompts");

  const reviewedMemory = {
    stableImpressions: [
      {
        key: "auto",
        axis: "long_term_persona",
        text: "Auto persona.",
        reviewStatus: "auto",
        evidenceCount: 4,
        strength: 0.8,
        confidence: 0.8,
        updatedAt: now
      },
      {
        key: "confirmed",
        axis: "long_term_persona",
        text: "Confirmed persona.",
        reviewStatus: "confirmed",
        evidenceCount: 4,
        strength: 0.8,
        confidence: 0.8,
        updatedAt: now
      }
    ]
  };
  const reviewedStance = getPromptStance(reviewedMemory, Object.assign({}, settings, {
    interactionMemoryMaxPromptItems: 1,
    interactionMemoryMaxPersonaItems: 1,
    interactionMemoryMaxStanceItems: 0
  }), buildPromptInteractionContext("继续 interaction memory", []), now);
  assert.equal(reviewedStance[0].text, "Confirmed persona.", "confirmed stable impressions should outrank equal auto impressions");
}

testEpisodeClosureAndStance()
  .then(testPromptIntegrationAndSensitiveFiltering)
  .then(testReactionClassification)
  .then(testSignalRuleStrengthAndBlocking)
  .then(testZeroPromptLimitsAreRespected)
  .then(testPendingEpisodesAreBoundedAndLegacyProfileClears)
  .then(testTensionSignalBoostUsesSignals)
  .then(testAssistantShapeReviewStatusAndNegativeEvidence)
  .then(() => {
    console.log("Interaction memory tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
