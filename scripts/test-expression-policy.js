const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      TFile: class TFile {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { extractExpressionSignals } = require("../src/expression/ExpressionSignalExtractor");
const { planExpressionPolicy } = require("../src/expression/ExpressionPolicyPlanner");
const { formatExpressionPrompt } = require("../src/expression/ExpressionPromptFormatter");
const { buildPromptWithMetadata } = require("../src/prompt");

function testWorkRequestStaysContained() {
  const policy = planExpressionPolicy({
    prompt: "帮我实现这个模块并跑测试，给出验收标准",
    assistantStyle: "collaborative"
  });
  assert(policy.signals.work >= 0.38, "work implementation prompt should raise work signal");
  assert.equal(policy.tone, "serious", "work prompt should use serious tone");
  assert.equal(policy.expressiveness, "contained", "work prompt should stay contained");
  assert(policy.guidance.some((line) => line.includes("practical")), "work guidance should stay practical");
}

function testSupportRequestStartsSoft() {
  const policy = planExpressionPolicy({
    prompt: "我今天有点难过，也很累，不知道怎么办",
    assistantStyle: "collaborative"
  });
  assert(policy.signals.support >= 0.46, "sad/tired prompt should raise support signal");
  assert(policy.tone === "soft-sad" || policy.tone === "soft", "support prompt should become soft");
  assert(policy.guidance.some((line) => line.includes("acknowledge the feeling")), "support guidance should acknowledge feelings before solving");
}

function testRepairAvoidsPlayfulOvercorrection() {
  const policy = planExpressionPolicy({
    prompt: "不对，你刚才太像客服了，语气不对",
    assistantStyle: "collaborative"
  });
  assert(policy.signals.repair >= 0.5, "correction prompt should raise repair signal");
  assert(policy.tone.includes("nervous"), "repair prompt should become careful/nervous");
  assert.equal(policy.allowPlayfulness, false, "repair prompt should not allow playful expression");
  assert(policy.guidance.some((line) => line.includes("calibration")), "repair guidance should treat correction as calibration");
}

function testCreativeCanBeVivid() {
  const policy = planExpressionPolicy({
    prompt: "帮我写一段有氛围感的文字，画面可以更诗意一点",
    assistantStyle: "collaborative"
  });
  assert(policy.signals.creative >= 0.4, "creative prompt should raise creative signal");
  assert(["vivid", "playful-vivid"].includes(policy.tone), "creative prompt should allow vivid tone");
  assert(policy.guidance.some((line) => line.includes("vivid")), "creative guidance should allow vivid phrasing");
}

function testMixedWorkAndPlayfulnessDoesNotHardSwitch() {
  const signals = extractExpressionSignals({
    prompt: "哈哈这个 bug 也太离谱了，帮我看看怎么修"
  });
  assert(signals.scores.work > 0, "bug prompt should still be work");
  assert(signals.scores.playful > 0, "laughter should add playfulness");
  const policy = planExpressionPolicy({
    prompt: "哈哈这个 bug 也太离谱了，帮我看看怎么修",
    assistantStyle: "collaborative"
  });
  assert.equal(policy.tone, "serious-playful", "mixed work/play prompt should blend tone instead of hard switching");
  assert(policy.guidance.some((line) => line.includes("light laughter")), "mixed prompt should allow light laughter");
}

function testCurrentPromptOutweighsConversationMood() {
  const policy = planExpressionPolicy({
    prompt: "现在认真一点，帮我 review 这段实现",
    conversationText: "哈哈哈哈这个想法好可爱，随便聊聊就好",
    assistantStyle: "review"
  });
  assert(policy.signals.work >= policy.signals.playful, "current work prompt should outweigh older playful conversation");
  assert.equal(policy.expressiveness, "contained", "review-style current request should stay contained");
  assert.equal(policy.allowPlayfulness, false, "old playful context should not force playfulness into serious work");
}

async function testPromptBoundaryInjection() {
  const policy = planExpressionPolicy({
    prompt: "今天好累，想随便聊聊",
    assistantStyle: "collaborative"
  });
  const formatted = formatExpressionPrompt(policy);
  assert(formatted.includes("not facts, permissions, or task priority"), "formatter must include boundary language");

  const result = await buildPromptWithMetadata(null, {
    assistantStyle: "collaborative",
    contextLimitChars: 12000
  }, "今天好累，想随便聊聊", [], {
    expressionPolicy: policy
  });
  assert(result.prompt.includes("Expression context:"), "prompt should include expression context");
  assert(result.prompt.includes("User request:\n今天好累，想随便聊聊"), "prompt should preserve current user request");
}

Promise.resolve()
  .then(testWorkRequestStaysContained)
  .then(testSupportRequestStartsSoft)
  .then(testRepairAvoidsPlayfulOvercorrection)
  .then(testCreativeCanBeVivid)
  .then(testMixedWorkAndPlayfulnessDoesNotHardSwitch)
  .then(testCurrentPromptOutweighsConversationMood)
  .then(testPromptBoundaryInjection)
  .then(() => {
    console.log("Expression policy tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
