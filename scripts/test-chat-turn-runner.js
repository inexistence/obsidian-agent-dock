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

async function testBeforeAgentRunCanInsertMessageBeforeAssistant() {
  const calls = [];
  const session = {
    id: "session-c",
    messages: [],
    currentRun: null
  };

  await runChatTurn({
    session,
    prompt: "make it playful",
    agentLabel: "Codex",
    runAgent: async (_prompt, onUpdate) => {
      calls.push("runAgent");
      onUpdate({ kind: "content", text: "done" });
    },
    translate,
    touchSession: () => {},
    onBeforeAgentRun: (_session, assistantMessage) => {
      calls.push("before");
      const assistantIndex = session.messages.indexOf(assistantMessage);
      session.messages.splice(assistantIndex, 0, {
        role: "system",
        kind: "affect_shift",
        content: "Tone shifted.",
        timeline: [],
        createdAt: Date.now()
      });
    },
    onTurnStarted: () => {
      calls.push("started");
    },
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async () => {},
    persistChatSessions: async () => {},
    notify: () => {}
  });

  assert.deepStrictEqual(calls.slice(0, 3), ["before", "started", "runAgent"]);
  assert.deepStrictEqual(
    session.messages.map((message) => message.role),
    ["user", "system", "assistant"]
  );
}

async function testBeforeAgentRunFailureClearsCurrentRun() {
  const session = {
    id: "session-d",
    messages: [],
    currentRun: null
  };
  const notified = [];

  await runChatTurn({
    session,
    prompt: "hello",
    agentLabel: "Codex",
    runAgent: async () => {
      throw new Error("should not run");
    },
    translate,
    touchSession: () => {},
    onBeforeAgentRun: () => {
      throw new Error("before hook failed");
    },
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async () => {},
    persistChatSessions: async () => {},
    notify: (key) => {
      notified.push(key);
    }
  });

  assert.equal(session.currentRun, null);
  assert.deepStrictEqual(notified, ["agentCommandFailed"]);
  const assistantMessage = session.messages.find((message) => message.role === "assistant");
  assert(assistantMessage.content.includes("before hook failed"));
  assert.equal(assistantMessage.isLoading, false);
}

async function testWorkingAffectReceivesTurnContext() {
  const session = {
    id: "session-e",
    messages: [],
    currentRun: null
  };
  const contexts = [];

  await runChatTurn({
    session,
    prompt: "hello",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent: async (_prompt, onUpdate) => {
      onUpdate({ kind: "content", text: "done" });
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async (_turn, context) => {
      contexts.push(context);
    },
    persistChatSessions: async () => {},
    notify: () => {}
  });

  const assistantMessage = session.messages.find((message) => message.role === "assistant");
  assert.equal(contexts.length, 1, "successful turns should update affect once");
  assert.strictEqual(contexts[0].session, session);
  assert.strictEqual(contexts[0].assistantMessage, assistantMessage);
}

async function testFinalStatusHoldIsEmittedBeforeAffectUpdate() {
  const session = {
    id: "session-hold",
    messages: [],
    currentRun: null
  };
  const calls = [];

  await runChatTurn({
    session,
    prompt: "hello",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent: async (_prompt, onUpdate) => {
      onUpdate({ kind: "content", text: "done" });
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: (_session, result) => {
      if (result.holdFinalStatus) {
        calls.push("hold");
      } else if (result.final) {
        calls.push("final");
      }
    },
    onComposerChanged: () => {},
    updateWorkingAffect: async () => {
      calls.push("affect");
    },
    persistChatSessions: async () => {},
    notify: () => {}
  });

  assert.deepStrictEqual(calls, ["hold", "affect", "final"]);
}

async function testStoppedTurnSettlesAffectDisplayWithoutUpdatingWorkingAffect() {
  const session = {
    id: "session-f",
    messages: [],
    currentRun: null
  };
  const settled = [];
  let affectUpdates = 0;
  const notified = [];

  await runChatTurn({
    session,
    prompt: "stop",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent: async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async () => {
      affectUpdates += 1;
    },
    settleAffectDisplay: async (context) => {
      settled.push(context);
    },
    persistChatSessions: async () => {},
    notify: (key) => {
      notified.push(key);
    }
  });

  const assistantMessage = session.messages.find((message) => message.role === "assistant");
  assert.equal(affectUpdates, 0, "stopped turns should not update durable affect");
  assert.equal(settled.length, 1, "stopped turns should settle visible affect once");
  assert.strictEqual(settled[0].session, session);
  assert.strictEqual(settled[0].assistantMessage, assistantMessage);
  assert.deepStrictEqual(notified, ["agentStopped"]);
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
  .then(() => testBeforeAgentRunCanInsertMessageBeforeAssistant())
  .then(() => testBeforeAgentRunFailureClearsCurrentRun())
  .then(() => testWorkingAffectReceivesTurnContext())
  .then(() => testFinalStatusHoldIsEmittedBeforeAffectUpdate())
  .then(() => testStoppedTurnSettlesAffectDisplayWithoutUpdatingWorkingAffect())
  .then(() => {
    console.log("ChatTurnRunner tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
