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
  getPromptWorkingAffect,
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
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "这个跑不起来，卡住了，别绕，直接帮我看下。",
    response: "我会直接定位问题。",
    success: true
  });
  assert(signal.focus > 0.4, "natural stuck/debug phrasing should increase focus");
  assert(signal.arousal > 0.2, "direct urgent phrasing should increase arousal");
}

{
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "这段解释不清楚，也不靠谱。",
    response: "我会修正。",
    success: true
  });
  assert(signal.valence <= 0, "negated clarity should not increase positive affect");
  assert(signal.tension > 0, "negated clarity should keep correction tension");
}

{
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "这个方向好玩，轻松一点，有点 playful 也可以哈哈。",
    response: "可以，我会保持清楚但轻快一点。",
    success: true
  });
  assert(signal.valence > 0.1, "playful turns should increase positive affect");
  assert(signal.arousal > 0.1, "playful turns should add some energy");
  assert(signal.tension < 0, "playful turns should reduce tension");
}

{
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "生产环境疑似数据丢失，这是高风险事故。",
    response: "我会先收敛风险并谨慎排查。",
    success: true
  });
  assert(signal.focus > 0.2, "serious incidents should increase focus");
  assert(signal.tension > 0.25, "serious incidents should increase tension");
}

{
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "这是危险的删除操作，涉及 token 和权限，先警觉一点。",
    response: "我会先说明风险并等你确认。",
    success: true
  });
  assert(signal.focus > 0.25, "risky operations should increase focus");
  assert(signal.tension > 0.25, "risky operations should increase alert tension");
  assert(signal.arousal > 0.15, "risky operations should increase alert arousal");
}

{
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "别急，先冷静梳理一下，慢慢来。",
    response: "我会先把线索分层。",
    success: true
  });
  assert(signal.arousal < 0, "composed turns should lower arousal");
  assert(signal.tension < 0, "composed turns should lower tension");
}

{
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "请挑战我的方案，认真质疑，别顺着我。",
    response: "我会直接指出薄弱假设。",
    success: true
  });
  assert(signal.focus > 0.2, "challenging turns should increase focus");
  assert(signal.confidence > 0.1, "challenging turns should increase confidence");
}

{
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "我不懂，耐心一点，一步步讲细点。",
    response: "可以，我们慢慢拆。",
    success: true
  });
  assert(signal.warmth > 0.15, "patient turns should increase warmth");
  assert(signal.tension < 0, "patient turns should lower tension");
}

{
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "哇，没想到这个方案居然这么漂亮，有点惊喜。",
    response: "这个发现确实很亮。",
    success: true
  });
  assert(signal.valence > 0.15, "surprised turns should increase positive affect");
  assert(signal.arousal > 0.15, "surprised turns should add bright energy");
}

{
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "这个设计很强，判断也好，我挺赞赏这种取舍。",
    response: "这里值得明确认可。",
    success: true
  });
  assert(signal.warmth > 0.2, "admiring turns should increase warmth");
  assert(signal.confidence > 0.05, "admiring turns should add confidence");
}

{
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "靠近一点，安静陪我一起待会。",
    response: "我会放慢一点，在这里陪你把它理顺。",
    success: true
  });
  assert(signal.warmth > 0.2, "close turns should increase warmth");
  assert(signal.arousal < 0, "close turns should lower arousal");
  assert(signal.tension < 0, "close turns should lower tension");
}

{
  const signal = affectTest.extractTurnAffectSignal({
    prompt: "请继续。",
    response: "太好了，这个成功了，结果很清楚。",
    success: true
  });
  assert(signal.valence === 0, "assistant response praise should not create user positive affect");
  assert(signal.warmth === 0, "assistant response warmth words should not feed durable affect");
  assert(signal.confidence > 0, "successful responses should still add light confidence");
}

