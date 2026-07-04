const assert = require("assert");

const { runChatTurn } = require("../src/view/session/ChatTurnRunner");

function translate(key, params = {}) {
  const messages = {
    "view.agentFinishedEmpty": `(${params.agent} finished without text output.)`,
    "view.agentStopped": `(${params.agent} stopped.)`,
    "view.agentRunFailed": `${params.agent} could not run.`,
    "view.agentRunFailedHint": "Check the executable path."
  };
  return messages[key] || key;
}

async function testAffectFailureDoesNotFailSuccessfulTurn() {
  const warnings = [];
  const session = {
    id: "session-a",
    messages: [],
    currentRun: null
  };
  const notified = [];
  const persisted = [];

  await withCapturedWarnings(warnings, () => runChatTurn({
      session,
      prompt: "hello",
      agentLabel: "Codex",
      runAgent: async (_prompt, onUpdate) => {
        onUpdate({ kind: "content", text: "done" });
      },
      translate,
      touchSession: () => {},
      onTurnStarted: () => {},
      onTurnUpdate: () => {},
      onTurnFinished: () => {},
      onComposerChanged: () => {},
      updateWorkingAffect: async () => {
        throw new Error("saveData failed");
      },
      persistChatSessions: async (options) => {
        persisted.push(options);
      },
      notify: (key) => {
        notified.push(key);
      }
    }));

  const assistantMessage = session.messages.find((message) => message.role === "assistant");
  assert(assistantMessage, "assistant message should be created");
  assert.equal(assistantMessage.content, "done");
  assert.equal(assistantMessage.isComplete, true);
  assert.equal(assistantMessage.isLoading, false);
  assert.deepStrictEqual(notified, []);
  assert(persisted.some((options) => options?.immediate), "turn should still persist chat sessions");
  assert.equal(warnings.length, 1, "affect failure should be logged once");
}

async function testAffectFailureDoesNotInterruptErrorTurn() {
  const warnings = [];
  const session = {
    id: "session-b",
    messages: [],
    currentRun: null
  };
  const notified = [];

  await withCapturedWarnings(warnings, () => runChatTurn({
      session,
      prompt: "fail",
      agentLabel: "Codex",
      runAgent: async () => {
        throw new Error("agent boom");
      },
      translate,
      touchSession: () => {},
      onTurnStarted: () => {},
      onTurnUpdate: () => {},
      onTurnFinished: () => {},
      onComposerChanged: () => {},
      updateWorkingAffect: async () => {
        throw new Error("saveData failed");
      },
      persistChatSessions: async () => {},
      notify: (key) => {
        notified.push(key);
      }
    }));

  const assistantMessage = session.messages.find((message) => message.role === "assistant");
  assert(assistantMessage.content.includes("Codex could not run."));
  assert(assistantMessage.content.includes("agent boom"));
  assert.deepStrictEqual(notified, ["agentCommandFailed"]);
  assert.equal(warnings.length, 1, "affect failure should be logged once");
}

async function withCapturedWarnings(warnings, callback) {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };
  try {
    await callback();
  } finally {
    console.warn = originalWarn;
  }
}

testAffectFailureDoesNotFailSuccessfulTurn()
  .then(() => testAffectFailureDoesNotInterruptErrorTurn())
  .then(() => {
    console.log("ChatTurnRunner tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
