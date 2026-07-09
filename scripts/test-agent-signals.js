const assert = require("assert");

const {
  extractAgentDockSignals,
  formatInvalidAgentDockSignalActivity,
  formatAgentDockSignalNotice
} = require("../src/agents/shared/agentSignals");

function translate(key) {
  const messages = {
    "codex.deepMemoryCandidate.title": "Deep memory candidate",
    "codex.deepMemoryCandidate.summary": "Captured 1 auditable continuity reflection."
  };
  return messages[key] || key;
}

function testExtractsTerminalDeepMemoryComment() {
  const result = extractAgentDockSignals([
    "Done.",
    "",
    "<!-- agent-dock:deep-memory axes=care,repair importance=0.76 | 用户希望记忆自然影响后续，而不是显眼展示。 -->"
  ].join("\n"));

  assert.equal(result.visibleText, "Done.");
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].type, "deep_memory");
  assert.deepEqual(result.signals[0].axes, ["care", "repair"]);
  assert.equal(result.signals[0].importance, 0.76);
  assert(result.signals[0].text.includes("自然影响后续"));
}

function testIgnoresNonTerminalComment() {
  const text = [
    "<!-- agent-dock:deep-memory | should stay visible because it is not terminal -->",
    "Done."
  ].join("\n");
  const result = extractAgentDockSignals(text);

  assert.equal(result.visibleText, text);
  assert.equal(result.signals.length, 0);
}

function testInvalidTypeIsStrippedWithoutSignal() {
  const result = extractAgentDockSignals("Done.\n<!-- agent-dock:unknown | ignore me -->");

  assert.equal(result.visibleText, "Done.");
  assert.equal(result.signals.length, 0);
  assert.equal(result.invalidSignal, true);
}

function testMalformedTerminalSignalIsStripped() {
  const result = extractAgentDockSignals("Done.\n<!-- agent-dock:deep-memory axes=care | missing close");
  const activity = formatInvalidAgentDockSignalActivity(result);

  assert.equal(result.visibleText, "Done.");
  assert.equal(result.signals.length, 0);
  assert.equal(result.invalidSignal, true);
  assert.equal(activity.kind, "activity");
  assert(activity.detail.includes("missing close"));
}

function testFormatsNotice() {
  const result = extractAgentDockSignals("Done.\n<!-- agent-dock:deep-memory | Keep this subtle. -->");
  const notice = formatAgentDockSignalNotice(result.signals[0], {}, "codex", translate);

  assert.equal(notice.kind, "notice");
  assert.equal(notice.noticeType, "deep_memory_candidate");
  assert.equal(notice.title, "Deep memory candidate");
  assert.equal(notice.detail, "Keep this subtle.");
}

testExtractsTerminalDeepMemoryComment();
testIgnoresNonTerminalComment();
testInvalidTypeIsStrippedWithoutSignal();
testMalformedTerminalSignalIsStripped();
testFormatsNotice();

console.log("Agent signal tests passed.");
