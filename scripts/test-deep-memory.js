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
  extractDeepMemoryCandidates,
  _test: deepMemoryExtractorTest
} = require("../src/deepMemory/DeepMemoryExtractor");
const { DeepMemoryStore } = require("../src/deepMemory/DeepMemoryStore");

const now = Date.UTC(2026, 6, 9);

function createAdapter() {
  const files = new Map();
  const dirs = new Set();
  return {
    files,
    async exists(path) {
      return files.has(path) || dirs.has(path);
    },
    async mkdir(path) {
      dirs.add(path);
    },
    async read(path) {
      if (!files.has(path)) {
        throw new Error("missing file");
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
}

function createStore() {
  const adapter = createAdapter();
  const store = new DeepMemoryStore({
    manifest: { id: "agent-dock", dir: ".obsidian/plugins/agent-dock" },
    app: {
      vault: { adapter }
    }
  });
  return { adapter, store };
}

function createSettings(overrides = {}) {
  return Object.assign({
    deepMemoryEnabled: true,
    deepMemoryAutoCapture: true,
    deepMemoryMaxItems: 80,
    deepMemoryMaxPromptItems: 2,
    deepMemoryImportanceThreshold: 0.68,
    deepMemoryRecallCooldownDays: 3,
    personaPreset: "none"
  }, overrides);
}

function testExtractorCapturesImportantMomentPreference() {
  const candidates = extractDeepMemoryCandidates({
    prompt: "我希望能够有“它真的记得一些重要时刻”的感觉，你能做到吗？",
    response: "能做到。",
    now
  }, { threshold: 0.68, now });

  assert.equal(candidates.length, 1, "important moment request should create one deep memory candidate");
  assert.equal(candidates[0].kind, "relationship_insight");
  assert(candidates[0].summary.includes("important prior collaboration"));

  for (const prompt of [
    "I want you to remember important moments.",
    "Please preserve meaningful prior collaboration."
  ]) {
    const englishCandidates = extractDeepMemoryCandidates({
      prompt,
      response: "I understand.",
      now
    }, { threshold: 0.68, now });
    assert.equal(englishCandidates.length, 1, `explicit English continuity preference should be captured: ${prompt}`);
    assert.equal(englishCandidates[0].kind, "relationship_insight");
  }
}

function testExtractorSkipsGenericThanksAndSensitiveText() {
  assert.equal(
    extractDeepMemoryCandidates({ prompt: "谢谢", response: "不客气。", now }, { threshold: 0.68, now }).length,
    0,
    "generic thanks should not become a deep memory"
  );
  assert.equal(
    extractDeepMemoryCandidates({ prompt: "api_key=sk-abc123 我很喜欢你这样", response: "ok", now }, { threshold: 0.68, now }).length,
    0,
    "sensitive content should not be captured"
  );
}

function testExtractorSkipsDeepMemoryMetaDiscussionAndOptOut() {
  const prompts = [
    "给 AI 的深刻记忆提示词是什么？",
    "我们在讨论深刻记忆的时候，本地规则是不是太容易更新候选？",
    "不要把这段讨论存成深刻记忆。"
  ];
  for (const prompt of prompts) {
    assert.equal(
      extractDeepMemoryCandidates({ prompt, response: "这是机制分析。", now }, { threshold: 0.68, now }).length,
      0,
      `meta-discussion or opt-out should not create deep memory: ${prompt}`
    );
  }

  assert.equal(
    extractDeepMemoryCandidates({
      prompt: "本地规则为什么会把深刻记忆讨论当成候选？",
      response: "这是一个需要修复的自触发问题。",
      agentDockSignals: [{
        type: "deep_memory",
        text: "The user discussed deep-memory behavior.",
        importance: 1
      }],
      now
    }, { threshold: 0.68, now }).length,
    0,
    "AI reflection must not bypass the local meta-discussion guard"
  );

  const meaningfulMixedContext = extractDeepMemoryCandidates({
    prompt: "这是重要时刻，你帮我测试后让我感觉被看见。",
    response: "我会珍惜这次连接。",
    now
  }, { threshold: 0.68, now });
  assert(
    meaningfulMixedContext.some((candidate) => candidate.kind === "meaningful_episode"),
    "an incidental meta word must not suppress independently strong visible relationship evidence"
  );
  assert.equal(
    deepMemoryExtractorTest.isDeepMemoryMetaDiscussion("This was the greatest important moments experience."),
    false,
    "English meta terms should use word boundaries instead of matching substrings"
  );
  assert.equal(
    deepMemoryExtractorTest.isDeepMemoryMetaDiscussion("What prompt defines deep memory?"),
    true,
    "explicit English deep-memory mechanism discussion should still be recognized"
  );
}

function testExtractorCapturesAgentDockDeepMemorySignal() {
  const candidates = extractDeepMemoryCandidates({
    prompt: "可以，把这个机制加上。",
    response: "已完成。",
    agentDockSignals: [{
      type: "deep_memory",
      text: "用户希望深刻记忆通过可审计的元数据进入系统，而不是在正文里显得刻意。",
      axes: ["care", "repair"],
      importance: 0.76
    }],
    now
  }, { threshold: 0.68, now });

  assert.equal(candidates.length, 1, "agent-dock deep-memory signal should create a deep memory candidate");
  assert.equal(candidates[0].kind, "visible_reflection");
  assert(candidates[0].summary.includes("可审计的元数据"));
  assert(candidates[0].assistantExcerpt.includes("可审计的元数据"));
  assert.deepEqual(candidates[0].salienceAxes, ["care", "repair"]);
  assert(candidates[0].importance < 0.78, "AI-provided importance should be treated as a bounded suggestion");
}

function testExtractorDoesNotTreatOrdinaryAssistantContentAsSignal() {
  const candidates = extractDeepMemoryCandidates({
    prompt: "可以，把这个机制加上。",
    response: "我会把这个方向放在实现里，但没有结构化信号。",
    now
  }, { threshold: 0.68, now });

  assert.equal(candidates.length, 0, "ordinary assistant content should not become signal memory");
}

function testLowImportanceAiSignalDoesNotAutomaticallyPassThreshold() {
  const candidates = extractDeepMemoryCandidates({
    prompt: "今天聊了一些普通内容。",
    response: "这是一次普通交流。",
    agentDockSignals: [{
      type: "deep_memory",
      text: "A routine exchange without lasting continuity value.",
      importance: 0.4
    }],
    now
  }, { threshold: 0.68, now });

  assert.equal(candidates.length, 0, "low-importance AI proposals should stay below the default local threshold");
}

function testSalienceObservationOnlyBoostsMatchingExistingCandidates() {
  const turn = {
    prompt: "终于修好了这个很难的问题。",
    response: "这个很难的问题终于修好了。",
    now
  };
  const baseline = extractDeepMemoryCandidates(turn, { threshold: 0, now });
  const supplemented = extractDeepMemoryCandidates(Object.assign({}, turn, {
    agentDockSignals: [{
      type: "salience_observation",
      text: "这次经历体现了攻克困难问题后的成就感与实现工艺。",
      evidence: ["这个很难的问题终于修好了"],
      axes: ["achievement", "craft"],
      confidence: 0.9,
      envelope: "reflection_v1"
    }]
  }), { threshold: 0, now });

  const baselineAchievement = baseline.find((item) => item.kind === "hard_won_achievement");
  const supplementedAchievement = supplemented.find((item) => item.kind === "hard_won_achievement");
  assert.equal(supplemented.length, baseline.length, "salience observations must not create standalone deep memories");
  assert(supplementedAchievement.importance > baselineAchievement.importance, "matching salience axes should add a bounded importance boost");
  assert(supplementedAchievement.topics.includes("agent_salience_observation"), "boosted candidates should retain auditable salience provenance");
}

async function testStoreCapturesAndRecallsWithCooldown() {
  const { adapter, store } = createStore();
  const settings = createSettings();
  const saved = await store.captureTurn({
    prompt: "我希望能够有它真的记得一些重要时刻的感觉",
    response: "我会把它做成少量高重要度的关系性记忆。",
    sessionId: "s1",
    now
  }, settings);

  assert.equal(saved.length, 1, "store should save a deep memory");
  assert(adapter.files.has(".obsidian/plugins/agent-dock/.agent-dock-local/deep-memory/deep-memory.json"), "deep memory should be written under local data dir");

  const recalled = await store.getPromptMemories(
    "Let's continue the continuity and relationship design.",
    settings,
    { now: now + 86400000 }
  );
  assert.equal(recalled.length, 1, "matching prompt should recall the memory");
  assert.equal(recalled[0].recallCount, 1, "recall should update the selected memory");

  const cooled = await store.getPromptMemories(
    "Let's continue the continuity and relationship design.",
    settings,
    { now: now + 2 * 86400000 }
  );
  assert.equal(cooled.length, 0, "cooldown should suppress proactive repeat recall");

  const explicit = await store.getPromptMemories(
    "你还记得之前的重要时刻吗？",
    settings,
    { now: now + 2 * 86400000 }
  );
  assert.equal(explicit.length, 1, "explicit recall should bypass cooldown");
}

async function testDeepMemoryRecallsSubtleParaphrase() {
  const { store } = createStore();
  const settings = createSettings();
  const saved = await store.captureTurn({
    prompt: "我们决定不要显眼标签，深刻记忆要像自然连续性一样留在背景里。",
    response: "收到。",
    agentDockSignals: [{
      type: "deep_memory",
      text: "用户希望重要记忆像自然连续性，而不是显眼标签。",
      axes: ["care", "repair"],
      importance: 0.78
    }],
    sessionId: "s-subtle",
    now
  }, settings);

  assert.equal(saved.length, 1, "a design discussion should not create a second keyword-triggered relationship memory");

  const recalled = await store.getPromptMemories(
    "你还记得我之前说的那个不要太刻意的感觉吗？",
    settings,
    { now: now + 86400000 }
  );
  assert(
    recalled.some((memory) => memory.summary.includes("自然连续性") || memory.assistantExcerpt.includes("自然连续性")),
    "deep memory should recall subtle paraphrases through query expansion"
  );
}

async function testSaliencePresetInfluencesCapture() {
  const { store: neutralStore } = createStore();
  const neutralSaved = await neutralStore.captureTurn({
    prompt: "今天看到夕阳和晚霞，很美，也有点被那个氛围打动。",
    response: "那种氛围确实值得停一下。",
    sessionId: "s2",
    now
  }, createSettings({ personaPreset: "none" }));
  assert.equal(neutralSaved.length, 0, "neutral persona should not save low-baseline beauty moments");

  const { store: infpStore } = createStore();
  const infpSaved = await infpStore.captureTurn({
    prompt: "今天看到夕阳和晚霞，很美，也有点被那个氛围打动。",
    response: "那种氛围确实值得停一下。",
    sessionId: "s3",
    now
  }, createSettings({ personaPreset: "INFP-ish" }));
  assert.equal(infpSaved.length, 1, "beauty-sensitive persona should save beauty moments");
  assert.equal(infpSaved[0].kind, "beauty_moment");
  assert.deepEqual(infpSaved[0].salienceAxes, ["beauty"]);

  const { store: intjStore } = createStore();
  const intjSaved = await intjStore.captureTurn({
    prompt: "这个很难的实现终于跑通了，我们把它修好了。",
    response: "很好，这是一段 hard-won progress。",
    sessionId: "s4",
    now
  }, createSettings({ personaPreset: "INTJ-ish" }));
  assert.equal(intjSaved.length, 1, "craft/achievement-sensitive persona should save hard-won progress");
  assert.equal(intjSaved[0].kind, "hard_won_achievement");
}

async function testAssistantContentCanProvideOutcomeEvidence() {
  const { store: neutralStore } = createStore();
  const neutralSaved = await neutralStore.captureTurn({
    prompt: "帮我实现这个功能。",
    response: "已完成实现，测试通过，全部通过。",
    sessionId: "s5",
    now
  }, createSettings({ personaPreset: "none" }));
  assert.equal(neutralSaved.length, 0, "assistant outcome alone should stay low weight without matching persona salience");

  const { store: intjStore } = createStore();
  const intjSaved = await intjStore.captureTurn({
    prompt: "帮我实现这个功能。",
    response: "已完成实现，测试通过，全部通过。",
    sessionId: "s6",
    now
  }, createSettings({ personaPreset: "INTJ-ish" }));
  assert.equal(intjSaved.length, 1, "craft/achievement-sensitive persona should use visible assistant outcome evidence");
  assert.equal(intjSaved[0].kind, "hard_won_achievement");
  assert(intjSaved[0].assistantExcerpt.includes("测试通过"), "assistant excerpt should preserve visible final content evidence");
}

Promise.resolve()
  .then(testExtractorCapturesImportantMomentPreference)
  .then(testExtractorSkipsGenericThanksAndSensitiveText)
  .then(testExtractorSkipsDeepMemoryMetaDiscussionAndOptOut)
  .then(testExtractorCapturesAgentDockDeepMemorySignal)
  .then(testExtractorDoesNotTreatOrdinaryAssistantContentAsSignal)
  .then(testLowImportanceAiSignalDoesNotAutomaticallyPassThreshold)
  .then(testSalienceObservationOnlyBoostsMatchingExistingCandidates)
  .then(testStoreCapturesAndRecallsWithCooldown)
  .then(testDeepMemoryRecallsSubtleParaphrase)
  .then(testSaliencePresetInfluencesCapture)
  .then(testAssistantContentCanProvideOutcomeEvidence)
  .then(() => {
    console.log("Deep memory tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
