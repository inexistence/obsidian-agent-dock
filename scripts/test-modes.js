const assert = require("assert");

const { applyModeArgs } = require("../src/modes");

assert.deepEqual(
  applyModeArgs(["exec", "{{prompt}}"], "readOnly", "readOnly"),
  ["exec", "--sandbox", "read-only", "{{prompt}}"]
);
assert.deepEqual(
  applyModeArgs(["exec", "--sandbox", "danger-full-access", "prompt"], "readOnly", "readOnly"),
  ["exec", "--sandbox", "read-only", "prompt"]
);
assert.deepEqual(
  applyModeArgs(["exec", "--dangerously-bypass-approvals-and-sandbox", "prompt"], "workspaceWrite", "readOnly"),
  ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "prompt"]
);
assert.deepEqual(
  applyModeArgs(["prompt"], "readOnly", "readOnly"),
  ["exec", "--sandbox", "read-only", "prompt"],
  "custom arguments without exec must still run through a sandboxed exec invocation"
);
assert.deepEqual(
  applyModeArgs([
    "exec",
    "--yolo",
    "--full-auto",
    "--dangerously-bypass-approvals-and-sandbox=true",
    "prompt"
  ], "readOnly", "readOnly"),
  ["exec", "--sandbox", "read-only", "prompt"],
  "Codex access-escalation aliases must not override the selected plugin mode"
);

console.log("mode tests passed");
