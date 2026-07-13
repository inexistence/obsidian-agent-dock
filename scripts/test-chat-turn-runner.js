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

async function testReturnedFinalContentReplacesStreamedContent() {
  const session = {
    id: "session-final-content",
    messages: [],
    currentRun: null
  };

  await runChatTurn({
    session,
    prompt: "hello",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent: async (_prompt, onUpdate) => {
      onUpdate({ kind: "content", text: "Done.\n<!-- agent-dock:deep-memory | hidden from final body -->" });
      return "Done.";
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async () => {},
    persistChatSessions: async () => {},
    notify: () => {}
  });

  const assistantMessage = session.messages.find((message) => message.role === "assistant");
  assert.equal(assistantMessage.content, "Done.");
  assert(!JSON.stringify(assistantMessage.timeline).includes("agent-dock:deep-memory"));
}

async function testTrimmedFinalContentPreservesInterleavedTimelineContent() {
  const session = {
    id: "session-trimmed-final-content",
    messages: [],
    currentRun: null
  };

  await runChatTurn({
    session,
    prompt: "hello",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent: async (_prompt, onUpdate) => {
      onUpdate({ kind: "content", text: "First message." });
      onUpdate({ kind: "reasoning", title: "Progress", detail: "Checking." });
      onUpdate({ kind: "content", text: " Final answer.\n" });
      return "First message. Final answer.";
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async () => {},
    persistChatSessions: async () => {},
    notify: () => {}
  });

  const assistantMessage = session.messages.find((message) => message.role === "assistant");
  const contents = assistantMessage.timeline.filter((entry) => entry.kind === "content");
  assert.equal(assistantMessage.content, "First message. Final answer.");
  assert.equal(contents.length, 2, "boundary trimming must not collapse interleaved content entries");
  assert.deepStrictEqual(contents.map((entry) => entry.text), [
    "First message.",
    "First message. Final answer."
  ]);
  assert.deepStrictEqual(
    assistantMessage.timeline.map((entry) => entry.kind),
    ["content", "reasoning", "content"],
    "completed timeline should preserve the original stream order"
  );
}

async function testStrippedReflectionPreservesInterleavedTimelineContent() {
  const session = {
    id: "session-stripped-reflection-content",
    messages: [],
    currentRun: null
  };

  await runChatTurn({
    session,
    prompt: "hello",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent: async (_prompt, onUpdate) => {
      onUpdate({ kind: "content", text: "First message." });
      onUpdate({ kind: "reasoning", title: "Progress", detail: "Checking." });
      onUpdate({
        kind: "content",
        text: " Final answer.\n<!-- agent-dock:reflection phase=outcome | {} -->"
      });
      return "First message. Final answer.";
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async () => {},
    persistChatSessions: async () => {},
    notify: () => {}
  });

  const assistantMessage = session.messages.find((message) => message.role === "assistant");
  const contents = assistantMessage.timeline.filter((entry) => entry.kind === "content");
  assert.equal(contents.length, 2, "stripping a terminal reflection must preserve earlier content entries");
  assert.equal(contents[0].text, "First message.");
  assert.equal(contents[1].text, "First message. Final answer.");
  assert(!JSON.stringify(assistantMessage.timeline).includes("agent-dock:reflection"));
}

async function testReturnedFinalMessageReplacesOnlyLastTimelineContent() {
  const session = {
    id: "session-final-message-content",
    messages: [],
    currentRun: null
  };

  await runChatTurn({
    session,
    prompt: "hello",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent: async (_prompt, onUpdate) => {
      onUpdate({ kind: "content", text: "Intermediate answer" });
      onUpdate({ kind: "reasoning", title: "Progress", detail: "Revising." });
      onUpdate({ kind: "content", text: "Stale final answer" });
      return "True final answer";
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async () => {},
    persistChatSessions: async () => {},
    notify: () => {}
  });

  const assistantMessage = session.messages.find((message) => message.role === "assistant");
  const contents = assistantMessage.timeline.filter((entry) => entry.kind === "content");
  assert.deepStrictEqual(contents.map((entry) => entry.text), [
    "Intermediate answer",
    "True final answer"
  ]);
  assert.equal(assistantMessage.content, "True final answer");
}

async function testAgentSignalMetadataReachesWorkingAffectUpdate() {
  const session = {
    id: "session-affect-signal",
    messages: [],
    currentRun: null
  };
  const turns = [];
  const affectSignal = {
    type: "affect_candidate",
    tone: "focused",
    confidence: 0.55,
    text: "The final answer stayed focused."
  };
  const salienceSignal = {
    type: "salience_observation",
    axes: ["craft"],
    confidence: 0.5,
    text: "Implementation craft mattered."
  };

  await runChatTurn({
    session,
    prompt: "hello",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent: async (_prompt, onUpdate) => {
      onUpdate({
        kind: "activity",
        noticeType: "reflection_candidate",
        title: "Continuity reflection",
        agentDockSignals: [affectSignal, salienceSignal]
      });
      onUpdate({ kind: "content", text: "done" });
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async (turn) => turns.push(turn),
    persistChatSessions: async () => {},
    notify: () => {}
  });

  assert.deepStrictEqual(
    turns[0].agentDockSignals,
    [affectSignal, salienceSignal],
    "all structured signals from one reflection envelope should reach the durable affect update"
  );
}

async function testCompleteReflectionSignalSetReachesWorkingAffectUpdate() {
  const session = { id: "session-complete-reflection", messages: [], currentRun: null };
  const signals = Array.from({ length: 10 }, (_, index) => ({
    type: index === 8 ? "affect_candidate" : index === 9 ? "salience_observation" : "interaction_candidate",
    phase: index < 5 ? "appraisal" : "outcome",
    text: `signal-${index}`
  }));
  let affectTurn;

  await runChatTurn({
    session,
    prompt: "hello",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent: async (_prompt, onUpdate) => {
      onUpdate({
        kind: "activity",
        noticeType: "reflection_candidate",
        agentDockSignals: signals,
        signalEvidenceContext: { recalled_memory: "remembered evidence" }
      });
      onUpdate({ kind: "content", text: "done" });
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async (turn) => { affectTurn = turn; },
    persistChatSessions: async () => {},
    notify: () => {}
  });

  assert.equal(affectTurn.agentDockSignals.length, 10);
  assert.equal(affectTurn.agentDockSignals[8].phase, "outcome");
  assert.equal(affectTurn.agentDockSignals[9].type, "salience_observation");
  assert(affectTurn.signalEvidenceContext.recalled_memory.includes("remembered evidence"));
}

async function testReflectionPhasesMergeIntoOneTimelineNotice() {
  const session = {
    id: "session-reflection-merge",
    messages: [],
    currentRun: null
  };
  const appraisalSignal = {
    type: "affect_candidate",
    phase: "appraisal",
    text: "Start carefully."
  };
  const outcomeSignal = {
    type: "salience_observation",
    phase: "outcome",
    text: "The result mattered."
  };
  let affectTurn;

  await runChatTurn({
    session,
    prompt: "hello",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent: async (_prompt, onUpdate) => {
      onUpdate({
        kind: "activity",
        noticeType: "reflection_candidate",
        noticeGroupId: "agent_dock_reflection",
        noticeItemCount: 1,
        title: "Continuity reflection",
        summary: "1 item",
        auditItems: [{ title: "Appraisal" }],
        agentDockSignals: [appraisalSignal]
      });
      onUpdate({ kind: "content", text: "Visible body before the outcome. " });
      onUpdate({
        kind: "activity",
        noticeType: "reflection_candidate",
        noticeGroupId: "agent_dock_reflection",
        noticeItemCount: 2,
        title: "Continuity reflection",
        summary: "2 items",
        auditItems: [{ title: "Appraisal" }, { title: "Outcome" }],
        agentDockSignals: [outcomeSignal]
      });
      onUpdate({ kind: "content", text: "Final tail." });
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async (turn) => {
      affectTurn = turn;
    },
    persistChatSessions: async () => {},
    notify: () => {}
  });

  const assistant = session.messages.find((message) => message.role === "assistant");
  const reflectionNotices = assistant.timeline.filter((entry) => entry.noticeGroupId === "agent_dock_reflection");
  assert.equal(reflectionNotices.length, 1, "appraisal and outcome should update one timeline notice even across content");
  assert.equal(reflectionNotices[0].noticeItemCount, 2);
  assert.equal(reflectionNotices[0].auditItems.length, 2);
  assert.deepStrictEqual(affectTurn.agentDockSignals, [appraisalSignal, outcomeSignal], "grouped display updates must retain both signal phases for affect continuity");
}

async function testOutcomeOnlyReflectionDoesNotSplitVisibleAnswer() {
  const session = {
    id: "session-outcome-only-reflection",
    messages: [],
    currentRun: null
  };

  await runChatTurn({
    session,
    prompt: "hello",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent: async (_prompt, onUpdate) => {
      onUpdate({ kind: "content", text: "The main answer appeared before the outcome. " });
      onUpdate({
        kind: "activity",
        noticeType: "reflection_candidate",
        noticeGroupId: "agent_dock_reflection",
        noticeItemCount: 1,
        insertBeforeLastContent: true,
        title: "Continuity reflection",
        summary: "1 item",
        auditItems: [{ title: "Outcome" }],
        agentDockSignals: [{ type: "affect_candidate", phase: "outcome", text: "Done." }]
      });
      onUpdate({ kind: "content", text: "Final tail." });
      return "The main answer appeared before the outcome. Final tail.";
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async () => {},
    persistChatSessions: async () => {},
    notify: () => {}
  });

  const assistant = session.messages.find((message) => message.role === "assistant");
  const contents = assistant.timeline.filter((entry) => entry.kind === "content");
  assert.equal(contents.length, 1, "an outcome-only reflection should not split streamed answer content");
  assert.equal(contents[0].text, "The main answer appeared before the outcome. Final tail.");
  assert.equal(assistant.content, contents[0].text, "the completed visible answer should remain intact");
}

async function testPostTurnMemoryNoticeDoesNotSplitCursorStream() {
  const session = {
    id: "session-cursor-memory-notice",
    messages: [],
    currentRun: null
  };

  await runChatTurn({
    session,
    prompt: "recall today",
    agentLabel: "Cursor",
    agentId: "cursor",
    runAgent: async (_prompt, onUpdate) => {
      onUpdate({ kind: "content", text: "First streamed paragraph. " });
      onUpdate({
        kind: "notice",
        noticeType: "memory_updated",
        insertBeforeLastContent: true,
        title: "Memory updated",
        summary: "1 item"
      });
      onUpdate({ kind: "content", text: "Second streamed paragraph." });
      return "First streamed paragraph. Second streamed paragraph.";
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async () => {},
    persistChatSessions: async () => {},
    notify: () => {}
  });

  const assistant = session.messages.find((message) => message.role === "assistant");
  const contents = assistant.timeline.filter((entry) => entry.kind === "content");
  assert.equal(contents.length, 1, "post-turn memory notices must not split one streamed Cursor answer");
  assert.equal(contents[0].text, "First streamed paragraph. Second streamed paragraph.");
  assert.equal(assistant.timeline[assistant.timeline.length - 1], contents[0], "the complete answer should remain the final timeline entry");
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

async function testMemoryProvenanceMetadataStaysOffTimeline() {
  const session = {
    id: "session-memory-provenance",
    messages: [],
    currentRun: null
  };
  let receivedOptions;
  await runChatTurn({
    session,
    prompt: "why",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent: async (_prompt, onUpdate, _conversation, options) => {
      receivedOptions = options;
      onUpdate({
        internalOnly: true,
        memoryProvenance: {
          available: [{ ref: "M1", memoryId: "mem-1", supportLevel: "high", evidenceIds: ["ev-1"] }],
          claimedUsedRefs: []
        }
      });
      onUpdate({
        internalOnly: true,
        memoryProvenance: {
          available: [{ ref: "M1", memoryId: "mem-1", supportLevel: "high", evidenceIds: ["ev-1"] }],
          claimedUsedRefs: ["M1"]
        }
      });
      onUpdate({ kind: "content", text: "done" });
      return "done";
    },
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    updateWorkingAffect: async () => {},
    persistChatSessions: async () => {},
    notify: () => {}
  });

  const userMessage = session.messages.find((message) => message.role === "user");
  const assistantMessage = session.messages.find((message) => message.role === "assistant");
  assert(userMessage.id && assistantMessage.id, "new messages should have stable ids");
  assert.equal(receivedOptions.userMessageId, userMessage.id);
  assert.equal(receivedOptions.assistantMessageId, assistantMessage.id);
  assert.deepEqual(assistantMessage.memoryProvenance.claimedUsedRefs, ["M1"]);
  assert.equal(assistantMessage.timeline.some((entry) => entry.internalOnly), false, "internal provenance metadata must not render in the timeline");
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
  .then(() => testReturnedFinalContentReplacesStreamedContent())
  .then(() => testTrimmedFinalContentPreservesInterleavedTimelineContent())
  .then(() => testStrippedReflectionPreservesInterleavedTimelineContent())
  .then(() => testReturnedFinalMessageReplacesOnlyLastTimelineContent())
  .then(() => testAgentSignalMetadataReachesWorkingAffectUpdate())
  .then(() => testCompleteReflectionSignalSetReachesWorkingAffectUpdate())
  .then(() => testReflectionPhasesMergeIntoOneTimelineNotice())
  .then(() => testOutcomeOnlyReflectionDoesNotSplitVisibleAnswer())
  .then(() => testPostTurnMemoryNoticeDoesNotSplitCursorStream())
  .then(() => testFinalStatusHoldIsEmittedBeforeAffectUpdate())
  .then(() => testStoppedTurnSettlesAffectDisplayWithoutUpdatingWorkingAffect())
  .then(() => testMemoryProvenanceMetadataStaysOffTimeline())
  .then(() => {
    console.log("ChatTurnRunner tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
