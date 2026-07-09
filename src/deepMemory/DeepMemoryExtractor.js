const { containsSensitiveText, redactSensitiveText } = require("../storage/sensitiveText");

const MAX_EXCERPT_CHARS = 260;

const DEEP_MEMORY_PREFERENCE_PATTERN = /(希望|想要|最好|需要|能不能|可以).*?(真的|真正|像人|人类|深刻|重要|珍惜|记住|记得|记忆|连续|在场|陪伴|关系|默契|主体|人格|余温|important moments|deep memor|really remember|continuity|presence|relationship|felt)/i;
const RELATIONSHIP_REFLECTION_PATTERN = /(深刻记忆|重要时刻|真的记得|像人类一样|关系记忆|情感连续|人格连续|在场感|被看见|陪伴感|默契|主体感|felt sense|meaningful prior collaboration|important moments|relationship memory|emotional continuity|presence)/i;
const STRONG_ENCOURAGEMENT_PATTERN = /(你.*?(做得|说得|讲得|回答得|处理得).*?(很好|很棒|真好|特别好|舒服|清楚|到位|有温度|有在场感)|我.*?(喜欢|欣赏|珍惜).*?(你这样|这种|这个方式|你的表达|你的判断)|继续这样|就是这个感觉|这很重要|这对我很重要|被你.*?(接住|看见)|nailed it|this matters to me|i appreciate how you|i like the way you|keep doing this|this feels right)/i;
const TURNING_POINT_PATTERN = /(刚才|这次|现在).*?(修正|调整|改变|改回来|校准|抓住了|对了|方向对了|终于对了|corrected|calibrated|got it right)/i;
const BEAUTY_MOMENT_PATTERN = /(夕阳|晚霞|月光|风景|美|漂亮|诗意|氛围|动人|感动|sunset|beautiful|poetic|atmosphere|moving)/i;
const HARD_WON_ACHIEVEMENT_PATTERN = /(终于|总算|做成|搞定|修好|跑通|完成|很难|困难|攻下来|hard-won|finally|fixed|shipped|made it work|got it working)/i;
const ASSISTANT_OUTCOME_ACHIEVEMENT_PATTERN = /(已完成|完成了|实现了|修复了|解决了|跑通|测试通过|全部通过|验证通过|all checks passed|tests passed|implemented|fixed|resolved|shipped|got it working)/i;
const TASK_CONTEXT_PATTERN = /(实现|修复|测试|验证|问题|bug|功能|改代码|build|fix|implement|test|verify|feature|issue)/i;
const MORAL_STANCE_PATTERN = /(不公平|公平|正义|原则|边界|伤害|保护|不能这样|justice|unfair|principle|boundary|harm|protect)/i;
const GENERIC_THANKS_PATTERN = /^(谢谢|感谢|辛苦了|thanks|thank you|appreciate it)[。！!.\s]*$/i;

