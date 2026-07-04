const assert = require("assert");

const { expandHomePath } = require("../src/cli/paths");
const { acpUpdateToEvents } = require("../src/agents/cursor/acpEvents");
const {
  normalizeProviderState,
  serializeProviderState
} = require("../src/storage/providerState");

{
  const home = expandHomePath("~/bin/agent");
  assert.ok(home.endsWith("/bin/agent"), "expandHomePath should expand ~/ prefix");
  assert.strictEqual(expandHomePath("/usr/local/bin/agent"), "/usr/local/bin/agent");
}

{
  const events = acpUpdateToEvents({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Hello" }
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].kind, "content");
  assert.strictEqual(events[0].text, "Hello");
}

{
  const started = acpUpdateToEvents({
    sessionUpdate: "tool_call",
    toolCallId: "tc-1",
    title: "shell",
    status: "pending"
  });
  const updated = acpUpdateToEvents({
    sessionUpdate: "tool_call_update",
    toolCallId: "tc-1",
    status: "completed",
    rawOutput: "done"
  });
  assert.strictEqual(started[0].toolCallId, "tc-1");
  assert.strictEqual(updated[0].toolCallId, "tc-1");
  assert.strictEqual(updated[0].kind, "tool");
}

{
  const normalized = normalizeProviderState({
    cursor: { acpSessionId: "sess-123" }
  });
  assert.deepStrictEqual(normalized, { cursor: { acpSessionId: "sess-123" } });
  assert.deepStrictEqual(
    serializeProviderState({ cursor: { acpSessionId: "sess-123" } }),
    { cursor: { acpSessionId: "sess-123" } }
  );
  assert.deepStrictEqual(serializeProviderState({ cursor: { acpSessionId: "" } }), {});
}

console.log("cursor support tests passed");
