const assert = require("assert");

const { _test, shouldShowEvent } = require("../src/view/timeline/timeline");

const timeline = [
  { kind: "reasoning", detail: "plan" },
  { kind: "tool", toolType: "file_change", paths: ["A.md"] },
  { kind: "content", text: "draft" },
  { kind: "tool", toolType: "command", summary: "tests" },
  { kind: "content", text: "final" }
];

const completed = _test.getCompletedTimelineSections(timeline, false);
assert.deepEqual(completed.processedEntries.map((entry) => entry.kind), ["reasoning", "tool", "content", "tool"]);
assert.equal(completed.finalEntry.text, "final");
assert.equal(shouldShowEvent({ kind: "activity" }, false), false);
assert.equal(shouldShowEvent({ kind: "tool" }, false), true);
console.log("timeline tests passed");
