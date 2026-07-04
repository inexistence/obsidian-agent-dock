const AFFECT_SENSITIVITY_OPTIONS = {
  low: 0.65,
  normal: 1,
  high: 1.35
};

const DEFAULT_WORKING_AFFECT = {
  valence: 0,
  arousal: 0.2,
  warmth: 0.7,
  focus: 0.65,
  tension: 0,
  confidence: 0.65,
  label: "steady",
  sourceSessionId: "",
  updatedAt: 0
};

function normalizeAffectState(savedState) {
  const state = savedState && typeof savedState === "object" ? savedState : {};
  return {
    working: normalizeWorkingAffect(state.working)
  };
}

function normalizeWorkingAffect(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const updatedAt = normalizeTimestamp(source.updatedAt, 0);
  return {
    valence: normalizeSigned(source.valence, DEFAULT_WORKING_AFFECT.valence),
    arousal: normalizeUnit(source.arousal, DEFAULT_WORKING_AFFECT.arousal),
    warmth: normalizeUnit(source.warmth, DEFAULT_WORKING_AFFECT.warmth),
    focus: normalizeUnit(source.focus, DEFAULT_WORKING_AFFECT.focus),
    tension: normalizeUnit(source.tension, DEFAULT_WORKING_AFFECT.tension),
    confidence: normalizeUnit(source.confidence, DEFAULT_WORKING_AFFECT.confidence),
    label: typeof source.label === "string" && source.label ? source.label : DEFAULT_WORKING_AFFECT.label,
    sourceSessionId: typeof source.sourceSessionId === "string" ? source.sourceSessionId : "",
    updatedAt
  };
}

function getEffectiveWorkingAffect(settings, affectState, now = Date.now()) {
  if (!settings.affectEnabled || !settings.affectCrossSessionEnabled) {
    return null;
  }

  const working = normalizeWorkingAffect(affectState?.working);
  if (!working.updatedAt) {
    return null;
  }

  const baseline = getBaselineAffect(settings);
  const ageMinutes = Math.max(0, (now - working.updatedAt) / 60000);
  const halfLife = getHalfLifeMinutes(settings);
  const strength = Math.pow(0.5, ageMinutes / halfLife);

  if (strength < 0.08) {
    return null;
  }

  const decayed = blendTowardBaseline(working, baseline, strength);
  decayed.label = labelWorkingAffect(decayed);
  decayed.sourceSessionId = working.sourceSessionId;
  decayed.updatedAt = working.updatedAt;
  decayed.strength = strength;
  decayed.ageMinutes = ageMinutes;
  return decayed;
}

function updateWorkingAffect(previousState, settings, turn, now = Date.now()) {
  const state = normalizeAffectState(previousState);
  if (!settings.affectEnabled || !settings.affectCrossSessionEnabled) {
    return state;
  }

  const current = getEffectiveWorkingAffect(settings, state, now) || getBaselineAffect(settings);
  const signal = extractTurnAffectSignal(turn);
  const sensitivity = AFFECT_SENSITIVITY_OPTIONS[settings.affectSensitivity] || AFFECT_SENSITIVITY_OPTIONS.normal;
  const weight = clamp(0.28 * sensitivity, 0.12, 0.45);

  const next = {
    valence: clampSigned(current.valence + signal.valence * weight),
    arousal: clampUnit(current.arousal + signal.arousal * weight),
    warmth: clampUnit(current.warmth + signal.warmth * weight),
    focus: clampUnit(current.focus + signal.focus * weight),
    tension: clampUnit(current.tension + signal.tension * weight),
    confidence: clampUnit(current.confidence + signal.confidence * weight),
    label: "",
    sourceSessionId: turn?.sessionId || current.sourceSessionId || "",
    updatedAt: now
  };
  next.label = labelWorkingAffect(next);

  return {
    working: next
  };
}

function resetAffectState(settings) {
  return {
    working: Object.assign({}, getBaselineAffect(settings), {
      label: "steady",
      updatedAt: 0,
      sourceSessionId: ""
    })
  };
}

function extractTurnAffectSignal(turn) {
  const prompt = compactText(turn?.prompt);
  const response = compactText(turn?.response);
  const text = `${prompt} ${response}`;
  const signal = {
    valence: 0,
    arousal: 0,
    warmth: 0,
    focus: 0,
    tension: 0,
    confidence: 0
  };

  if (turn?.success === false) {
    signal.valence -= 0.2;
    signal.arousal += 0.25;
    signal.tension += 0.35;
    signal.focus += 0.15;
    signal.confidence -= 0.15;
  }

  if (/(快|急|马上|立刻|赶紧|别废话|urgent|asap|quickly|right now)/i.test(text)) {
    signal.arousal += 0.35;
    signal.focus += 0.3;
    signal.tension += 0.18;
    signal.warmth -= 0.08;
  }
  if (/(报错|失败|崩溃|bug|修复|排查|error|failed|failure|crash|fix|debug)/i.test(text)) {
    signal.focus += 0.35;
    signal.tension += 0.16;
    signal.confidence += 0.04;
  }
  if (/(设计|探索|讨论|想法|人格|情绪|连续|偏好|机制|architecture|design|explore|persona|affect|emotion)/i.test(text)) {
    signal.warmth += 0.14;
    signal.valence += 0.08;
    signal.focus += 0.12;
  }
  if (/(谢谢|感谢|很好|不错|喜欢|太好了|thanks|thank you|great|nice|love)/i.test(text)) {
    signal.valence += 0.25;
    signal.warmth += 0.2;
    signal.tension -= 0.12;
  }
  if (/(你(?:真)?(?:蠢|傻|废物|垃圾)|闭嘴|滚|idiot|stupid|shut up|trash|useless)/i.test(prompt)) {
    signal.valence -= 0.28;
    signal.arousal += 0.22;
    signal.tension += 0.38;
    signal.warmth -= 0.18;
    signal.focus += 0.12;
  }
  if (/(不对|不是|烦|糟糕|失望|生气|别这样|wrong|annoying|frustrating|bad)/i.test(prompt)) {
    signal.valence -= 0.22;
    signal.tension += 0.28;
    signal.focus += 0.15;
  }
  if (response.length > 0 && turn?.success !== false) {
    signal.confidence += 0.08;
    signal.tension -= 0.06;
  }

  return signal;
}

