const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      normalizePath: (path) => String(path || "").replace(/\\/g, "/")
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { _test } = require("../src/storage/MemoryStore");

function extract(turn) {
  return _test.extractMemories(Object.assign({
    prompt: "",
    response: "",
    sessionId: "test-session",
    activeFilePath: ""
  }, turn));
}

function hasMemory(items, kind, scope, pattern) {
  return items.some((item) => (
    item.kind === kind
    && item.scope === scope
    && pattern.test(item.text)
  ));
}

{
  const items = extract({
    prompt: "我应该先重构这个模块",
    response: "好的，这个计划可以作为普通项目任务处理。"
  });
  assert.equal(
    hasMemory(items, "identity", "agent", /我应该/),
    false,
    "user first-person plans must not become agent identity"
  );
}

{
  const items = extract({
    prompt: "AI的兴趣方向应该保持稳定，而不是只适配用户。",
    response: "收到。"
  });
  assert.equal(
    hasMemory(items, "identity", "agent", /AI的兴趣方向/),
    true,
    "explicit AI identity in user prompt should become agent identity"
  );
}

{
  const items = extract({
    prompt: "继续讨论 agent identity。",
    response: "我倾向于保持克制、有判断力、并持续关注工具如何形成长期协作关系。"
  });
  assert.equal(
    hasMemory(items, "identity", "agent", /我倾向于/),
    true,
    "assistant first-person tendency should become agent identity"
  );
}

{
  const items = extract({
    prompt: "我们正在探索 AI 人格连续性如何进入 Agent Dock。",
    response: "这个方向可以继续做成共同项目记忆。"
  });
  assert.equal(
    hasMemory(items, "shared", "shared", /我们正在探索/),
    true,
    "shared collaboration phrasing should become shared memory"
  );
}

assert.equal(
  _test.isGlobalMemory({ kind: "identity", scope: "agent" }),
  true,
  "agent identity should remain globally recallable"
);
assert.equal(
  _test.isGlobalMemory({ kind: "shared", scope: "shared" }),
  false,
  "shared memory should require a query match instead of global recall"
);

console.log("MemoryStore tests passed");
