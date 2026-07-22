const assert = require("assert");

const { _test } = require("../src/agents/AgentRegistry");

assert.equal(_test.normalizeAuthStatus({ ok: true, output: "Logged in with ChatGPT" }), "authenticated");
assert.equal(_test.normalizeAuthStatus({ ok: false, output: "Not logged in. Run agent login." }), "unauthenticated");
assert.equal(_test.normalizeAuthStatus({ ok: true, output: "Cursor Agent 2.0" }), "unknown");
assert(_test.buildDiagnosticMessage({
  configuredPathFound: false,
  executablePath: "/usr/local/bin/codex",
  authStatus: "authenticated"
}).includes("Update the configured executable path"));
assert.deepEqual(_test.uniqueCandidates(["codex", "codex", ""]), ["codex"]);

console.log("agent diagnostic tests passed");