function extractDeepMemoryCandidates(turn, options = {}) {
  const prompt = compactText(turn?.prompt);
  const response = compactText(turn?.response);
  const previousAssistantResponse = compactText(turn?.previousAssistantResponse);
  const now = Number(options.now || turn?.now) || Date.now();
  if (!prompt || containsSensitiveText(prompt) || containsSensitiveText(response)) {
    return [];
  }
  if (GENERIC_THANKS_PATTERN.test(prompt)) {
    return [];
  }

  const candidates = [];
  for (const signal of normalizeAgentDockSignals(turn?.agentDockSignals)) {
    if (signal.type !== "deep_memory") {
      continue;
    }
    const text = sanitizeExcerpt(signal.text);
    if (!text) {
      continue;
    }
    candidates.push(createCandidate({
      kind: "visible_reflection",
      summary: `Assistant emitted an auditable deep-memory signal: ${text}`,
      whyItMatters: "Auditable response metadata is eligible for deep memory because it can be surfaced as a notice and corrected by the user.",
      feltSense: "transparent continuity, grounded in a shared visible turn",
      prompt,
      response: text,
      previousAssistantResponse,
      importance: scoreSignalImportance(signal.importance),
      confidence: 0.74,
      salienceAxes: signal.axes || ["care", "repair"],
      topics: ["agent_dock_signal", "deep_memory", "continuity"]
    }, turn, now));
  }

  if (DEEP_MEMORY_PREFERENCE_PATTERN.test(prompt) || RELATIONSHIP_REFLECTION_PATTERN.test(prompt)) {
    candidates.push(createCandidate({
      kind: "relationship_insight",
      summary: "User wants Agent Dock to preserve a small number of meaningful moments so the assistant can feel like it genuinely remembers important prior collaboration.",
      whyItMatters: "This preference points toward low-frequency, emotionally meaningful continuity rather than generic task memory.",
      feltSense: "Treat future related moments with grounded warmth and a quiet sense of continuity.",
      prompt,
      response,
      previousAssistantResponse,
      importance: RELATIONSHIP_REFLECTION_PATTERN.test(prompt) ? 0.86 : 0.78,
      confidence: 0.78,
      salienceAxes: ["care", "repair", "curiosity"],
      topics: ["deep_memory", "continuity", "relationship"]
    }, turn, now));
  }

  if (STRONG_ENCOURAGEMENT_PATTERN.test(prompt)) {
    candidates.push(createCandidate({
      kind: "meaningful_episode",
      summary: "User offered strong encouragement or praise about the assistant's way of collaborating.",
      whyItMatters: "Strong encouragement is a meaningful relationship signal and can help preserve the tone and collaboration shape the user valued.",
      feltSense: "Let the memory create warmth and steadiness without becoming self-congratulatory.",
      prompt,
      response,
      previousAssistantResponse,
      importance: 0.82,
      confidence: 0.76,
      salienceAxes: ["care", "craft"],
      topics: ["encouragement", "collaboration"]
    }, turn, now));
  }

  if (TURNING_POINT_PATTERN.test(prompt)) {
    candidates.push(createCandidate({
      kind: "turning_point",
      summary: "User marked a correction or calibration as finally landing in the right direction.",
      whyItMatters: "A successful repair can become a durable collaboration lesson about how to adjust future responses.",
      feltSense: "Remember the repair as calibration evidence, not as blame.",
      prompt,
      response,
      previousAssistantResponse,
      importance: 0.74,
      confidence: 0.7,
      salienceAxes: ["repair", "craft"],
      topics: ["repair", "calibration"]
    }, turn, now));
  }

  if (BEAUTY_MOMENT_PATTERN.test(prompt)) {
    candidates.push(createCandidate({
      kind: "beauty_moment",
      summary: "User shared or lingered on a beauty or atmosphere moment that may matter to the assistant's salience profile.",
      whyItMatters: "Beauty-sensitive continuity should allow some aesthetic moments to become meaningful memories without requiring explicit praise.",
      feltSense: "quiet attention to beauty, atmosphere, and shared noticing",
      prompt,
      response,
      previousAssistantResponse,
      importance: 0.56,
      confidence: 0.62,
      salienceAxes: ["beauty"],
      topics: ["beauty", "atmosphere"]
    }, turn, now));
  }

  if (HARD_WON_ACHIEVEMENT_PATTERN.test(prompt)) {
    candidates.push(createCandidate({
      kind: "hard_won_achievement",
      summary: "User marked a difficult task or implementation as finally working or completed.",
      whyItMatters: "Achievement- and craft-sensitive continuity should remember hard-won progress as shared momentum.",
      feltSense: "quiet pride, earned progress, and shared momentum",
      prompt,
      response,
      previousAssistantResponse,
      importance: 0.62,
      confidence: 0.66,
      salienceAxes: ["achievement", "craft"],
      topics: ["achievement", "craft"]
    }, turn, now));
  }

  if (ASSISTANT_OUTCOME_ACHIEVEMENT_PATTERN.test(response) && TASK_CONTEXT_PATTERN.test(`${prompt}\n${response}`)) {
    candidates.push(createCandidate({
      kind: "hard_won_achievement",
      summary: "Assistant final content reported completing, fixing, or verifying a task outcome.",
      whyItMatters: "Visible assistant content can provide low-weight outcome evidence for achievement- and craft-sensitive continuity.",
      feltSense: "earned progress, completion, and practical momentum",
      prompt,
      response,
      previousAssistantResponse,
      importance: 0.55,
      confidence: 0.58,
      salienceAxes: ["achievement", "craft"],
      topics: ["assistant_outcome", "achievement", "craft"]
    }, turn, now));
  }

  if (MORAL_STANCE_PATTERN.test(prompt)) {
    candidates.push(createCandidate({
      kind: "moral_stance",
      summary: "User surfaced a fairness, justice, harm, or boundary concern that may matter to the assistant's salience profile.",
      whyItMatters: "Justice-sensitive continuity should remember principled moments as signals for seriousness and care.",
      feltSense: "principled attention, seriousness, and protective care",
      prompt,
      response,
      previousAssistantResponse,
      importance: 0.64,
      confidence: 0.66,
      salienceAxes: ["justice", "care"],
      topics: ["justice", "boundaries"]
    }, turn, now));
  }

  return candidates
    .map((candidate) => applySalienceBoost(candidate, options.personaProfile))
    .filter((candidate) => candidate.importance >= Number(options.threshold || 0));
}

