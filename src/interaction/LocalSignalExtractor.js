const { containsSensitiveText, redactSensitiveText } = require("../storage/sensitiveText");
const {
  hasGroundedAgentSignal,
  hasExactVisibleSignalEvidence,
  mergeSignalEvidenceContexts,
  normalizeAgentDockSignals
} = require("../agents/shared/signalEvidence");
const { normalizeAiPatternCandidate } = require("./InteractionPatternCandidates");

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
  },
  {
    id: "repair_trigger_misread",
    strong: [/不是(?:这个|这样|我的意思)/, /你误解了/, /没抓住重点/, /跑偏了/, /\b(not what i mean|misread|missed the point|wrong direction)\b/i]
  },
  {
    id: "repair_trigger_too_flat",
    strong: [/压扁/, /压成/, /太(?:空|泛|虚|抽象)/, /泛泛而谈/, /别(?:压扁|压成)/, /不要.*(?:硬规则|偏好清单|模板化)/, /\b(too vague|too abstract|flatten|too mechanical|rigid)\b/i]
  },
  {
    id: "repair_trigger_too_verbose",
    strong: [/太(?:啰嗦|长|废话)/, /别废话/, /不用铺垫/, /\b(too verbose|too long|cut to the chase)\b/i]
  },
  {
    id: "repair_trigger_style_mismatch",
    strong: [/太像客服/, /语气不对/, /太(?:官方|生硬|机械|冷|热情)/, /风格不对/, /\b(too formal|too robotic|tone feels off|style feels off)\b/i]
  },
  {
    id: "repair_acceptance",
    strong: [/对[，,\s]*(?:就是|是这个|这个方向)/, /这个方向(?:可以|对了)/, /这样(?:更对|很好|可以)/, /继续(?:这样|这个方向)/, /抓住了/, /\b(exactly|that's it|this direction works|keep going with this|now you got it)\b/i]
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
    id: "restated_intent",
    strong: [/你的意思是/, /我理解你的意思/, /换句话说/, /你要的不是.*而是/, /\b(what you mean is|if i understand|in other words|you're asking for)\b/i]
  },
  {
    id: "became_concrete",
    strong: [/具体/, /落地/, /实现/, /数据模型/, /接口/, /任务/, /验收/, /测试/, /\b(concrete|implementation|schema|interface|tasks|acceptance|tests?)\b/i]
  },
  {
    id: "became_shorter",
    strong: [/简短/, /直接/, /先给结论/, /\b(short version|briefly|directly|bottom line)\b/i]
  },
  {
    id: "became_deeper",
    strong: [/展开/, /深入/, /机制/, /取舍/, /边界/, /\b(deeper|mechanism|tradeoff|boundary)\b/i]
  },
  {
    id: "softened_tone",
    strong: [/抱歉/, /我理解/, /温和/, /不防御/, /校准/, /\b(sorry|you're right|calibrate|without defensiveness)\b/i]
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
  const context = classifyContext(prompt);
  const userSignals = extractSignals(prompt, USER_SIGNAL_RULES);
  const interactionHints = extractInteractionSignalHints(
    turn?.agentDockSignals,
    mergeSignalEvidenceContexts(
      turn?.signalEvidenceContext,
      { user_message: prompt, assistant_message: response }
    )
  );
  const assistantShape = uniqueStrings(
    extractSignals(response, ASSISTANT_SHAPE_RULES).concat(interactionHints.shapes)
  );
  const repairPath = createRepairPath(userSignals, assistantShape, reaction);
  const eventWeight = Math.min(1, calculateEventWeight({
    context,
    userSignals,
    assistantShape,
    reaction,
    repairPath
  }) + interactionHints.weight);

  return {
    context,
    phase: classifyPhase(context, userSignals, assistantShape, reaction, repairPath),
    userExcerpt: sanitizeExcerpt(prompt),
    assistantExcerpt: sanitizeExcerpt(response),
    userSignals,
    assistantShape,
    aiReflectionContribution: interactionHints.contribution,
    reaction,
    repairPath,
    eventWeight,
    memoryRole: classifyMemoryRole(eventWeight, repairPath, userSignals),
    outcomeHint: reaction?.outcomeHint || "",
    sourceSessionId: turn?.sessionId || "",
    createdAt: Number(turn?.now) || Date.now()
  };
}

function extractInteractionSignalHints(signals, evidenceContextOrPrompt, response = "") {
  const result = {
    shapes: [],
    weight: 0,
    summaries: [],
    confidence: 0,
    patternCandidate: null,
    contribution: null
  };
  for (const signal of normalizeAgentDockSignals(signals)) {
    if (signal.type !== "interaction_candidate") {
      continue;
    }
    if (signal.phase === "appraisal") {
      continue;
    }
    if (!hasGroundedAgentSignal(signal, evidenceContextOrPrompt, response)) {
      continue;
    }
    result.shapes.push(...normalizeStringArray(signal.shapes));
    const confidence = Math.max(0, Math.min(1, Number(signal.confidence) || 0.6));
    result.weight = Math.max(result.weight, Math.min(0.08, confidence * 0.08));
    result.confidence = Math.max(result.confidence, confidence);
    const summary = sanitizeExcerpt(signal.text);
    if (summary) {
      result.summaries.push(summary);
    }
    if (signal.patternCandidate && hasGroundedUserEvidence(signal, evidenceContextOrPrompt)) {
      result.patternCandidate = normalizeAiPatternCandidate(Object.assign({}, signal.patternCandidate, {
        evidenceOrigin: "user_message"
      }));
    }
  }
  result.shapes = uniqueStrings(result.shapes).slice(0, 3);
  if (result.shapes.length > 0 || result.patternCandidate) {
    result.contribution = {
      source: "ai_outcome_reflection",
      summary: uniqueStrings(result.summaries).slice(0, 2).join(" | "),
      shapes: result.shapes,
      confidence: result.confidence,
      weight: result.weight,
      validation: "grounded_visible_evidence",
      patternCandidate: result.patternCandidate
    };
  }
  return result;
}

function hasGroundedUserEvidence(signal, evidenceContextOrPrompt) {
  const userMessage = evidenceContextOrPrompt && typeof evidenceContextOrPrompt === "object"
    ? evidenceContextOrPrompt.user_message
    : evidenceContextOrPrompt;
  const evidenceQuote = compactText(signal?.patternCandidate?.evidenceQuote);
  if (!evidenceQuote || !hasExactVisibleSignalEvidence(evidenceQuote, userMessage)) {
    return false;
  }
  return (Array.isArray(signal?.evidenceRefs) ? signal.evidenceRefs : [])
    .some((item) => (
      item?.origin === "user_message"
      && item?.speaker === "user"
      && compactText(item?.quote) === evidenceQuote
    ));
}

function classifyPhase(context, userSignals, assistantShape, reaction, repairPath) {
  if (repairPath || ["correction", "style_recalibration"].includes(reaction?.kind)) {
    return "repair";
  }
  if (userSignals.includes("positive_feedback")) {
    return "validation";
  }
  if (userSignals.includes("asks_for_implementation") || assistantShape.includes("implementation_plan") || assistantShape.includes("became_concrete")) {
    return "implementation";
  }
  if (["agent_continuity", "planning"].includes(context) || userSignals.includes("asks_for_mechanism") || userSignals.includes("pushes_for_nuance")) {
    return "concept";
  }
  return "general";
}

function createRepairPath(userSignals, assistantShape, reaction) {
  const trigger = getRepairTrigger(userSignals);
  const assistantAdjustment = getAssistantAdjustment(assistantShape);
  if (!trigger && !["correction", "style_recalibration", "clarification"].includes(reaction?.kind)) {
    return null;
  }
  return {
    trigger: trigger || (reaction?.kind === "clarification" ? "unclear" : "wrong_direction"),
    assistantAdjustment: assistantAdjustment || "changed_level",
    outcome: "unresolved"
  };
}

function getRepairTrigger(signals) {
  if (signals.includes("repair_trigger_misread")) {
    return "misread";
  }
  if (signals.includes("repair_trigger_too_flat") || signals.includes("rejects_flattening")) {
    return "too_flat";
  }
  if (signals.includes("repair_trigger_too_verbose")) {
    return "too_verbose";
  }
  if (signals.includes("repair_trigger_style_mismatch") || signals.includes("style_feedback")) {
    return "style_mismatch";
  }
  if (signals.includes("asks_for_clarification")) {
    return "unclear";
  }
  if (signals.includes("negative_feedback")) {
    return "wrong_direction";
  }
  return "";
}

function getAssistantAdjustment(shapes) {
  if (shapes.includes("restated_intent")) {
    return "restated_intent";
  }
  if (shapes.includes("became_concrete") || shapes.includes("implementation_plan")) {
    return "became_concrete";
  }
  if (shapes.includes("became_shorter")) {
    return "became_shorter";
  }
  if (shapes.includes("became_deeper") || shapes.includes("mechanism_explanation")) {
    return "became_deeper";
  }
  if (shapes.includes("softened_tone") || shapes.includes("repair_response")) {
    return "softened_tone";
  }
  return "";
}

function updateRepairOutcome(repairPath, reaction) {
  if (!repairPath) {
    return null;
  }
  let outcome = "unresolved";
  if (reaction?.kind === "acceptance" || reaction?.signals?.includes("repair_acceptance")) {
    outcome = "accepted";
  } else if (["correction", "style_recalibration"].includes(reaction?.kind)) {
    outcome = "continued_correction";
  } else if (reaction?.kind === "clarification") {
    outcome = "clarification_requested";
  }
  return Object.assign({}, repairPath, { outcome });
}

function calculateEventWeight(event) {
  let weight = 0.12;
  const signals = event.userSignals || [];
  if (signals.includes("positive_feedback") || signals.includes("negative_feedback") || signals.includes("style_feedback")) {
    weight += 0.22;
  }
  if (signals.some((signal) => signal.startsWith("repair_trigger_")) || event.repairPath) {
    weight += 0.28;
  }
  if (signals.includes("asks_for_implementation") || signals.includes("pushes_for_nuance") || signals.includes("rejects_flattening")) {
    weight += 0.18;
  }
  if (["accepted", "correction", "style_recalibration", "implementation_followup", "productive_deepening"].includes(event.reaction?.outcomeHint)) {
    weight += 0.14;
  }
  if (event.context === "agent_continuity" || event.context === "implementation") {
    weight += 0.06;
  }
  return Math.max(0, Math.min(1, weight));
}

function classifyMemoryRole(eventWeight, repairPath, userSignals) {
  if (userSignals.includes("positive_feedback") && eventWeight >= 0.62) {
    return "deep_candidate";
  }
  if (repairPath || eventWeight >= 0.45) {
    return "pattern_evidence";
  }
  return "short_term_episode";
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

function normalizeStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map(compactText)
    .filter(Boolean);
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(Boolean))];
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
  updateRepairOutcome,
  _test: {
    classifyReaction,
    classifyPhase,
    createRepairPath,
    updateRepairOutcome,
    calculateEventWeight,
    extractInteractionSignalHints,
    CONTINUATION_PATTERNS,
    matchesRule,
    USER_SIGNAL_RULES,
    ASSISTANT_SHAPE_RULES
  }
};
