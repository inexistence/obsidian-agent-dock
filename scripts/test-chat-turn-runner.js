const assert = require("assert");

const { runChatTurn } = require("../src/view/session/ChatTurnRunner");

function translate(key, params = {}) {
  return ({
    "view.agentFinishedEmpty": `(${params.agent} finished without text output.)`,
    "view.agentStopped": `(${params.agent} stopped.)`,
    "view.agentRunFailed": `${params.agent} could not run.`,
    "view.agentRunFailedHint": "Check the executable path."
  })[key] || key;
}

function baseOptions(session, runAgent) {
  return {
    session,
    prompt: "hello",
    agentLabel: "Codex",
    agentId: "codex",
    runAgent,
    translate,
    touchSession: () => {},
    onTurnStarted: () => {},
    onTurnUpdate: () => {},
    onTurnFinished: () => {},
    onComposerChanged: () => {},
    persistChatSessions: async () => {},
    notify: () => {}
  };
}

async function testSuccessfulTurnAndCapsuleUpdates() {
  const session = { id: "s1", messages: [], currentRun: null };
  const capsuleUpdates = [];
  await runChatTurn(Object.assign(baseOptions(session, async (_prompt, onUpdate) => {
    onUpdate({ kind: "reasoning", detail: "Checking the note" });
    onUpdate({ kind: "content", text: "Done" });
    return "Done";
  }), {
    updateToneCapsule: (_message, update) => capsuleUpdates.push(update.kind)
  }));
  const assistant = session.messages[1];
  assert.equal(assistant.content, "Done");
  assert.equal(assistant.isComplete, true);
  assert.equal(assistant.toneCapsulePrompt, "hello");
  assert.deepEqual(capsuleUpdates, ["reasoning", "content"]);
}

async function testReturnedFinalContentReplacesStream() {
  const session = { id: "s2", messages: [], currentRun: null };
  await runChatTurn(baseOptions(session, async (_prompt, onUpdate) => {
    onUpdate({ kind: "content", text: "draft" });
    return "final";
  }));
  assert.equal(session.messages[1].content, "final");
  assert.equal(session.messages[1].timeline.filter((entry) => entry.kind === "content").at(-1).text, "final");
}

async function testFileChangeUpdatesMerge() {
  const session = { id: "s3", messages: [], currentRun: null };
  await runChatTurn(baseOptions(session, async (_prompt, onUpdate) => {
    onUpdate({ kind: "tool", toolCallId: "edit", toolType: "file_change", title: "Edit", paths: ["A.md"] });
    onUpdate({ kind: "tool", toolCallId: "edit", toolType: "file_change", title: "Edited", paths: ["B.md"] });
    onUpdate({ kind: "content", text: "done" });
    return "done";
  }));
  const tool = session.messages[1].timeline.find((entry) => entry.kind === "tool");
  assert.deepEqual(tool.paths, ["A.md", "B.md"]);
}

async function main() {
  await testSuccessfulTurnAndCapsuleUpdates();
  await testReturnedFinalContentReplacesStream();
  await testFileChangeUpdatesMerge();
  console.log("chat turn runner tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