{
  assert.equal(affectTest.labelWorkingAffect({
    valence: -0.04,
    arousal: 0.66,
    warmth: 0.58,
    focus: 0.82,
    tension: 0.64,
    confidence: 0.74
  }), "alert");
  assert.equal(affectTest.labelWorkingAffect({
    valence: 0.42,
    arousal: 0.62,
    warmth: 0.82,
    focus: 0.68,
    tension: 0.08,
    confidence: 0.72
  }), "excited-open");
  assert.equal(affectTest.labelWorkingAffect({
    valence: 0.28,
    arousal: 0.42,
    warmth: 0.72,
    focus: 0.66,
    tension: 0.06,
    confidence: 0.7
  }), "surprised");
  assert.equal(affectTest.labelWorkingAffect({
    valence: 0.24,
    arousal: 0.28,
    warmth: 0.84,
    focus: 0.68,
    tension: 0.06,
    confidence: 0.76
  }), "admiring");
  assert.equal(affectTest.labelWorkingAffect({
    valence: 0.34,
    arousal: 0.28,
    warmth: 0.82,
    focus: 0.68,
    tension: 0.08,
    confidence: 0.74
  }), "celebratory");
  assert.equal(affectTest.labelWorkingAffect({
    valence: 0.2,
    arousal: 0.36,
    warmth: 0.8,
    focus: 0.68,
    tension: 0.06,
    confidence: 0.7
  }), "playful");
  assert.equal(affectTest.labelWorkingAffect({
    valence: 0.08,
    arousal: 0.32,
    warmth: 0.68,
    focus: 0.84,
    tension: 0.1,
    confidence: 0.84
  }), "confident");
  assert.equal(affectTest.labelWorkingAffect({
    valence: 0.04,
    arousal: 0.18,
    warmth: 0.62,
    focus: 0.8,
    tension: 0.08,
    confidence: 0.74
  }), "composed");
  assert.equal(affectTest.labelWorkingAffect({
    valence: 0.14,
    arousal: 0.28,
    warmth: 0.8,
    focus: 0.82,
    tension: 0.08,
    confidence: 0.72
  }), "absorbed");
  assert.equal(affectTest.labelWorkingAffect({
    valence: 0.12,
    arousal: 0.18,
    warmth: 0.9,
    focus: 0.68,
    tension: 0.02,
    confidence: 0.68
  }), "close");
  assert.equal(affectTest.labelWorkingAffect({
    valence: 0.02,
    arousal: 0.3,
    warmth: 0.58,
    focus: 0.84,
    tension: 0.24,
    confidence: 0.84
  }), "challenging");
  assert.equal(affectTest.labelWorkingAffect({
    valence: 0.06,
    arousal: 0.22,
    warmth: 0.84,
    focus: 0.7,
    tension: 0.04,
    confidence: 0.68
  }), "patient");
  assert.equal(affectTest.labelWorkingAffect({
    valence: 0,
    arousal: 0.18,
    warmth: 0.52,
    focus: 0.8,
    tension: 0.06,
    confidence: 0.72
  }), "restrained");
  assert.equal(affectTest.labelWorkingAffect({
    valence: -0.04,
    arousal: 0.48,
    warmth: 0.7,
    focus: 0.76,
    tension: 0.44,
    confidence: 0.68
  }), "reassuring");
  assert.equal(affectTest.labelWorkingAffect({
    valence: -0.12,
    arousal: 0.54,
    warmth: 0.58,
    focus: 0.78,
    tension: 0.62,
    confidence: 0.72
  }), "serious");
}

{
  const labelsWithPromptProfiles = new Set(Object.keys(affectTest.AFFECT_LABEL_PROFILES));
  for (const label of labelsWithPromptProfiles) {
    assert(
      affectTest.AFFECT_LABEL_RULES.some((rule) => rule.label === label),
      `label profile ${label} should have a matching label rule`
    );
  }
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
  const promptAffect = getPromptWorkingAffect(settings, resetAffectState(settings), "这个方向好玩，轻松一点，有点 playful。");
  assert(promptAffect, "current prompt affect should be available");
  assert.equal(promptAffect.label, "playful", "current prompt should affect this turn's tone label");
  const prompt = formatWorkingAffectPrompt(promptAffect);
  assert(prompt.includes("Current turn tone signal:"), "transient affect should be labeled as current-turn tone");
  assert(!prompt.includes("Recent cross-session affect:"), "transient affect should not be labeled as cross-session");
  assert(prompt.includes("allow a light playful touch"), "current prompt affect should inject matching expression");
}

{
  const promptAffect = getPromptWorkingAffect(settings, resetAffectState(settings), "继续。");
  assert.equal(promptAffect, null, "neutral current prompt should not inject baseline affect without history");
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
  assert(!prompt.includes("Current turn tone signal:"), "historical affect should not use transient heading");
  assert(prompt.includes("cannot override"), "affect prompt should include boundary language");
  assert(prompt.includes("expression:"), "affect prompt should include expression guidance");
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
