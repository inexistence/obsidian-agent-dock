const CAPSULE_IDS = [
  "focused",
  "absorbed",
  "alert",
  "challenging",
  "patient",
  "composed",
  "surprised",
  "starry-eyed",
  "laughing",
  "excited-open",
  "admiring",
  "celebratory"
];

const CAPSULE_PRIORITY = {
  alert: 100,
  celebratory: 88,
  "starry-eyed": 82,
  surprised: 76,
  laughing: 70,
  "excited-open": 66,
  challenging: 60,
  admiring: 56,
  absorbed: 50,
  patient: 46,
  composed: 42,
  focused: 20
};

const RULES = [
  rule("alert", {
    strong: [/(危险|破坏|删除|覆盖|泄露|权限|密钥|密码|不可逆|安全风险|permission denied|security risk|secret|unsafe)/i],
    weak: [/(警告|风险|谨慎|warning|risk|careful)/i, /(失败|报错|failed|failure|error)/i],
    blocked: [/(不要|别)[^，。！？,.!?]{0,12}(警觉|紧张|夸张|alert)/i]
  }),
  rule("celebratory", {
    strong: [/(全部通过|测试通过|验证通过|终于修好|成功完成|搞定了|已解决|all tests passed|verified successfully|finally fixed|successfully completed|shipped)/i],
    weak: [/(通过|完成|解决|passed|completed|resolved)/i, /(很好|顺利|成功|great|success)/i],
    blocked: [/(不要|别)[^，。！？,.!?]{0,12}(庆祝|兴奋|celebrat)/i]
  }),
  rule("starry-eyed", {
    strong: [/(星星眼|惊艳|绝美|封神|漂亮炸了|stunning|breathtaking|gorgeous|jaw-dropping|mind-blowing|starry-eyed|starstruck|chef'?s kiss)/i],
    weak: [/(太漂亮了|非常漂亮|beautiful)/i, /(令人赞叹|视觉冲击|wow|remarkable)/i, /(精品|杰作|masterpiece)/i],
    blocked: [/(不要|别|禁止|少点)[^，。！？,.!?]{0,12}(星星眼|惊艳|夸张|stunning|starry)/i],
    weakThreshold: 3
  }),
  rule("surprised", {
    strong: [/(意外发现|关键关联|没想到|居然|竟然|原来如此|眼前一亮|unexpected connection|surprisingly|turns out|aha moment)/i],
    weak: [/(意外|unexpected)/i, /(线索|关联|connection|clue)/i],
    blocked: [/(不要|别)[^，。！？,.!?]{0,12}(惊喜|意外|夸张|surpris)/i]
  }),
  rule("laughing", {
    strong: [/(哈哈哈|笑死|笑出声|太好笑|\blol\b|\bhaha(?:ha)+\b|laughed out loud|hilarious)/i],
    weak: [/(好笑|幽默|funny)/i, /(玩笑|段子|joke)/i],
    blocked: [/(不要|别|禁止)[^，。！？,.!?]{0,12}(笑|玩笑|哈哈|laugh|joke)/i],
    weakThreshold: 3
  }),
  rule("excited-open", {
    strong: [/(来劲了|灵感来了|有意思了|this gets interesting|promising direction)/i],
    weak: [/(新方向|new direction)/i, /(探索|展开看看|explore)/i, /(创意|灵感|idea)/i],
    blocked: [/(不要|别)[^，。！？,.!?]{0,12}(兴奋|激动|展开|explore|excited)/i],
    weakThreshold: 3
  }),
  rule("challenging", {
    strong: [/(不一致|矛盾|质疑|反例|站不住|审查|挑刺|inconsistent|contradiction|counterexample|code review|doesn'?t hold)/i],
    weak: [/(检查|review|inspect)/i, /(问题|漏洞|problem|flaw)/i],
    blocked: [/(不要|别)[^，。！？,.!?]{0,12}(质疑|挑战|挑刺|challenge)/i]
  }),
  rule("admiring", {
    strong: [/(优雅|漂亮的实现|高质量|很扎实|好判断|写得很好|设计得好|elegant|well-designed|impressive|strong work|thoughtful)/i],
    weak: [/(不错|漂亮|扎实|good)/i, /(设计|实现|判断|design|implementation)/i],
    blocked: [/(不要|别)[^，。！？,.!?]{0,12}(赞赏|夸|佩服|admire|impressive)/i]
  }),
  rule("patient", {
    strong: [/(一步一步|逐步解释|慢慢讲|详细说明|从头梳理|step by step|walk through|explain carefully)/i],
    weak: [/(解释|说明|explain)/i, /(复杂|基础|complex|basics)/i],
    blocked: [/(不要|别)[^，。！？,.!?]{0,12}(详细|慢慢|逐步|step by step)/i]
  }),
  rule("composed", {
    strong: [/(重新梳理|先冷静|恢复方案|重新组织|换个思路|回退后|reorganize|recover|reassess|another approach)/i],
    weak: [/(调整|重来|adjust|retry)/i, /(方案|思路|plan|approach)/i]
  }),
  rule("absorbed", {
    strong: [/(深入分析|继续排查|正在实现|正在修改|连续处理|deep dive|digging deeper|implementing|applying patch)/i],
    weak: [/(深入|继续|deep|continue)/i, /(处理|分析|排查|working|analyzing)/i]
  })
];

function createToneCapsule(prompt = "") {
  return {
    id: classifyToneCapsule({ kind: "prompt", text: prompt }) || "focused",
    toolCount: 0
  };
}

function updateToneCapsule(previous, event, prompt = "") {
  const current = previous && typeof previous === "object"
    ? Object.assign({ id: "focused", toolCount: 0 }, previous)
    : createToneCapsule(prompt);
  if (!event || event.kind === "activity" || event.internalOnly === true) {
    return current;
  }
  if (event.kind === "tool") {
    current.toolCount += 1;
  }
  const candidate = classifyToneCapsule(event, prompt, current);
  if (!candidate) {
    return current;
  }
  if ((CAPSULE_PRIORITY[candidate] || 0) >= (CAPSULE_PRIORITY[current.id] || 0) || candidate === current.id) {
    current.id = candidate;
  } else if (current.id === "focused" || current.id === "absorbed") {
    current.id = candidate;
  }
  return current;
}

function classifyToneCapsule(event, prompt = "", state = {}) {
  if (event?.kind === "error" || hasFailedExit(event)) {
    return "alert";
  }
  const visibleText = getVisibleEventText(event);
  const text = `${String(prompt || "")}\n${visibleText}`;
  for (const entry of RULES) {
    if (entry.blocked.some((pattern) => pattern.test(text))) {
      continue;
    }
    if (entry.strong.some((pattern) => pattern.test(text))) {
      return entry.id;
    }
    const weakScore = entry.weak.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
    if (weakScore >= entry.weakThreshold) {
      return entry.id;
    }
  }
  if (event?.kind === "tool") {
    if (event.toolType === "file_change" || Number(state.toolCount || 0) >= 2) {
      return "absorbed";
    }
    return "focused";
  }
  if (["prompt", "reasoning", "content", "notice"].includes(event?.kind)) {
    return "focused";
  }
  return "";
}

function getVisibleEventText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  return [event.text, event.title, event.summary, event.toolType, event.status, event.exitCode]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasFailedExit(event) {
  const exitCode = Number(event?.exitCode);
  return event?.kind === "tool" && Number.isFinite(exitCode) && exitCode !== 0;
}

function rule(id, options) {
  return {
    id,
    strong: options.strong || [],
    weak: options.weak || [],
    blocked: options.blocked || [],
    weakThreshold: options.weakThreshold || 2
  };
}

module.exports = {
  CAPSULE_IDS,
  CAPSULE_PRIORITY,
  createToneCapsule,
  updateToneCapsule,
  _test: { classifyToneCapsule, getVisibleEventText, hasFailedExit }
};
