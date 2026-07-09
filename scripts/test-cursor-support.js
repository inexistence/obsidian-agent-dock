const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Notice: class Notice {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { expandHomePath } = require("../src/cli/paths");
const { AcpClient } = require("../src/agents/cursor/AcpClient");
const { _test: cursorAgentTest } = require("../src/agents/cursor/CursorAgent");
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
  assert.deepStrictEqual(
    acpUpdateToEvents({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "echo" }
    }),
    [],
    "Cursor user echo chunks should not become timeline activity"
  );
  assert.deepStrictEqual(
    acpUpdateToEvents({
      sessionUpdate: "usage_update",
      inputTokens: 10,
      outputTokens: 5
    }),
    [],
    "Cursor usage updates should not become timeline activity"
  );
  assert.deepStrictEqual(
    acpUpdateToEvents({
      sessionUpdate: "available_commands_update",
      commands: []
    }),
    [],
    "Cursor command availability updates should not become timeline activity"
  );
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
  assert.strictEqual(started[0].toolType, "command");
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

{
  const notFound = new Error("session not found");
  notFound.code = 404;
  assert.strictEqual(
    cursorAgentTest.isStaleSessionError(notFound),
    true,
    "missing Cursor ACP sessions should fall back to a fresh session"
  );
  assert.strictEqual(
    cursorAgentTest.isStaleSessionError(new Error("ACP request timed out: authenticate")),
    false,
    "authentication timeouts must not be treated as stale sessions"
  );
  assert.strictEqual(
    cursorAgentTest.isStaleSessionError(new Error("ACP process closed")),
    false,
    "transport failures must not be treated as stale sessions"
  );
}

async function testAcpRequestTimeout() {
  const client = new AcpClient({ requestTimeoutMs: 1 });
  assert.strictEqual(client.getRequestTimeoutMs("initialize"), 1);
  assert.ok(
    client.getRequestTimeoutMs("authenticate") > client.getRequestTimeoutMs("initialize"),
    "authentication should not use the very short custom request timeout"
  );
  assert.ok(
    client.getRequestTimeoutMs("session/new") > client.getRequestTimeoutMs("authenticate"),
    "session creation should allow more time than Cursor authentication"
  );
  assert.ok(
    client.getRequestTimeoutMs("session/new") > client.getRequestTimeoutMs("initialize"),
    "session creation should have a longer timeout than ACP handshake requests"
  );
  assert.strictEqual(
    client.getRequestTimeoutMs("session/prompt"),
    0,
    "long-running prompts should not use the short request timeout"
  );
  assert.ok(
    client.getRequestTimeoutMs("session/cancel") > 0,
    "cancel requests should be bounded so abort cleanup cannot hang forever"
  );
  assert.equal(
    client.getRequestTimeoutMs("session/cancel"),
    5000,
    "cancel requests should fail quickly while shutting down a stuck ACP process"
  );

  client.child = {
    stdin: {
      write(_payload, callback) {
        if (callback) {
          callback();
        }
      }
    }
  };
  client.closed = false;

  await assert.rejects(
    client.send("initialize", {}),
    /ACP request timed out: initialize/,
    "non-prompt ACP requests should time out when Cursor does not answer"
  );
}

async function testSuppressSessionReplay() {
  const client = { suppressSessionUpdates: false };
  const states = [];

  await cursorAgentTest.withSuppressedSessionUpdates(client, async () => {
    states.push(client.suppressSessionUpdates);
  });
  states.push(client.suppressSessionUpdates);

  assert.deepStrictEqual(
    states,
    [true, false],
    "Cursor session replay suppression should only apply while loading a saved session"
  );
}

function testAcpNotificationLogFiltering() {
  const logs = [];
  const client = new AcpClient({
    onLog(event, details) {
      logs.push({ event, details });
    }
  });

  client.log("notification", { method: "session/update" });
  client.log("notification", { method: "cursor/create_plan" });

  assert.deepStrictEqual(
    logs.map((entry) => entry.details.method),
    ["cursor/create_plan"],
    "high-frequency session/update notifications should not be logged"
  );
}

testAcpRequestTimeout().then(() => {
  return testSuppressSessionReplay();
}).then(() => {
  testAcpNotificationLogFiltering();
  console.log("cursor support tests passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
