const SIGNAL_KEYS = [
  "work",
  "support",
  "creative",
  "repair",
  "playful",
  "intimacy",
  "seriousness",
  "tenderness"
];

const SIGNAL_RULES = [
  {
    key: "work",
    weight: 0.38,
    patterns: [/代码|实现|测试|架构|设计方案|review|bug|修复|模块|接口|提交|commit|PR|验收|落地/, /\b(code|implement|test|architecture|review|bug|module|interface|commit|pull request|ship|debug)\b/i]
  },
  {
    key: "support",
    weight: 0.46,
    patterns: [/难过|伤心|崩溃|压力|好累|委屈|焦虑|不想干|撑不住|失望|孤独|害怕/, /\b(sad|upset|overwhelmed|stressed|exhausted|anxious|lonely|scared|disappointed)\b/i]
  },
  {
    key: "creative",
    weight: 0.4,
    patterns: [/写作|故事|诗|审美|氛围|灵感|想象|角色|画面感|文案|创作/, /\b(write|story|poem|aesthetic|atmosphere|inspiration|imagine|character|creative|copy)\b/i]
  },
  {
    key: "repair",
    weight: 0.5,
    patterns: [/不对|不是这个意思|跑偏|误解|没抓住|语气不对|太像客服|太抽象|太啰嗦|别撒娇|别端着/, /\b(wrong|not what i mean|misread|missed the point|tone feels off|too formal|too abstract|too verbose)\b/i]
  },
  {
    key: "playful",
    weight: 0.32,
    patterns: [/哈哈|笑死|离谱|好玩|撒娇|可爱|逗|开玩笑|嘿嘿|哼哼/, /\bhaha+\b|\blol\b|\bfunny\b|\bplayful\b|\bcute\b|\bjoking\b/i]
  },
  {
    key: "intimacy",
    weight: 0.28,
    patterns: [/陪我|抱抱|靠近|亲近|生活|随便聊|聊聊|你可以.*表达|像一个人/, /\bwith me|stay with me|close|intimate|just chat|like a person\b/i]
  },
  {
    key: "seriousness",
    weight: 0.3,
    patterns: [/认真|严肃|直接判断|别玩笑|工作时|靠谱|仔细|慎重/, /\bserious|careful|reliable|work mode|no jokes|make the call\b/i]
  },
  {
    key: "tenderness",
    weight: 0.34,
    patterns: [/温柔|柔软|细腻|难过|安静陪|接住|慢一点|不要急着建议/, /\bsoft|gentle|tender|hold this|slow down|listen first\b/i]
  }
];

function extractExpressionSignals(input = {}) {
  const prompt = compactText(input.prompt);
  const conversationText = compactText(input.conversationText);
  const scores = createEmptyScores();
  const matched = [];

  for (const rule of SIGNAL_RULES) {
    const promptCount = countMatches(prompt, rule.patterns);
    const conversationCount = countMatches(conversationText, rule.patterns);
    if (promptCount + conversationCount <= 0) {
      continue;
    }
    const weightedCount = promptCount + conversationCount * 0.35;
    scores[rule.key] = clampUnit(scores[rule.key] + rule.weight * Math.min(1, weightedCount) + Math.max(0, weightedCount - 1) * 0.1);
    matched.push(rule.key);
  }

  applyCrossSignalBias(scores);

  return {
    scores,
    matched: uniqueStrings(matched),
    confidence: getConfidence(scores)
  };
}

function countMatches(text, patterns) {
  if (!text) {
    return 0;
  }
  return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}

function applyCrossSignalBias(scores) {
  if (scores.support > 0) {
    scores.tenderness = clampUnit(scores.tenderness + scores.support * 0.45);
    scores.intimacy = clampUnit(scores.intimacy + scores.support * 0.18);
  }
  if (scores.work > 0) {
    scores.seriousness = clampUnit(scores.seriousness + scores.work * 0.42);
  }
  if (scores.repair > 0) {
    scores.seriousness = clampUnit(scores.seriousness + scores.repair * 0.28);
    scores.playful = Math.min(scores.playful, 0.18);
  }
  if (scores.playful > 0 && scores.work > 0) {
    scores.playful = Math.min(0.55, scores.playful);
  }
}

function getConfidence(scores) {
  return Math.max(...SIGNAL_KEYS.map((key) => Number(scores[key]) || 0), 0);
}

function createEmptyScores() {
  return SIGNAL_KEYS.reduce((scores, key) => {
    scores[key] = 0;
    return scores;
  }, {});
}

function uniqueStrings(values) {
  return [...new Set(values.map(compactText).filter(Boolean))];
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampUnit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(1, number));
}

module.exports = {
  extractExpressionSignals,
  _test: {
    SIGNAL_KEYS,
    applyCrossSignalBias
  }
};
