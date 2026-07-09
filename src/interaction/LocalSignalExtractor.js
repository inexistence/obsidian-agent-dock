const { containsSensitiveText, redactSensitiveText } = require("../storage/sensitiveText");

const MAX_EXCERPT_CHARS = 220;

const CONTEXT_RULES = [
  {
    id: "agent_continuity",
    patterns: [/AI|agent|助手|智能体/i, /profile|memory|记忆|连续性|情绪|affect/i, /自然生长|设定|人设|人格|主体感/]
  },
  {
    id: "implementation",
    patterns: [/代码|模块|接口|数据模型|测试|脚本|设置页|prompt|store|reducer|extractor/i, /\b(code|module|interface|schema|test|script|prompt|store|reducer|extractor)\b/i]
  },
  {
    id: "debugging",
    patterns: [/报错|失败|崩溃|bug|修复|排查/, /\b(error|failed|failure|crash|fix|debug)\b/i]
  },
  {
    id: "planning",
    patterns: [/计划|规划|任务|TODO|今日|工作流/, /\b(plan|todo|workflow|task)\b/i]
  }
];

const USER_SIGNAL_RULES = [
  {
    id: "asks_for_judgment",
    strong: [/你怎么看/, /你的判断/, /你觉得/, /你建议/, /给个结论/, /你来拍板/, /你来决定/, /帮我判断/, /不要只列选项/, /你判断/, /你来定/, /\b(your take|what do you think|recommend|decide|don't just agree|make the call)\b/i],
    weak: [/判断/, /建议/, /结论/, /取舍/],
    blockedBy: [/不要.*判断/, /不用.*建议/, /先别.*结论/]
  },
  {
    id: "asks_for_mechanism",
    strong: [/机制/, /原理/, /为什么/, /边界/, /取舍/, /怎么理解/, /怎么做到/, /背后逻辑/, /底层逻辑/, /\b(mechanism|principle|why|boundary|tradeoff|how exactly|under the hood)\b/i],
    weak: [/逻辑/, /原因/, /区别/, /关系/, /本质/],
    blockedBy: [/不用.*解释/, /不要.*原理/, /先别.*机制/]
  },
  {
    id: "asks_for_implementation",
    strong: [/具体/, /可实施/, /可执行/, /落地/, /实现/, /数据模型/, /任务拆分/, /验收标准/, /怎么做/, /接入/, /改代码/, /\b(concrete|specific|implementation|actionable|schema|task|wire it|code change)\b/i],
    weak: [/方案/, /步骤/, /清单/, /路径/, /计划/],
    blockedBy: [/先不.*实现/, /不用.*代码/, /不要.*任务/]
  },
  {
    id: "asks_for_redesign",
    strong: [/重新设计/, /重构/, /完全重新/, /如果不考虑现有/, /推倒重来/, /\b(redesign|rebuild|refactor|from scratch|start over)\b/i],
    weak: [/换个方案/, /另一种设计/]
  },
  {
    id: "pushes_for_nuance",
    strong: [/微妙/, /细腻/, /分寸/, /纹理/, /不是.*硬规则/, /不要.*压成/, /不能.*压成/, /像人类/, /不要.*扁平/, /\b(nuance|subtle|texture|not.*rigid|flatten|not.*mechanical)\b/i],
    weak: [/复杂/, /自然/, /风格/, /气质/, /手感/],
    contexts: ["agent_continuity", "implementation", "general"],
    blockedBy: [/不用.*微妙/, /不要.*复杂/, /简单点/, /别.*细腻/]
  },
  {
    id: "rejects_flattening",
    strong: [/压扁/, /压成/, /太.*规则/, /具体的要求prompt/, /偏好清单/, /设置项/, /硬编码/, /模板化/, /\b(flatten|rigid prompt|preference list|settings-only|too mechanical)\b/i],
    weak: [/规则/, /清单/, /设置/],
    blockedBy: [/可以.*规则/, /就.*清单/, /只要.*设置/]
  },
  {
    id: "asks_about_cost",
    strong: [/token/, /成本/, /消耗/, /太贵/, /预算/, /缓存/, /每轮.*总结/, /\b(cost|expensive|budget|tokens?|cache)\b/i],
    weak: [/省/, /轻量/, /低频/]
  },
  {
    id: "asks_for_directness",
    strong: [/直接说/, /别废话/, /简短/, /先给结论/, /长话短说/, /不用铺垫/, /\b(brief|direct|tl;dr|short answer|cut to the chase)\b/i],
    weak: [/快点/, /短一点/],
    blockedBy: [/不要.*太短/, /别.*省略/]
  },
  {
    id: "asks_for_depth",
    strong: [/展开/, /详细/, /讲透/, /多解释/, /完整一点/, /深入/, /细说/, /\b(explain more|go deeper|full detail|walk me through|deep dive)\b/i],
    weak: [/补充/, /再说说/, /多一点/],
    blockedBy: [/不用.*展开/, /别.*太长/]
  },
  {
    id: "asks_for_clarification",
    strong: [/没懂/, /什么意思/, /说清楚/, /举例/, /例子/, /换个说法/, /具体区别/, /还是不明白/, /\b(what do you mean|not clear|unclear|example|for example|can you clarify|say that differently)\b/i],
    weak: [/不明白/, /看不懂/, /解释一下/],
    blockedBy: [/不用.*举例/, /不用.*解释/]
  },
  {
    id: "style_feedback",
    strong: [/太(?:啰嗦|官方|像客服|生硬|机械|短|长|冷|热情)/, /别(?:这么|太).*(?:啰嗦|官方|客服|生硬|机械)/, /语气/, /风格不对/, /\b(too verbose|too formal|too robotic|too terse|tone|style feels off)\b/i]
  },
  {
    id: "positive_feedback",
    strong: [/这样(?:很好|不错|可以|对)/, /对[，,\s]*(?:就是|是这个|这个方向)/, /继续(?:这样|这个方向)/, /到位/, /说得对/, /这个方向可以/, /\b(exactly|that's it|useful|clear|solid|keep going|nailed it)\b/i],
    blockedBy: [/不对/, /不是.*对/, /没.*清楚/]
  },
  {
    id: "negative_feedback",
    strong: [/不对/, /不是(?:这个|这样|我的意思)/, /太(?:空|泛|虚|啰嗦|官方|像客服)/, /没有(?:回答|解决|落地)/, /跑偏了/, /没抓住重点/, /误解了/, /不是我要的/, /\b(wrong|not what i mean|too vague|missed the point|not useful|misread)\b/i]
  }
];

const CONTINUATION_PATTERNS = [
  /继续/,
  /刚才/,
  /上面/,
  /这个/,
  /这点/,
  /那/,
  /所以/,
  /也就是说/,
  /换句话说/,
  /\b(continue|that|this|above|previous|so|then)\b/i
];

const ASSISTANT_SHAPE_RULES = [
  {
    id: "implementation_plan",
    strong: [/数据模型/, /接入/, /任务拆分/, /验收标准/, /实现/, /测试/, /落地/, /\b(schema|implementation|test|task|wire|module|concrete steps)\b/i]
  },
  {
    id: "mechanism_explanation",
    strong: [/机制/, /边界/, /取舍/, /原因/, /归纳/, /衰减/, /证据/, /\b(mechanism|boundary|tradeoff|reason|evidence|principle)\b/i]
  },
  {
    id: "independent_judgment",
    strong: [/我会/, /我建议/, /我的判断/, /更合理/, /不建议/, /我倾向/, /\b(i would|i recommend|my take|better|avoid|i'd choose)\b/i]
  },
  {
    id: "settings_framing",
    strong: [/设置/, /开关/, /选项/, /\b(settings|toggle|option)\b/i]
  },
  {
    id: "repair_response",
    strong: [/我理解错了/, /我修正/, /改一下/, /重新来/, /\b(i misread|let me correct|revise)\b/i]
  },
  {
    id: "warm_presence",
    strong: [/一起/, /陪你/, /我在/, /我们可以/, /\b(with you|together|we can)\b/i]
  }
];

function extractEpisodeDraft(turn, previousPending) {
  const prompt = compactText(turn?.prompt);
  const response = compactText(turn?.response);
  const reaction = previousPending
    ? classifyReaction(previousPending, prompt)
    : null;

  return {
    context: classifyContext(prompt),
    userExcerpt: sanitizeExcerpt(prompt),
    assistantExcerpt: sanitizeExcerpt(response),
    userSignals: extractSignals(prompt, USER_SIGNAL_RULES),
    assistantShape: extractSignals(response, ASSISTANT_SHAPE_RULES),
    reaction,
    outcomeHint: reaction?.outcomeHint || "",
    sourceSessionId: turn?.sessionId || "",
    createdAt: Number(turn?.now) || Date.now()
  };
}

function buildPromptInteractionContext(prompt, conversation) {
  const conversationText = Array.isArray(conversation)
    ? conversation.slice(-8).map((message) => compactText(message?.content)).filter(Boolean).join("\n")
    : "";
  return {
    context: classifyContext(prompt),
    signals: extractSignals(prompt, USER_SIGNAL_RULES),
    conversationText
  };
}

function classifyReaction(previousPending, prompt) {
  const signals = extractSignals(prompt, USER_SIGNAL_RULES);
  const context = classifyContext(prompt);
  const sharedSignal = hasSharedSignal(previousPending.userSignals, signals);
  const sameContext = previousPending.context === context;
  const explicitContinuation = matches(prompt, CONTINUATION_PATTERNS);
  let kind = "topic_shift";
  let outcomeHint = "topic_shift";

  if (signals.includes("negative_feedback")) {
    kind = "correction";
    outcomeHint = "correction";
    if (signals.includes("style_feedback")) {
      kind = "style_recalibration";
      outcomeHint = "style_recalibration";
    }
  } else if (signals.includes("style_feedback")) {
    kind = "style_recalibration";
    outcomeHint = "style_recalibration";
  } else if (signals.includes("asks_for_clarification")) {
    kind = "clarification";
    outcomeHint = "clarification_requested";
  } else if (signals.includes("positive_feedback")) {
    kind = "acceptance";
    outcomeHint = "accepted";
  } else if (signals.includes("asks_for_implementation") && previousPending.assistantShape?.includes("mechanism_explanation")) {
    kind = "implementation_followup";
    outcomeHint = "implementation_followup";
  } else if (sameContext && (sharedSignal || explicitContinuation)) {
    kind = "deepening";
    outcomeHint = "productive_deepening";
  } else if (!sameContext || signals.length > 0) {
    kind = "new_request";
    outcomeHint = "new_request";
  }

  return {
    kind,
    outcomeHint,
    excerpt: sanitizeExcerpt(prompt),
    signals
  };
}

function classifyContext(text) {
  const compact = compactText(text);
  for (const rule of CONTEXT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(compact))) {
      return rule.id;
    }
  }
  return "general";
}

function extractSignals(text, rules) {
  const compact = compactText(text);
  if (!compact) {
    return [];
  }
  const context = classifyContext(compact);
  return rules
    .filter((rule) => matchesRule(compact, rule, context))
    .map((rule) => rule.id);
}

function matchesRule(text, rule, context) {
  if (rule.blockedBy?.some((pattern) => pattern.test(text))) {
    return false;
  }
  if (rule.strong?.some((pattern) => pattern.test(text))) {
    return true;
  }
  const weakMatch = rule.weak?.some((pattern) => pattern.test(text));
  if (!weakMatch) {
    return false;
  }
  if (!rule.contexts || rule.contexts.includes(context)) {
    return true;
  }
  return false;
}

function hasSharedSignal(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  return left.some((signal) => right.includes(signal));
}

function matches(text, patterns) {
  const compact = compactText(text);
  return patterns.some((pattern) => pattern.test(compact));
}

function sanitizeExcerpt(text) {
  const compact = truncateText(compactText(text), MAX_EXCERPT_CHARS);
  if (!compact) {
    return "";
  }
  return redactSensitiveText(compact);
}

function isSensitiveEpisode(episode) {
  return containsSensitiveText(episode.userExcerpt)
    || containsSensitiveText(episode.assistantExcerpt)
    || containsSensitiveText(episode.reaction?.excerpt);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

module.exports = {
  extractEpisodeDraft,
  buildPromptInteractionContext,
  classifyContext,
  extractSignals,
  isSensitiveEpisode,
  sanitizeExcerpt,
  _test: {
    classifyReaction,
    CONTINUATION_PATTERNS,
    matchesRule,
    USER_SIGNAL_RULES,
    ASSISTANT_SHAPE_RULES
  }
};
