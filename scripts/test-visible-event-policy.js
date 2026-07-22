const assert = require("assert");

const { applyVisibleEventPolicy } = require("../src/agents/shared/visibleEventPolicy");

const fileChange = {
  kind: "tool",
  toolType: "file_change",
  paths: ["Notes/A.md"],
  title: "Changed file"
};
assert.equal(applyVisibleEventPolicy(fileChange, "workspaceWrite").toolType, "file_change");
const blocked = applyVisibleEventPolicy(fileChange, "readOnly", (key) => key);
assert.equal(blocked.kind, "error");
assert.equal(blocked.toolType, undefined);
assert.equal(blocked.paths, undefined);

console.log("visible event policy tests passed");
