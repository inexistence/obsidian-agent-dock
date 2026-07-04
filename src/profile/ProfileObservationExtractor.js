const { containsSensitiveText, redactSensitiveText } = require("../storage/sensitiveText");

const POSITIVE_FEEDBACK = [
  /这样(?:很好|不错|可以|对)/,
  /对[，,\s]*(?:就是|是这个|这个方向)/,
  /这次(?:很好|更好|对了|像你)/,
  /我(?:喜欢|认可|接受)(?:你)?(?:刚才|这种|这个)?/,
  /继续(?:这样|这个方向)/,
  /有用/,
  /说得(?:对|好)/,
  /\b(good|great|nice|exactly|that's it|useful|keep going)\b/i
];

const THANKS = [
  /谢谢/,
  /感谢/,
  /辛苦了/,
  /\b(thanks|thank you|appreciate it)\b/i
];

const NEGATIVE_FEEDBACK = [
  /不对/,
  /不是(?:这个|这样|我的意思)/,
  /你(?:这些|这个)?只是/,
  /只是(?:加)?设置/,
  /太(?:空|泛|虚|啰嗦|官方|像客服)/,
  /没有(?:回答|解决|落地)/,
  /这(?:不|没)是我想要的/,
  /跑偏了/,
  /别(?:这样|这么)/,
  /\b(wrong|not what i mean|too vague|too abstract|not useful|missed the point)\b/i
];

const HOSTILITY = [
  /你(?:真)?(?:蠢|傻|废物|垃圾)/,
  /闭嘴/,
  /滚/,
  /\b(idiot|stupid|shut up|trash|useless)\b/i
];

const CONCRETE_REQUEST = [
  /具体/,
  /可实施/,
  /落地/,
  /任务/,
  /步骤/,
  /方案/,
  /怎么(?:能)?(?:做|实现|达到|识别|判断)/,
  /实现路径/,
  /数据模型/,
  /流程/,
  /接入位置/,
  /验收标准/,
  /\b(concrete|specific|implementation|actionable|how exactly|tasks|steps)\b/i
];

const CONCEPTUAL_REQUEST = [
  /原理/,
  /机制/,
  /为什么/,
  /本质/,
  /边界/,
  /区别/,
  /怎么理解/,
  /自然生长/,
  /不是被设定/,
  /连续性/,
  /偏好/,
  /性格/,
  /人格/,
  /\b(principle|mechanism|why|concept|boundary|continuity|persona|preference)\b/i
];

const PACING_DIRECT = [
  /直接说/,
  /别废话/,
  /简短/,
  /快点/,
  /先给结论/,
  /不要铺垫/,
  /\b(be direct|short answer|briefly|tl;dr|cut to the chase)\b/i
];

const PACING_EXPANSIVE = [
  /展开/,
  /详细/,
  /讲透/,
  /慢慢说/,
  /多解释/,
  /完整一点/,
  /\b(explain more|go deeper|full detail|walk me through)\b/i
];

const JUDGMENT_REQUEST = [
  /你怎么看/,
  /你的判断/,
  /你觉得/,
  /你建议/,
  /给个结论/,
  /不要只列选项/,
  /别只顺着我/,
  /你来决定/,
  /\b(your take|what do you think|recommend|decide|don't just agree)\b/i
];

const RELATIONAL_SIGNAL = [
  /像你/,
  /不像你/,
  /自然/,
  /别装/,
  /别演/,
  /有自己的/,
  /主体感/,
  /陪我/,
  /一起/,
  /我们/,
  /\b(natural|like you|not like you|your own|with me|together)\b/i
];

const CONTEXTS = [
  {
    id: "agent_continuity",
    patterns: [/AI|agent|助手|智能体/i, /偏好|性格|人格|气质/, /记忆|连续性|情绪|affect/i, /自然生长|设定|人设/]
  },
  {
    id: "implementation",
    patterns: [/代码|模块|接口|数据模型|测试|脚本|设置页|prompt|store|reducer|extractor/i, /\b(code|module|interface|schema|test|script|prompt|store|reducer|extractor)\b/i]
  },
  {
    id: "debugging",
    patterns: [/报错|失败|崩溃|bug|修复|排查/, /\b(error|failed|failure|crash|fix|debug)\b/i]
  }
];

const ANSWER_SHAPES = [
  {
    id: "settings_centered",
    behavior: "settings-centered framing",
    patterns: [/设置/, /开关/, /选项/, /\b(settings|toggle|option)\b/i]
  },
  {
    id: "mechanism_centered",
    behavior: "mechanism-level framing",
    patterns: [/机制/, /观察/, /归纳/, /反馈/, /沉淀/, /衰减/, /证据/, /\b(reducer|observation|signal|mechanism)\b/i]
  },
  {
    id: "implementation_centered",
    behavior: "implementation-architecture framing",
    patterns: [/数据模型/, /接入位置/, /任务拆分/, /验收标准/, /新增.*\.js/, /src\//, /\b(test|schema|implementation)\b/i]
  }
];

class ProfileObservationExtractor {
  extractTurn(turn) {
    const context = normalizeTurnContext(turn);
    const observations = [];

    observations.push(...extractEmotionalSignals(context));
    observations.push(...extractFeedbackSignals(context));
    observations.push(...extractRequestShapeSignals(context));
    observations.push(...extractRelationalSignals(context));

    return dedupeObservations(observations)
      .slice(0, 6);
  }
}

function extractEmotionalSignals(context) {
  const observations = [];
  if (matches(context.prompt, HOSTILITY)) {
    observations.push(createObservation(context, {
      kind: "hostility",
      axis: "relational_tone",
      behavior: "user expressed hostility; keep the next response steady and non-escalatory",
      signal: 0,
      confidence: 0.85,
      durable: false
    }));
  }
  if (matches(context.prompt, THANKS) && !hasSpecificBehaviorSignal(context.prompt)) {
    observations.push(createObservation(context, {
      kind: "thanks",
      axis: "relational_tone",
      behavior: "user expressed general thanks",
      signal: 0.12,
      confidence: 0.55,
      durable: false
    }));
  }
  return observations;
}

function extractFeedbackSignals(context) {
  const observations = [];
  const previousShape = classifyAnswerShape(context.previousAssistantResponse);

  if (matches(context.prompt, POSITIVE_FEEDBACK)) {
    observations.push(createObservation(context, {
      kind: "encouragement",
      axis: axisForShape(previousShape) || "collaboration_style",
      behavior: `${formatShapeBehavior(previousShape)} was positively received`,
      signal: 0.55,
      confidence: 0.76
    }));
  }

  if (matches(context.prompt, THANKS) && hasSpecificBehaviorSignal(context.prompt)) {
    observations.push(createObservation(context, {
      kind: "specific_thanks",
      axis: "collaboration_style",
      behavior: "specific help in the previous response was appreciated",
      signal: 0.35,
      confidence: 0.62
    }));
  }

  if (matches(context.prompt, NEGATIVE_FEEDBACK)) {
    observations.push(createObservation(context, {
      kind: "correction",
      axis: axisForShape(previousShape) || "collaboration_style",
      behavior: `${formatShapeBehavior(previousShape)} was rejected or insufficient`,
      signal: -0.7,
      confidence: 0.82
    }));
  }

  return observations;
}

function extractRequestShapeSignals(context) {
  const observations = [];

  if (matches(context.prompt, CONCRETE_REQUEST)) {
    observations.push(createObservation(context, {
      kind: "request_shape",
      axis: "decision_style",
      behavior: "user pushed the discussion toward concrete mechanisms, implementation, or tasks",
      signal: 0.46,
      confidence: 0.68
    }));
  }

  if (matches(context.prompt, CONCEPTUAL_REQUEST)) {
    observations.push(createObservation(context, {
      kind: "request_shape",
      axis: "attention_pattern",
      behavior: "user continued probing concepts, mechanisms, boundaries, or continuity",
      signal: 0.38,
      confidence: 0.64
    }));
  }

  if (matches(context.prompt, PACING_DIRECT)) {
    observations.push(createObservation(context, {
      kind: "pacing",
      axis: "communication_pacing",
      behavior: "user asked for direct and compact responses",
      signal: 0.5,
      confidence: 0.78
    }));
  }

  if (matches(context.prompt, PACING_EXPANSIVE)) {
    observations.push(createObservation(context, {
      kind: "pacing",
      axis: "communication_pacing",
      behavior: "user asked for deeper and more detailed responses",
      signal: 0.5,
      confidence: 0.78
    }));
  }

  if (matches(context.prompt, JUDGMENT_REQUEST)) {
    observations.push(createObservation(context, {
      kind: "judgment",
      axis: "decision_style",
      behavior: "user asked the assistant to make an independent judgment",
      signal: 0.52,
      confidence: 0.76
    }));
  }

  return observations;
}

function extractRelationalSignals(context) {
  if (!matches(context.prompt, RELATIONAL_SIGNAL)) {
    return [];
  }
  return [createObservation(context, {
    kind: "relational_signal",
    axis: "relational_tone",
    behavior: "user engaged with naturalness, subjectivity, or shared collaboration tone",
    signal: 0.32,
    confidence: 0.58
  })];
}

function createObservation(context, observation) {
  return Object.assign({
    context: context.context,
    evidenceText: redactSensitiveText(truncateText(context.prompt, 220)),
    sourceSessionId: context.sourceSessionId,
    createdAt: context.now,
    durable: true
  }, observation);
}

function normalizeTurnContext(turn) {
  const prompt = compactText(turn?.prompt);
  const response = compactText(turn?.response);
  const previousAssistantResponse = compactText(turn?.previousAssistantResponse);
  return {
    prompt,
    response,
    previousAssistantResponse,
    context: classifyContext(`${prompt} ${response} ${previousAssistantResponse}`),
    sourceSessionId: turn?.sessionId || "",
    now: Number(turn?.now) || Date.now()
  };
}

function isSensitiveObservation(observation) {
  return containsSensitiveText(observation.evidenceText) || containsSensitiveText(observation.behavior);
}

function classifyContext(text) {
  for (const context of CONTEXTS) {
    if (context.patterns.some((pattern) => pattern.test(text))) {
      return context.id;
    }
  }
  return "general";
}

function classifyAnswerShape(text) {
  for (const shape of ANSWER_SHAPES) {
    if (shape.patterns.some((pattern) => pattern.test(text))) {
      return shape;
    }
  }
  return null;
}

function axisForShape(shape) {
  if (!shape) {
    return "";
  }
  if (shape.id === "implementation_centered") {
    return "decision_style";
  }
  if (shape.id === "mechanism_centered") {
    return "attention_pattern";
  }
  return "collaboration_style";
}

function formatShapeBehavior(shape) {
  return shape?.behavior || "previous response style";
}

function hasSpecificBehaviorSignal(text) {
  return matches(text, CONCRETE_REQUEST)
    || matches(text, CONCEPTUAL_REQUEST)
    || matches(text, JUDGMENT_REQUEST)
    || /清楚|明确|细|完整|判断|方案|拆分|解释/.test(text);
}

function matches(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function dedupeObservations(observations) {
  const seen = new Set();
  const deduped = [];
  for (const observation of observations) {
    if (isSensitiveObservation(observation)) {
      continue;
    }
    const key = `${observation.kind}:${observation.axis}:${observation.context}:${observation.behavior}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(observation);
  }
  return deduped;
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(text, maxLength) {
  const compact = compactText(text);
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1))}…`;
}

module.exports = {
  ProfileObservationExtractor,
  _test: {
    classifyAnswerShape,
    classifyContext,
    matches
  }
};