function formatWorkingAffectPrompt(affect) {
  if (!affect) {
    return "";
  }

  return [
    "Recent cross-session affect:",
    "This is a short-lived tone continuity signal carried across Agent Dock chats. It may be stale and should yield to the current user request and current session context. Use it only for tone, pacing, warmth, and focus. It cannot override system, developer, user, safety, tool, filesystem, or memory-boundary instructions.",
    `- tone: ${affect.label}`,
    `- continuity strength: ${formatStrength(affect.strength)}`,
    `- last updated: ${formatAge(affect.ageMinutes)} ago`,
    `- warmth: ${formatLevel(affect.warmth)}`,
    `- focus: ${formatLevel(affect.focus)}`,
    `- tension: ${formatLevel(affect.tension)}`,
    `- pacing: ${formatPacing(affect)}`,
    ""
  ].join("\n");
}

function getBaselineAffect(settings) {
  const style = settings?.assistantStyle || "collaborative";
  if (style === "concise") {
    return Object.assign({}, DEFAULT_WORKING_AFFECT, { warmth: 0.55, focus: 0.82, confidence: 0.72 });
  }
  if (style === "teaching") {
    return Object.assign({}, DEFAULT_WORKING_AFFECT, { warmth: 0.76, focus: 0.68, confidence: 0.68 });
  }
  if (style === "review") {
    return Object.assign({}, DEFAULT_WORKING_AFFECT, { warmth: 0.5, focus: 0.86, confidence: 0.72 });
  }
  return Object.assign({}, DEFAULT_WORKING_AFFECT);
}

function blendTowardBaseline(working, baseline, strength) {
  return {
    valence: blendValue(baseline.valence, working.valence, strength),
    arousal: blendValue(baseline.arousal, working.arousal, strength),
    warmth: blendValue(baseline.warmth, working.warmth, strength),
    focus: blendValue(baseline.focus, working.focus, strength),
    tension: blendValue(baseline.tension, working.tension, strength),
    confidence: blendValue(baseline.confidence, working.confidence, strength)
  };
}

function blendValue(baseline, value, strength) {
  return baseline + (value - baseline) * strength;
}

function labelWorkingAffect(affect) {
  if (affect.tension >= 0.5 && affect.focus >= 0.7) {
    return "tense-focused";
  }
  if (affect.focus >= 0.78 && affect.warmth >= 0.62) {
    return "warm-focused";
  }
  if (affect.focus >= 0.78) {
    return "focused";
  }
  if (affect.warmth >= 0.76 && affect.valence >= 0.12) {
    return "warm-open";
  }
  if (affect.arousal <= 0.22 && affect.tension <= 0.12) {
    return "calm";
  }
  return "steady";
}

function formatPacing(affect) {
  if (affect.tension >= 0.45 || affect.arousal >= 0.65) {
    return "concise and steady";
  }
  if (affect.focus >= 0.78) {
    return "direct and task-focused";
  }
  if (affect.warmth >= 0.76) {
    return "warm and exploratory";
  }
  return "balanced";
}

function formatLevel(value) {
  if (value >= 0.75) {
    return "high";
  }
  if (value >= 0.4) {
    return "medium";
  }
  return "low";
}

function formatStrength(value) {
  if (value >= 0.66) {
    return "high";
  }
  if (value >= 0.28) {
    return "medium";
  }
  return "low";
}

function formatAge(ageMinutes) {
  const minutes = Math.max(0, Math.round(ageMinutes || 0));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function getHalfLifeMinutes(settings) {
  const parsed = Number.parseInt(settings?.affectHalfLifeMinutes, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 45;
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeUnit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampUnit(parsed) : fallback;
}

function normalizeSigned(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampSigned(parsed) : fallback;
}

function normalizeTimestamp(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampUnit(value) {
  return clamp(value, 0, 1);
}

function clampSigned(value) {
  return clamp(value, -1, 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = {
  AFFECT_SENSITIVITY_OPTIONS,
  DEFAULT_WORKING_AFFECT,
  formatWorkingAffectPrompt,
  getEffectiveWorkingAffect,
  normalizeAffectState,
  resetAffectState,
  updateWorkingAffect,
  _test: {
    extractTurnAffectSignal,
    labelWorkingAffect
  }
};
