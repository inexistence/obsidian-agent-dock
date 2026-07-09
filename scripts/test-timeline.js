const assert = require("assert");

const {
  _test: timelineTest
} = require("../src/view/timeline/timeline");
const {
  _test: timelineRendererTest
} = require("../src/view/timeline/MessageTimelineRenderer");

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
  const message = createMessage();
  timelineTest.appendTimelineContent(message, "First");
  message.timeline.push({ kind: "activity", title: "Cursor ACP", summary: "notification" });
  timelineTest.appendTimelineContent(message, "Second");
  assert.strictEqual(contentEntries(message).length, 2);
  assert.deepStrictEqual(contentEntries(message).map((entry) => entry.text), ["First", "Second"]);
}

{
  const message = createMessage();
  timelineTest.appendTimelineContent(message, "First");
  message.timeline.push({ kind: "notice", title: "Notice" });
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
  assert.strictEqual(contentEntries(message).length, 2);
  assert.strictEqual(contentEntries(message)[1].text, " world");
}

{
  const message = createMessage([], "FirstSecond");
  message.timeline = [
    { kind: "content", text: "First" },
    { kind: "tool", title: "Tool" },
    { kind: "content", text: "Second" }
  ];
  timelineTest.consolidateTimelineContent(message);
  assert.strictEqual(contentEntries(message).length, 2);
  assert.strictEqual(contentEntries(message)[1].text, "Second");
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
  assert.strictEqual(sections.finalEntry.text, " world");
  assert.ok(sections.processedEntries.some((entry) => entry.kind === "content" && entry.text === "Hello"));
}

{
  const segments = timelineRendererTest.buildLiveTimelineSegments([
    { kind: "reasoning", title: "Thinking", detail: "plan" },
    { kind: "content", text: "First" },
    { kind: "tool", title: "$ node test 已开始", summary: "node test" },
    { kind: "content", text: "Second" },
    { kind: "notice", title: "Notice", summary: "saved" }
  ], false);
  assert.deepStrictEqual(
    segments.map((segment) => segment.type),
    ["process", "content", "process", "content", "process"],
    "live rendering should preserve stream order around content entries"
  );
  assert.strictEqual(segments[0].firstIndex, 0);
  assert.strictEqual(segments[2].firstIndex, 2);
  assert.strictEqual(segments[4].firstIndex, 4);
}

{
  const processed = timelineRendererTest.buildProcessedIndex([
    {
      kind: "tool",
      title: "$ node scripts/test-timeline.js 已开始",
      summary: "node scripts/test-timeline.js"
    },
    {
      kind: "tool",
      title: "$ node scripts/test-timeline.js 已完成",
      summary: "node scripts/test-timeline.js | 退出码：0"
    },
    { kind: "notice", title: "提示", summary: "已包含相关记忆" },
    { kind: "content", text: "Earlier answer" }
  ]);
  assert.strictEqual(processed.length, 3);
  assert.strictEqual(processed[0].type, "event");
  assert.strictEqual(processed[0].kind, "tool");
  assert.strictEqual(processed[0].entries.length, 2);
  assert.strictEqual(processed[1].kind, "notice");
  assert.strictEqual(processed[2].type, "content");
}

{
  const processed = timelineRendererTest.buildProcessedIndex([
    { kind: "notice", title: "Notice", summary: "same" },
    { kind: "notice", title: "Notice", summary: "same" }
  ]);
  assert.strictEqual(processed.length, 2, "similar notices should not be merged as a tool lifecycle");
}

console.log("timeline tests passed");