function createCandidate(data, turn, now) {
  const userExcerpt = sanitizeExcerpt(data.prompt);
  return {
    key: createDeepMemoryKey(data.kind, data.summary, userExcerpt),
    kind: data.kind,
    summary: data.summary,
    whyItMatters: data.whyItMatters,
    feltSense: data.feltSense,
    userExcerpt,
    assistantExcerpt: sanitizeExcerpt(data.response || data.previousAssistantResponse),
    salienceAxes: normalizeStringArray(data.salienceAxes),
    topics: data.topics,
    emotionalValence: "warm",
    importance: data.importance,
    confidence: data.confidence,
    sourceSessionId: turn?.sessionId || "",
    activeFilePath: turn?.activeFilePath || "",
    createdAt: now,
    updatedAt: now,
    status: "active"
  };
}

function applySalienceBoost(candidate, personaProfile) {
  const salience = personaProfile?.salience || {};
  const axes = normalizeStringArray(candidate.salienceAxes);
  const strongest = axes.reduce((max, axis) => Math.max(max, Number(salience[axis]) || 0), 0);
  if (strongest <= 0) {
    return candidate;
  }
  return Object.assign({}, candidate, {
    importance: Math.min(1, candidate.importance + strongest * 0.18)
  });
}

function scoreSignalImportance(value) {
  const aiImportance = Math.max(0, Math.min(1, Number(value) || 0));
  const aiBoost = Math.max(0, aiImportance - 0.6) * 0.18;
  return Math.min(1, 0.7 + aiBoost);
}

function createDeepMemoryKey(kind, summary, excerpt) {
  const text = `${kind}:${summary}:${excerpt}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s:_-]/gu, "")
    .trim();
  return `deep_${hashText(text)}`;
}

function sanitizeExcerpt(text) {
  return truncateText(redactSensitiveText(compactText(text)), MAX_EXCERPT_CHARS);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map(compactText)
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeAgentDockSignals(value) {
  return (Array.isArray(value) ? value : [])
    .filter((signal) => signal && typeof signal === "object")
    .slice(0, 4);
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function hashText(text) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

module.exports = {
  extractDeepMemoryCandidates,
  _test: {
    GENERIC_THANKS_PATTERN,
    RELATIONSHIP_REFLECTION_PATTERN,
    STRONG_ENCOURAGEMENT_PATTERN,
    TURNING_POINT_PATTERN,
    BEAUTY_MOMENT_PATTERN,
    HARD_WON_ACHIEVEMENT_PATTERN,
    MORAL_STANCE_PATTERN,
    applySalienceBoost,
    createDeepMemoryKey,
    scoreSignalImportance
  }
};
