const EXPANSION_GROUPS = [
  ["刻意", "显眼", "标签", "生硬", "明显", "突兀"],
  ["自然", "连续", "延续", "背景", "余温", "不刻意"],
  ["记得", "记住", "回忆", "记忆", "想起来"],
  ["重要", "深刻", "在意", "珍惜", "meaningful", "important"],
  ["关系", "陪伴", "在场", "被看见", "默契", "continuity", "presence"],
  ["修正", "校准", "调整", "修复", "repair", "calibration"],
  ["完成", "跑通", "搞定", "测试通过", "achievement", "craft"],
  ["边界", "公平", "正义", "保护", "justice", "boundary"]
];

function expandSearchText(text) {
  const source = String(text || "");
  const lower = source.toLowerCase();
  const additions = [];
  for (const group of EXPANSION_GROUPS) {
    if (group.some((term) => lower.includes(term.toLowerCase()))) {
      additions.push(...group);
    }
  }
  return additions.length > 0
    ? `${source} ${Array.from(new Set(additions)).join(" ")}`
    : source;
}

module.exports = {
  expandSearchText,
  _test: {
    EXPANSION_GROUPS
  }
};
