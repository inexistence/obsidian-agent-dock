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

const { _test: memoryStoreTest } = require("../src/storage/MemoryStore");
const { formatMemoryLine } = require("../src/storage/MemoryStore");
const { RuleBasedMemoryExtractor } = require("../src/storage/memoryExtraction/RuleBasedMemoryExtractor");

const extractor = new RuleBasedMemoryExtractor();

function extract(turn) {
  return extractor.extractTurn(Object.assign({
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
  memoryStoreTest.isGlobalMemory({ kind: "identity", scope: "agent" }),
  true,
  "agent identity should remain globally recallable"
);
assert.equal(
  memoryStoreTest.isGlobalMemory({ kind: "shared", scope: "shared" }),
  false,
  "shared memory should require a query match instead of global recall"
);

assert.equal(
  formatMemoryLine({
    kind: "preference",
    text: "User prefers timestamped memories",
    createdAt: Date.UTC(2026, 0, 2),
    updatedAt: Date.UTC(2026, 6, 4)
  }),
  "- Preference (updated 2026-07-04, created 2026-01-02): User prefers timestamped memories",
  "memory lines should include updated and created dates when they differ"
);

{
  const customExtractor = new RuleBasedMemoryExtractor({
    candidateExtractor: {
      extractCandidates() {
        return [{ kind: "fact", scope: "user", text: "Injected candidate", confidence: 0.7 }];
      }
    },
    classifier: {
      classifyCandidates(candidates, context) {
        return candidates.map((candidate) => Object.assign({}, candidate, {
          source: "test",
          sourceSessionId: context.sourceSessionId
        }));
      }
    }
  });
  const items = customExtractor.extractTurn({ sessionId: "inject-session" });
  assert.equal(
    hasMemory(items, "fact", "user", /Injected candidate/),
    true,
    "extractor should allow candidate and classifier injection"
  );
  assert.equal(items[0].sourceSessionId, "inject-session");
}

console.log("MemoryStore tests passed");
