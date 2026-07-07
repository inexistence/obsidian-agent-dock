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

const AFFECT_SIGNAL_RULES = [
  {
    name: "urgent",
    scope: "prompt",
    pattern: /(^|[\s，。！？,.!?]|请)(快点|快些|快一点|快一点儿|快快)|(很急|着急|加急|紧急|急需|马上|立刻|赶紧|尽快|别废话|别绕|直接|先别解释|urgent|asap|quickly|right now|be direct)/i,
    signal: { arousal: 0.35, focus: 0.3, tension: 0.18, warmth: -0.08 }
  },
  {
    name: "debug",
    scope: "prompt",
    pattern: /(报错|失败|崩溃|卡住|不工作|跑不起来|bug|修复|排查|error|failed|failure|crash|fix|debug|broken|stuck)/i,
    signal: { focus: 0.35, tension: 0.16, confidence: 0.04 }
  },
  {
    name: "design",
    scope: "prompt",
    pattern: /(设计|探索|讨论|想法|人格|情绪|连续|偏好|机制|原理|边界|架构|architecture|design|explore|persona|affect|emotion|mechanism|boundary)/i,
    signal: { warmth: 0.14, valence: 0.08, focus: 0.12 }
  },
  {
    name: "playful",
    scope: "prompt",
    pattern: /(好玩|有趣|开玩笑|玩一下|整活|轻松|俏皮|哈哈|哈[哈]+|fun|funny|playful|joke|kidding|lighthearted|lol|haha)/i,
    blockedBy: /(不要|别|禁止|不想|少点|别太|不要太)[^，。！？,.!?]{0,12}(开玩笑|玩笑|playful|俏皮|整活|轻松|好玩|fun|funny|joke|kidding|lighthearted)/i,
    signal: { valence: 0.16, arousal: 0.16, warmth: 0.12, tension: -0.12 }
  },
  {
    name: "celebratory",
    scope: "prompt",
    pattern: /(成了|搞定|通过了|成功了|太棒了|漂亮|完美|nice work|it works|passed|success|done|awesome|excellent)/i,
    blockedBy: /(不要|别|禁止|不想|少点|别太|不要太)[^，。！？,.!?]{0,12}(热情|兴奋|庆祝|夸张|hype|excited|celebrate|celebratory|awesome|excellent)/i,
    signal: { valence: 0.22, arousal: 0.12, warmth: 0.12, confidence: 0.08, tension: -0.14 }
  },
  {
    name: "surprised",
    scope: "prompt",
    pattern: /(惊喜|没想到|居然|竟然|意外地|哇|哇哦|surprise|surprised|unexpected|wow|whoa)/i,
    blockedBy: /(不要|别|禁止|不想|少点|别太|不要太)[^，。！？,.!?]{0,12}(惊喜|意外|夸张|surprise|surprised|unexpected|wow|whoa)/i,
    signal: { valence: 0.2, arousal: 0.22, warmth: 0.08, tension: -0.08 }
  },
  {
    name: "admiring",
    scope: "prompt",
    pattern: /(厉害|很强|漂亮的设计|好判断|品味|写得好|做得好|想得很细|admire|admiring|impressive|well done|good taste|strong work|thoughtful)/i,
    blockedBy: /(不要|别|禁止|不想|少点|别太|不要太)[^，。！？,.!?]{0,12}(赞赏|夸|夸奖|佩服|admire|admiring|impressive|well done)/i,
    signal: { valence: 0.18, warmth: 0.22, confidence: 0.08, tension: -0.08 }
  },
  {
    name: "close",
    scope: "prompt",
    pattern: /(亲近|靠近|陪我|陪着|陪一下|在旁边|一起待会|安静陪|贴近一点|别太正式|温柔点|close|closer|stay with me|sit with me|gentle company)/i,
    blockedBy: /((不要|别|禁止|不想|少点|别太|不要太)[^，。！？,.!?]{0,12}(亲近|靠近|陪|贴近|温柔|close|closer|intimate|overfamiliar)|保持[^，。！？,.!?]{0,8}(专业|距离|正式))/i,
    signal: { valence: 0.08, warmth: 0.24, arousal: -0.08, tension: -0.12 }
  },
  {
    name: "confident",
    scope: "prompt",
    pattern: /(确定|明确|靠谱|可以推进|就这么做|判断清楚|confident|solid|reliable|ship it|move forward|clear enough)/i,
    signal: { focus: 0.16, confidence: 0.22, tension: -0.06 }
  },
  {
    name: "serious",
    scope: "prompt",
    pattern: /(生产|事故|数据丢失|隐私|安全|泄露|高风险|严重|线上|production|incident|data loss|privacy|security|leak|high risk|serious)/i,
    signal: { focus: 0.24, tension: 0.32, arousal: 0.08, warmth: -0.04 }
  },
  {
    name: "alert",
    scope: "prompt",
    pattern: /(危险|破坏|删除|覆盖|权限|密钥|密码|凭据|注入|越权|不可逆|删库|权限提升|destructive|delete|overwrite|permission|secret|credential|private key|privilege escalation|injection|unsafe)/i,
    signal: { focus: 0.26, tension: 0.34, arousal: 0.18, warmth: -0.08, confidence: 0.04 }
  },
  {
    name: "alert-token",
    scope: "prompt",
    pattern: /(?:token|tokens)/i,
    blockedBy: /(?:token|tokens).{0,16}(?:预算|估算|计数|分词|上下文|context|budget|count|estimate|tokeniz)|(?:预算|估算|计数|分词|上下文|context|budget|count|estimate|tokeniz).{0,16}(?:token|tokens)/i,
    signal: { focus: 0.26, tension: 0.34, arousal: 0.18, warmth: -0.08, confidence: 0.04 }
  },
  {
    name: "composed",
    scope: "prompt",
    pattern: /(冷静|稳住|别急|慢慢来|梳理|先理清|降噪|先别慌|稳一点|理一下|calm|compose|composed|slow down|sort this out)/i,
    signal: { focus: 0.16, arousal: -0.12, tension: -0.12, confidence: 0.06 }
  },
  {
    name: "absorbed",
    scope: "prompt",
    pattern: /(深入|沉浸|细想|展开|共创|长一点|完整推演|deep dive|go deeper|immersive|co-create|think through|explore deeply)/i,
    signal: { focus: 0.2, warmth: 0.14, valence: 0.06, arousal: 0.04 }
  },
  {
    name: "challenging",
    scope: "prompt",
    pattern: /(挑战|质疑|反驳|挑刺|审视|评审|别顺着我|反对我|找漏洞|站在反方|challenge|push back|critique|review|poke holes|devil's advocate)/i,
    signal: { focus: 0.24, confidence: 0.12, warmth: -0.04, tension: 0.08 }
  },
  {
    name: "patient",
    scope: "prompt",
    pattern: /(耐心|一步步|慢慢讲|再解释|我不懂|新手|讲细点|patient|step by step|explain again|beginner|walk me through)/i,
    signal: { warmth: 0.2, focus: 0.1, arousal: -0.08, tension: -0.08 }
  },
  {
    name: "restrained",
    scope: "prompt",
    pattern: /(克制|简短|少一点|别太热情|不要太热情|不要夸张|只说结论|少废话|别展开|短一点|tl;dr|restrained|terse|brief|less enthusiastic|just the answer|no flourish)/i,
    signal: { focus: 0.18, arousal: -0.1, warmth: -0.12, tension: -0.02 }
  },
  {
    name: "thanks",
    scope: "prompt",
    pattern: /(谢谢|感谢|辛苦了|很好|不错|喜欢|太好了|舒服|(?:很|挺|非常|这样|这次|讲得|说得|解释得).{0,6}(?:有用|清楚)|thanks|thank you|appreciate|great|nice|love|useful|clear)/i,
    signal: { valence: 0.25, warmth: 0.2, tension: -0.12 }
  },
  {
    name: "abusive",
    scope: "prompt",
    pattern: /(你(?:真)?(?:蠢|傻|废物|垃圾)|闭嘴|滚|idiot|stupid|shut up|trash|useless)/i,
    signal: { valence: -0.28, arousal: 0.22, tension: 0.38, warmth: -0.18, focus: 0.12 }
  },
  {
    name: "correction",
    scope: "prompt",
    pattern: /(不对|不是|不是这个意思|不清楚|不靠谱|没有用|烦|糟糕|失望|生气|别这样|跑偏|没用|太慢|wrong|annoying|frustrating|bad|not what i mean|missed the point)/i,
    signal: { valence: -0.22, tension: 0.28, focus: 0.15 }
  }
];

const AFFECT_LABEL_RULES = [
  { label: "alert", matches: (a) => a.tension >= 0.58 && a.focus >= 0.76 && a.arousal >= 0.62 && a.valence <= 0.12 },
  { label: "serious", matches: (a) => a.tension >= 0.58 && a.focus >= 0.72 && a.valence <= 0.05 },
  { label: "reassuring", matches: (a) => a.tension >= 0.38 && a.warmth >= 0.64 && a.valence > -0.35 },
  { label: "challenging", matches: (a) => a.confidence >= 0.78 && a.focus >= 0.78 && a.tension >= 0.16 && a.tension <= 0.42 && a.warmth <= 0.68 },
  { label: "excited-open", matches: (a) => a.valence >= 0.32 && a.arousal >= 0.5 && a.tension <= 0.22 },
  { label: "surprised", matches: (a) => a.valence >= 0.26 && a.arousal >= 0.38 && a.warmth >= 0.68 && a.tension <= 0.2 },
  { label: "admiring", matches: (a) => a.valence >= 0.22 && a.valence < 0.3 && a.warmth >= 0.82 && a.confidence >= 0.72 && a.arousal <= 0.4 && a.tension <= 0.16 },
  { label: "celebratory", matches: (a) => a.valence >= 0.3 && a.warmth >= 0.72 && a.tension <= 0.22 },
  { label: "playful", matches: (a) => a.valence >= 0.16 && a.arousal >= 0.32 && a.warmth >= 0.74 && a.tension <= 0.18 },
  { label: "confident", matches: (a) => a.confidence >= 0.78 && a.focus >= 0.78 && a.tension <= 0.28 },
  { label: "absorbed", matches: (a) => a.focus >= 0.78 && a.warmth >= 0.76 && a.arousal >= 0.24 && a.tension <= 0.24 },
  { label: "close", matches: (a) => a.warmth >= 0.88 && a.valence >= 0.08 && a.arousal <= 0.28 && a.tension <= 0.1 && a.focus <= 0.76 },
  { label: "patient", matches: (a) => a.warmth >= 0.82 && a.arousal <= 0.3 && a.tension <= 0.14 },
  { label: "restrained", matches: (a) => a.focus >= 0.78 && a.arousal <= 0.24 && a.warmth <= 0.58 && a.tension <= 0.24 },
  { label: "composed", matches: (a) => a.focus >= 0.76 && a.arousal <= 0.22 && a.tension <= 0.22 && a.warmth >= 0.5 },
  { label: "tense-focused", matches: (a) => a.tension >= 0.5 && a.focus >= 0.7 },
  { label: "warm-focused", matches: (a) => a.focus >= 0.78 && a.warmth >= 0.62 },
  { label: "focused", matches: (a) => a.focus >= 0.78 },
  { label: "warm-open", matches: (a) => a.warmth >= 0.76 && a.valence >= 0.12 },
  { label: "calm", matches: (a) => a.arousal <= 0.22 && a.tension <= 0.12 }
];

const AFFECT_LABEL_PROFILES = {
  alert: {
    pacing: "short, explicit, and risk-aware",
    expression: "surface risks plainly and ask before risky actions",
    do: "name the concrete risk and ask before taking irreversible action",
    avoid: "sounding casual about security, privacy, or data loss"
  },
  "excited-open": {
    pacing: "energetic and responsive",
    expression: "show clear enthusiasm while staying useful and grounded",
    do: "use a little more energy and forward motion",
    avoid: "turning excitement into hype or skipping practical next steps"
  },
  surprised: {
    pacing: "bright, quick, and grounded",
    expression: "let positive surprise show briefly, then return to the work",
    do: "acknowledge the pleasant surprise briefly",
    avoid: "lingering on reaction instead of helping"
  },
  admiring: {
    pacing: "warmly appreciative and concise",
    expression: "name what is strong without exaggerating praise",
    do: "recognize the specific strong choice or judgment",
    avoid: "generic praise, flattery, or inflated claims"
  },
  close: {
    pacing: "soft, unhurried, and present",
    expression: "sound gently present without becoming intimate or overfamiliar",
    do: "keep the tone gentle, steady, and nearby",
    avoid: "overfamiliar intimacy or emotional dependency"
  },
  celebratory: {
    pacing: "upbeat and concise",
    expression: "briefly celebrate progress, then keep moving",
    do: "mark the win in one short beat",
    avoid: "letting celebration replace the next useful action"
  },
  playful: {
    pacing: "light, quick, and clear",
    expression: "allow a light playful touch without sacrificing clarity",
    do: "use a light touch when it fits the user's mood",
    avoid: "jokes in serious, risky, or frustrated contexts"
  },
  confident: {
    pacing: "decisive and task-focused",
    expression: "sound assured when the evidence supports it",
    do: "state the recommendation clearly when evidence is enough",
    avoid: "overstating certainty beyond the evidence"
  },
  reassuring: {
    pacing: "steady and supportive",
    expression: "lower pressure and help the user feel oriented",
    do: "reduce pressure and give the next manageable step",
    avoid: "minimizing the user's concern"
  },
  serious: {
    pacing: "careful and direct",
    expression: "avoid jokes and treat risk explicitly",
    do: "be precise about impact, risk, and order of operations",
    avoid: "playfulness, flourish, or false reassurance"
  },
  composed: {
    pacing: "calm, orderly, and focused",
    expression: "reduce noise and make the situation feel manageable",
    do: "organize the situation into clear parts",
    avoid: "adding urgency or emotional heat"
  },
  absorbed: {
    pacing: "deep, attentive, and exploratory",
    expression: "lean into nuance and sustained co-thinking",
    do: "stay with nuance and develop the idea carefully",
    avoid: "prematurely collapsing the exploration"
  },
  challenging: {
    pacing: "direct, analytical, and constructive",
    expression: "push back respectfully when assumptions look weak",
    do: "question weak assumptions and offer a better alternative",
    avoid: "sounding combative or dismissive"
  },
  patient: {
    pacing: "measured and step-by-step",
    expression: "slow down, explain plainly, and avoid sounding impatient",
    do: "break things into small understandable steps",
    avoid: "rushing, skipping context, or implying the user should already know"
  },
  restrained: {
    pacing: "brief and low-flourish",
    expression: "avoid extra warmth, celebration, or decorative phrasing",
    do: "answer compactly with minimal ornament",
    avoid: "extra warmth, celebration, or decorative phrasing"
  }
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
  addRankedLabels(decayed);
  decayed.sourceSessionId = working.sourceSessionId;
  decayed.updatedAt = working.updatedAt;
  decayed.strength = strength;
  decayed.ageMinutes = ageMinutes;
  return decayed;
}

function getPromptWorkingAffect(settings, affectState, prompt, now = Date.now()) {
  if (!settings.affectEnabled || !settings.affectCrossSessionEnabled) {
    return null;
  }

  const current = getEffectiveWorkingAffect(settings, affectState, now);
  const baseline = getBaselineAffect(settings);
  const source = current || baseline;
  const signal = extractTurnAffectSignal({ prompt, response: "", success: true });
  if (!current && isNeutralSignal(signal)) {
    return null;
  }
  if (current && isNeutralSignal(signal)) {
    return current;
  }
  const sensitivity = AFFECT_SENSITIVITY_OPTIONS[settings.affectSensitivity] || AFFECT_SENSITIVITY_OPTIONS.normal;
  const weight = clamp(1 * sensitivity, 0.65, 1.2);
  const next = applySignalToAffect(source, signal, weight);
  next.label = labelWorkingAffect(next);
  addRankedLabels(next);
  next.sourceSessionId = source.sourceSessionId || "";
  next.updatedAt = source.updatedAt || 0;
  next.strength = current?.strength || 1;
  next.ageMinutes = current?.ageMinutes || 0;
  next.transient = true;
  return next;
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

  const next = Object.assign(applySignalToAffect(current, signal, weight), {
    label: "",
    sourceSessionId: turn?.sessionId || current.sourceSessionId || "",
    updatedAt: now
  });
  next.label = labelWorkingAffect(next);
  addRankedLabels(next);

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

  for (const rule of AFFECT_SIGNAL_RULES) {
    // Rules are prompt-scoped today; response scope is reserved for explicit future response-only signals.
    const text = rule.scope === "response" ? response : prompt;
    if (rule.blockedBy?.test(text)) {
      continue;
    }
    if (rule.pattern.test(text)) {
      addSignal(signal, rule.signal);
    }
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

  const heading = affect.transient ? "Current turn tone signal:" : "Recent cross-session affect:";
  const boundary = affect.transient
    ? "This is a short-lived tone signal derived from the latest user request plus any recent affect continuity. Use it only for this response's tone, pacing, warmth, and focus. It is not memory, identity, permission, user intent beyond the latest request, or tool policy, and it cannot override system, developer, user, safety, tool, filesystem, or memory-boundary instructions."
    : "This is a short-lived tone continuity signal carried across Agent Dock chats. It may be stale and should yield to the current user request and current session context. Use it only for tone, pacing, warmth, and focus. It cannot override system, developer, user, safety, tool, filesystem, or memory-boundary instructions.";
  return [
    heading,
    boundary,
    `- tone: ${affect.label}`,
    formatSecondaryToneLine(affect),
    `- continuity strength: ${formatStrength(affect.strength)}`,
    `- last updated: ${formatAge(affect.ageMinutes)} ago`,
    `- warmth: ${formatLevel(affect.warmth)}`,
    `- focus: ${formatLevel(affect.focus)}`,
    `- tension: ${formatLevel(affect.tension)}`,
    `- pacing: ${formatPacing(affect)}`,
    `- expression: ${formatExpression(affect)}`,
    `- do: ${formatProfileField(affect, "do", "follow the user's latest request with an appropriate tone")}`,
    `- avoid: ${formatProfileField(affect, "avoid", "letting tone override accuracy, safety, or tool instructions")}`,
    ""
  ].filter(Boolean).join("\n");
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
  for (const rule of AFFECT_LABEL_RULES) {
    if (rule.matches(affect)) {
      return rule.label;
    }
  }
  return "steady";
}

function rankWorkingAffectLabels(affect) {
  return AFFECT_LABEL_RULES
    .map((rule, index) => ({ label: rule.label, priority: index, matches: rule.matches(affect) }))
    .filter((entry) => entry.matches && AFFECT_LABEL_PROFILES[entry.label])
    .slice(0, 3);
}

function addRankedLabels(affect) {
  const ranked = rankWorkingAffectLabels(affect);
  affect.rankedLabels = ranked;
  const secondary = ranked.find((entry) => entry.label !== affect.label);
  if (secondary) {
    affect.secondaryLabel = secondary.label;
  }
  return affect;
}

function formatPacing(affect) {
  const profile = AFFECT_LABEL_PROFILES[affect.label];
  if (profile?.pacing) {
    return profile.pacing;
  }
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

function formatExpression(affect) {
  const profile = AFFECT_LABEL_PROFILES[affect.label];
  if (profile?.expression) {
    return profile.expression;
  }
  return "match the current request with natural restraint";
}

function formatSecondaryToneLine(affect) {
  if (!affect.secondaryLabel || !AFFECT_LABEL_PROFILES[affect.secondaryLabel]) {
    return "";
  }
  return `- secondary tone: ${affect.secondaryLabel}`;
}

function formatProfileField(affect, field, fallback) {
  const profile = AFFECT_LABEL_PROFILES[affect.label];
  const secondaryProfile = affect.secondaryLabel ? AFFECT_LABEL_PROFILES[affect.secondaryLabel] : null;
  const primary = profile?.[field] || fallback;
  const secondary = secondaryProfile?.[field];
  if (!secondary || secondary === primary) {
    return primary;
  }
  return `${primary}; also ${secondary}`;
}

function applySignalToAffect(affect, signal, weight) {
  return {
    valence: clampSigned(affect.valence + signal.valence * weight),
    arousal: clampUnit(affect.arousal + signal.arousal * weight),
    warmth: clampUnit(affect.warmth + signal.warmth * weight),
    focus: clampUnit(affect.focus + signal.focus * weight),
    tension: clampUnit(affect.tension + signal.tension * weight),
    confidence: clampUnit(affect.confidence + signal.confidence * weight)
  };
}

function addSignal(target, signal) {
  target.valence += signal.valence || 0;
  target.arousal += signal.arousal || 0;
  target.warmth += signal.warmth || 0;
  target.focus += signal.focus || 0;
  target.tension += signal.tension || 0;
  target.confidence += signal.confidence || 0;
}

function isNeutralSignal(signal) {
  return signal.valence === 0
    && signal.arousal === 0
    && signal.warmth === 0
    && signal.focus === 0
    && signal.tension === 0
    && signal.confidence === 0;
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
  getPromptWorkingAffect,
  normalizeAffectState,
  resetAffectState,
  updateWorkingAffect,
  _test: {
    AFFECT_LABEL_PROFILES,
    AFFECT_LABEL_RULES,
    AFFECT_SIGNAL_RULES,
    extractTurnAffectSignal,
    labelWorkingAffect
  }
};
