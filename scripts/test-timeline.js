const assert = require("assert");

const {
  _test: timelineTest
} = require("../src/view/timeline/timeline");

function createMessage(timeline = [], content = "") {
  return { timeline, content };
}

function contentEntries(message) {
  return message.timeline.filter((entry) => entry.kind === "content");
}

function reasoningEntries(message) {
  return message.timeline.filter((entry) => entry.kind === "reasoning");
}

{
  const message = createMessage();
  timelineTest.appendTimelineContent(message, "Hello");
  timelineTest.appendTimelineReasoning(message, { title: "Thinking", detail: "plan" });
  timelineTest.appendTimelineContent(message, " world");
  assert.strictEqual(message.timeline.length, 3);
  assert.deepStrictEqual(message.timeline.map((entry) => entry.kind), ["content", "reasoning", "content"]);
  assert.strictEqual(contentEntries(message).length, 2);
}

{
  const message = createMessage();
  timelineTest.appendTimelineContent(message, "First");
  message.timeline.push({ kind: "tool", title: "Tool" });
  timelineTest.appendTimelineContent(message, "Second");
  assert.strictEqual(contentEntries(message).length, 2);
}

{
  const message = createMessage([], "Hello world");
  message.timeline = [
    { kind: "content", text: "Hello" },
    { kind: "reasoning", title: "Thinking", detail: "..." },
    { kind: "content", text: " world" }
  ];
  timelineTest.consolidateTimelineContent(message);
  assert.strictEqual(contentEntries(message).length, 3);
  assert.strictEqual(contentEntries(message)[2].text, "Hello world");
}

{
  const message = createMessage([], "FirstSecond");
  message.timeline = [
    { kind: "content", text: "First" },
    { kind: "tool", title: "Tool" },
    { kind: "content", text: "Second" }
  ];
  timelineTest.consolidateTimelineContent(message);
  assert.strictEqual(contentEntries(message).length, 3);
  assert.strictEqual(contentEntries(message)[2].text, "FirstSecond");
}

{
  const message = createMessage();
  timelineTest.appendTimelineReasoning(message, { title: "Thinking", detail: "Hel" });
  timelineTest.appendTimelineReasoning(message, { title: "Thinking", detail: "lo" });
  assert.strictEqual(reasoningEntries(message).length, 1);
  assert.strictEqual(reasoningEntries(message)[0].detail, "Hello");
}

{
  const message = createMessage();
  timelineTest.appendTimelineReasoning(message, { title: "Thinking", detail: "Hel" });
  timelineTest.appendTimelineReasoning(message, { title: "Thinking", detail: "Hello" });
  assert.strictEqual(reasoningEntries(message)[0].detail, "Hello");
}

{
  const message = createMessage();
  timelineTest.appendTimelineReasoning(message, { title: "Thinking", detail: "A", discrete: false });
  timelineTest.appendTimelineReasoning(message, { title: "Plan", detail: "step 1", discrete: true });
  timelineTest.appendTimelineReasoning(message, { title: "Thinking", detail: "B" });
  assert.strictEqual(reasoningEntries(message).length, 3);
  assert.strictEqual(reasoningEntries(message)[0].detail, "A");
  assert.strictEqual(reasoningEntries(message)[1].detail, "step 1");
  assert.strictEqual(reasoningEntries(message)[2].detail, "B");
}

{
  const message = createMessage();
  timelineTest.appendTimelineReasoning(message, { title: "Thinking", detail: "A" });
  message.timeline.push({ kind: "notice", title: "Notice", summary: "saved" });
  timelineTest.appendTimelineReasoning(message, { title: "Thinking", detail: "B" });
  assert.strictEqual(message.timeline.length, 3);
  assert.deepStrictEqual(message.timeline.map((entry) => entry.kind), ["reasoning", "notice", "reasoning"]);
  assert.strictEqual(reasoningEntries(message).length, 2);
  assert.strictEqual(reasoningEntries(message)[0].detail, "A");
  assert.strictEqual(reasoningEntries(message)[1].detail, "B");
}

{
  const message = createMessage([], "Agent failed");
  message.timeline = [
    { kind: "reasoning", title: "Thinking", detail: "..." },
    { kind: "content", text: "partial" }
  ];
  timelineTest.replaceTimelineFinalContent(message, "Agent failed");
  timelineTest.consolidateTimelineContent(message);
  assert.strictEqual(contentEntries(message).length, 1);
  assert.strictEqual(contentEntries(message)[0].text, "Agent failed");
  assert.strictEqual(reasoningEntries(message).length, 1);
}

{
  const timeline = [
    { kind: "content", text: "First" },
    { kind: "reasoning", title: "Thinking", detail: "..." },
    { kind: "content", text: "Second" }
  ];
  const sections = timelineTest.getCompletedTimelineSections(timeline, false);
  assert.strictEqual(sections.finalEntry.text, "Second");
  assert.ok(sections.processedEntries.some((entry) => entry.kind === "content" && entry.text === "First"));
}

{
  const message = createMessage([], "Hello world\n");
  message.timeline = [
    { kind: "content", text: "Hello" },
    { kind: "reasoning", title: "Thinking", detail: "..." },
    { kind: "content", text: " world" }
  ];
  timelineTest.consolidateTimelineContent(message);
  const sections = timelineTest.getCompletedTimelineSections(message.timeline, false);
  assert.strictEqual(sections.finalEntry.text, "Hello world\n");
  assert.ok(sections.processedEntries.some((entry) => entry.kind === "content" && entry.text === " world"));
}

console.log("timeline tests passed");
