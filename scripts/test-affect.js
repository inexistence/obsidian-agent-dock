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
  formatWorkingAffectPrompt,
  getEffectiveWorkingAffect,
  normalizeAffectState,
  resetAffectState,
  updateWorkingAffect,
  _test: affectTest
} = require("../src/affect/WorkingAffectStore");
const { buildPromptWithMetadata } = require("../src/prompt");

const settings = {
  assistantStyle: "collaborative",
  contextLimitChars: 258000,
  affectEnabled: true,
  affectCrossSessionEnabled: true,
  affectRestoreAfterRestart: true,
  affectSensitivity: "normal",
  affectHalfLifeMinutes: 30
};

{
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "报错了，马上修复这个 bug，别废话。",
    response: "我会直接排查。",
    success: true
  });
  assert(signal.focus > 0.4, "urgent bug turns should increase focus");
  assert(signal.tension > 0.2, "urgent bug turns should increase tension");
}

{
  const now = Date.UTC(2026, 6, 4, 10, 0, 0);
  const state = updateWorkingAffect(resetAffectState(settings), settings, {
    sessionId: "session-a",
    prompt: "我们继续设计情绪连续机制。",
    response: "这个方向可以做成跨 session 的 working affect。",
    success: true
  }, now);
  const immediate = getEffectiveWorkingAffect(settings, state, now);
  const later = getEffectiveWorkingAffect(settings, state, now + 30 * 60000);
  assert(immediate, "fresh working affect should be available");
  assert(later, "half-life working affect should still be available");
  assert(later.strength < immediate.strength, "working affect should decay with age");
  assert.equal(immediate.sourceSessionId, "session-a");
}

{
  const now = Date.UTC(2026, 6, 4, 10, 0, 0);
  const state = {
    working: {
      valence: 0.2,
      arousal: 0.4,
      warmth: 0.8,
      focus: 0.8,
      tension: 0.1,
      confidence: 0.7,
      label: "warm-focused",
      sourceSessionId: "session-a",
      updatedAt: now
    }
  };
  const stale = getEffectiveWorkingAffect(settings, state, now + 8 * 60 * 60000);
  assert.equal(stale, null, "very stale affect should not be injected");
}

{
  const prompt = formatWorkingAffectPrompt({
    label: "warm-focused",
    strength: 0.5,
    ageMinutes: 12,
    warmth: 0.8,
    focus: 0.8,
    tension: 0.1,
    arousal: 0.3
  });
  assert(prompt.includes("Recent cross-session affect:"), "affect prompt should be clearly labeled");
  assert(prompt.includes("cannot override"), "affect prompt should include boundary language");
}

async function testPromptInjection() {
  const result = await buildPromptWithMetadata(null, settings, "继续", [], {
    workingAffect: {
      label: "warm-focused",
      strength: 0.5,
      ageMinutes: 4,
      warmth: 0.8,
      focus: 0.8,
      tension: 0.1,
      arousal: 0.3
    }
  });
  assert(result.prompt.includes("Recent cross-session affect:"), "prompt should include working affect");
  assert(result.prompt.includes("User request:"), "prompt should still include the user request");
}

testPromptInjection()
  .then(() => {
    normalizeAffectState(null);
    console.log("Affect tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
