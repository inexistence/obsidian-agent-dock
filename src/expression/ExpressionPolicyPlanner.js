const { extractExpressionSignals } = require("./ExpressionSignalExtractor");

function planExpressionPolicy(input = {}) {
  const signalResult = extractExpressionSignals({
    prompt: input.prompt,
    conversationText: input.conversationText
  });
  const scores = Object.assign({}, signalResult.scores);
  applyAffect(scores, input.workingAffect);
  applyInteractionStance(scores, input.interactionStance);
  applyAssistantStyle(scores, input.assistantStyle);

  const tone = chooseTone(scores);
  const policy = {
    signals: scores,
    matched: signalResult.matched,
    tone,
    intensity: chooseIntensity(scores, tone),
    intimacy: chooseIntimacy(scores, input.assistantStyle),
    expressiveness: chooseExpressiveness(scores),
    allowPlayfulness: scores.playful >= 0.22 && scores.repair < 0.35,
    allowVulnerability: (scores.support + scores.tenderness + scores.intimacy) >= 0.7 && scores.work < 0.75,
    guidance: buildGuidance(scores, tone)
  };

  policy.confidence = Math.max(signalResult.confidence, getMaxScore(scores));
  return policy;
}

function applyAffect(scores, affect) {
  if (!affect) {
    return;
  }
  scores.tenderness = clampUnit(scores.tenderness + Number(affect.warmth || 0) * 0.18);
  scores.seriousness = clampUnit(scores.seriousness + Number(affect.focus || 0) * 0.16 + Number(affect.tension || 0) * 0.12);
  if (String(affect.label || "").includes("playful")) {
    scores.playful = clampUnit(scores.playful + 0.24);
  }
  if (String(affect.label || "").includes("celebratory")) {
    scores.playful = clampUnit(scores.playful + 0.16);
  }
}

function applyInteractionStance(scores, items) {
  const text = normalizeItemsText(items);
  if (!text) {
    return;
  }
  if (/客服|自然|表达|温暖|presence|warm|customer-service|robotic/i.test(text)) {
    scores.intimacy = clampUnit(scores.intimacy + 0.14);
    scores.tenderness = clampUnit(scores.tenderness + 0.1);
  }
  if (/严肃|直接|判断|实现|落地|implementation|judgment|concrete/i.test(text)) {
    scores.work = clampUnit(scores.work + 0.12);
    scores.seriousness = clampUnit(scores.seriousness + 0.12);
  }
  if (/修复|纠正|calibration|repair|defensive/i.test(text)) {
    scores.repair = clampUnit(scores.repair + 0.12);
  }
  if (/微妙|细腻|nuance|texture/i.test(text)) {
    scores.creative = clampUnit(scores.creative + 0.08);
    scores.tenderness = clampUnit(scores.tenderness + 0.08);
  }
}

function applyAssistantStyle(scores, assistantStyle) {
  if (assistantStyle === "review") {
    scores.work = clampUnit(scores.work + 0.18);
    scores.seriousness = clampUnit(scores.seriousness + 0.2);
    scores.playful = Math.min(scores.playful, 0.18);
  } else if (assistantStyle === "teaching") {
    scores.tenderness = clampUnit(scores.tenderness + 0.08);
  } else if (assistantStyle === "concise") {
    scores.seriousness = clampUnit(scores.seriousness + 0.1);
  }
}

function chooseTone(scores) {
  if (scores.repair >= 0.45) {
    return scores.tenderness >= 0.45 ? "nervous-soft" : "nervous-serious";
  }
  if (scores.support >= 0.42) {
    return scores.tenderness >= 0.5 ? "soft-sad" : "soft";
  }
  if (scores.work >= 0.36 && scores.playful >= 0.25) {
    return "serious-playful";
  }
  if (scores.work >= 0.36 || scores.seriousness >= 0.42) {
    return "serious";
  }
  if (scores.creative >= 0.38) {
    return scores.playful >= 0.25 ? "playful-vivid" : "vivid";
  }
  if (scores.playful >= 0.28) {
    return "playful";
  }
  if (scores.intimacy >= 0.34 || scores.tenderness >= 0.34) {
    return "soft-affectionate";
  }
  return "steady";
}

function chooseIntensity(scores, tone) {
  const peak = getMaxScore(scores);
  if (scores.work >= 0.65 || scores.repair >= 0.45 || tone === "steady") {
    return peak >= 0.72 && scores.repair < 0.45 ? "medium" : "low";
  }
  if (scores.playful >= 0.55 || scores.creative >= 0.62) {
    return "high";
  }
  return peak >= 0.36 ? "medium" : "low";
}

function chooseIntimacy(scores, assistantStyle) {
  if (assistantStyle === "review" || scores.work >= 0.72 || scores.repair >= 0.5) {
    return scores.support >= 0.55 ? "familiar" : "reserved";
  }
  if (scores.support >= 0.5 || scores.intimacy >= 0.48) {
    return "close";
  }
  if (scores.playful >= 0.25 || scores.tenderness >= 0.28 || scores.creative >= 0.4) {
    return "familiar";
  }
  return "reserved";
}

function chooseExpressiveness(scores) {
  if (scores.work >= 0.68 || scores.repair >= 0.45) {
    return "contained";
  }
  if (scores.creative >= 0.5 || scores.playful >= 0.5) {
    return "vivid";
  }
  if (scores.support >= 0.35 || scores.intimacy >= 0.28 || scores.tenderness >= 0.28) {
    return "natural";
  }
  return "contained";
}

function buildGuidance(scores, tone) {
  const guidance = [];
  if (scores.work >= 0.35) {
    guidance.push("keep the answer practical and grounded in the task");
  }
  if (scores.support >= 0.34) {
    guidance.push("acknowledge the feeling before solving; keep advice gentle and optional");
  }
  if (scores.repair >= 0.34) {
    guidance.push("treat correction as calibration; do not become defensive or over-apologetic");
  }
  if (scores.playful >= 0.25 && scores.repair < 0.35) {
    guidance.push("allow light laughter or affectionate playfulness if it fits");
  }
  if (scores.creative >= 0.34) {
    guidance.push("allow more vivid, atmospheric phrasing");
  }
  if (scores.intimacy >= 0.3 || scores.tenderness >= 0.3) {
    guidance.push("avoid customer-service formality; sound naturally present");
  }
  if (tone === "steady" && guidance.length === 0) {
    guidance.push("stay natural and unobtrusive; do not perform emotion");
  }
  guidance.push("do not claim bodily feelings or inner states as facts");
  return uniqueStrings(guidance).slice(0, 5);
}

function normalizeItemsText(items) {
  return Array.isArray(items)
    ? items.map((item) => `${item?.text || ""} ${item?.axis || ""}`).join(" ")
    : "";
}

function getMaxScore(scores) {
  return Math.max(...Object.values(scores).map((value) => Number(value) || 0), 0);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function clampUnit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(1, number));
}

module.exports = {
  planExpressionPolicy,
  _test: {
    chooseTone,
    buildGuidance
  }
};
