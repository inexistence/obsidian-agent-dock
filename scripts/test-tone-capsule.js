const assert = require("assert");

const {
  CAPSULE_IDS,
  createToneCapsule,
  updateToneCapsule,
  _test
} = require("../src/view/turn/TurnToneCapsule");

const strongCases = {
  focused: "分析这个函数",
  absorbed: "继续深入排查并实现修改",
  alert: "这里存在不可逆的删除风险",
  challenging: "审查这个实现，找出不一致",
  patient: "请一步一步解释这个复杂概念",
  composed: "换个思路，重新组织方案",
  surprised: "意外发现了一个关键关联，眼前一亮",
  "starry-eyed": "这个结果太惊艳了，星星眼",
  laughing: "哈哈哈，这个 bug 太好笑了",
  "excited-open": "这个新方向让我来劲了",
  admiring: "这是一个优雅而高质量的实现",
  celebratory: "全部测试通过，问题终于修好"
};

assert.deepEqual(Object.keys(strongCases).sort(), [...CAPSULE_IDS].sort());
for (const [expected, text] of Object.entries(strongCases)) {
  assert.equal(createToneCapsule(text).id, expected, `${expected} strong match`);
}

assert.equal(createToneCapsule("一个漂亮的实现").id, "admiring", "two ordinary weak signals combine");
assert.equal(createToneCapsule("这个结果很漂亮").id, "focused", "one starry weak signal stays below threshold");
assert.equal(createToneCapsule("意外的线索").id, "surprised", "two surprise weak signals combine");
assert.equal(createToneCapsule("不要星星眼，这只是一个漂亮结果").id, "focused", "negation blocks starry-eyed");
assert.equal(createToneCapsule("不要庆祝，只说明全部测试通过").id, "focused", "negation blocks celebration");
assert.equal(createToneCapsule("不要笑，这不是玩笑，哈哈哈也别来").id, "focused", "negation blocks laughing");
assert.equal(createToneCapsule("眼前一亮：发现了意外关联").id, "surprised", "surprise does not escalate to starry-eyed");
assert.equal(createToneCapsule("lol, that bug was hilarious").id, "laughing", "English laughter uses real word boundaries");

let capsule = createToneCapsule("分析问题");
capsule = updateToneCapsule(capsule, { kind: "tool", title: "搜索文件" }, "分析问题");
capsule = updateToneCapsule(capsule, { kind: "tool", title: "读取文件" }, "分析问题");
assert.equal(capsule.id, "absorbed", "consecutive visible tools become absorbed");
capsule = updateToneCapsule(capsule, { kind: "error", title: "失败" }, "分析问题");
assert.equal(capsule.id, "alert", "error overrides lower-priority states");
capsule = updateToneCapsule(capsule, { kind: "content", text: "全部测试通过" }, "分析问题");
assert.equal(capsule.id, "alert", "lower-priority completion does not override alert");

assert.equal(_test.classifyToneCapsule({ kind: "tool", title: "命令", exitCode: 2 }), "alert");
assert.equal(_test.getVisibleEventText({
  kind: "tool",
  title: "安全标题",
  summary: "安全摘要",
  detail: "星星眼，不应读取完整输出"
}).includes("星星眼"), false, "tool detail is excluded");
assert.equal(updateToneCapsule(createToneCapsule("分析"), {
  kind: "activity",
  title: "星星眼"
}, "分析").id, "focused", "debug activity is excluded");

console.log("tone capsule tests passed");
