const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Modal: class Modal {
        constructor(app) {
          this.app = app;
          this.contentEl = new FakeElement();
          this.modalEl = new FakeElement();
        }
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  _test: timelineTest
} = require("../src/view/timeline/timeline");
const {
  MessageTimelineRenderer,
  _test: timelineRendererTest
} = require("../src/view/timeline/MessageTimelineRenderer");

{
  const styles = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");
  const liveContentRule = styles.match(/\.codex-dock__process-group--live\s+\.codex-dock__processed-content\s*\{([^}]*)\}/);
  assert(liveContentRule, "live processed content should override the full-width completed-process style");
  assert(/justify-self:\s*start/.test(liveContentRule[1]), "live content must not stretch across the process grid");
  assert(/width:\s*fit-content/.test(liveContentRule[1]), "live content should keep content-sized bubbles");
}

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.text = options.text || "";
    this.cls = options.cls || "";
    this.attr = options.attr || {};
  }

  createDiv(options = {}) {
    return this.createEl("div", options);
  }

  createSpan(options = {}) {
    return this.createEl("span", options);
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  setText(text) {
    this.text = text;
  }

  findByClass(cls) {
    if (hasClass(this, cls)) {
      return this;
    }
    for (const child of this.children) {
      const found = child.findByClass(cls);
      if (found) {
        return found;
      }
    }
    return null;
  }
}

const {
  MemoryNoticeModal,
  _test: memoryNoticeModalTest
} = require("../src/view/timeline/MemoryNoticeModal");
const { toRestrictedMarkdown } = require("../src/view/utils/restrictedMarkdown");

function hasClass(element, cls) {
  return String(element.cls || "").split(/\s+/).includes(cls);
}

function createRenderer(iconCalls = [], debugActivity = false) {
  return new MessageTimelineRenderer({
    getDebugActivity: () => debugActivity,
    translate: (key) => key,
    renderMarkdownContent: () => {},
    copyText: null,
    setIcon: (containerEl, iconName) => {
      iconCalls.push({ cls: containerEl.cls, iconName });
      containerEl.iconName = iconName;
    },
    openNoticeDetails: () => {},
    prefersReducedMotion: () => true,
    onDetailsToggleStart: () => {},
    onDetailsLayoutChanged: () => {}
  });
}

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
  const renderer = createRenderer();
  const container = new FakeElement();
  const message = {
    role: "assistant",
    isComplete: true,
    timeline: [
      { kind: "reasoning", title: "Thinking", detail: "plan" },
      { kind: "content", text: "Final answer" }
    ]
  };
  renderer.renderTimeline(container, message);
  const processedGroup = container.findByClass("codex-dock__process-group--processed");
  assert(processedGroup, "completed turns with process entries should render an 已处理 group");
  assert.equal(processedGroup.open, false, "completed process groups should render collapsed immediately");
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
  const message = createMessage();
  message.timeline = [
    { kind: "content", text: "Intermediate answer" },
    { kind: "reasoning", title: "Thinking", detail: "..." },
    { kind: "content", text: "Stale final answer" }
  ];
  timelineTest.replaceTimelineFinalContent(message, "Authoritative final answer");
  assert.deepStrictEqual(
    contentEntries(message).map((entry) => entry.text),
    ["Intermediate answer", "Authoritative final answer"],
    "final reconciliation must preserve processed content and replace only the last content entry"
  );
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
    ["process"],
    "all live entries should stay inside one continuous processing group"
  );
  assert.strictEqual(segments[0].firstIndex, 0);
  assert.deepStrictEqual(
    segments[0].entries.map((entry) => entry.kind),
    ["reasoning", "content", "tool", "content", "notice"],
    "content should keep its stream position without ending the processing group"
  );
}

{
  const segments = timelineRendererTest.buildLiveTimelineSegments([
    { kind: "notice", title: "已引用本地记忆", summary: "2 条" },
    { kind: "content", text: "正在回答" }
  ], false);
  assert.strictEqual(
    timelineRendererTest.getCurrentLiveProcessItemFirstIndex(segments),
    -1,
    "live process animation should stop when content is the latest segment"
  );
}

{
  const segments = timelineRendererTest.buildLiveTimelineSegments([
    { kind: "content", text: "正在回答" },
    { kind: "notice", title: "已引用本地记忆", summary: "2 条" },
    { kind: "notice", title: "记忆已更新", summary: "1 条" }
  ], false);
  assert.strictEqual(
    timelineRendererTest.getCurrentLiveProcessItemFirstIndex(segments),
    1,
    "live process animation should target the latest item only while processing is latest"
  );
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
  assert.strictEqual(processed[0].entries[1].title, "$ node scripts/test-timeline.js 已完成");
  assert.strictEqual(processed[1].kind, "notice");
  assert.strictEqual(processed[2].type, "content");
}

{
  const processed = timelineRendererTest.buildProcessedIndex([
    { kind: "notice", title: "已引用本地记忆", summary: "2 条" },
    { kind: "notice", title: "记忆查询", summary: "找到 1 条" },
    { kind: "notice", title: "记忆已更新", summary: "1 条" }
  ]);
  assert.strictEqual(processed.length, 1, "consecutive notices should become one process item");
  assert.strictEqual(processed[0].kind, "notice");
  assert.strictEqual(processed[0].entries.length, 3);
  assert.strictEqual(processed[0].entries[2].title, "记忆已更新");
}

{
  const processed = timelineRendererTest.buildProcessedIndex([
    { kind: "notice", title: "已引用本地记忆", summary: "2 条" },
    { kind: "tool", title: "网页搜索已完成", summary: "query" },
    { kind: "notice", title: "记忆已更新", summary: "1 条" }
  ]);
  assert.strictEqual(processed.length, 3, "different process kinds should stay separate");
}

{
  const processed = timelineRendererTest.buildProcessedIndex([
    { kind: "error", title: "失败", summary: "A" },
    { kind: "error", title: "失败", summary: "B" }
  ]);
  assert.strictEqual(processed.length, 2, "errors should not be folded into ordinary process groups");
}

{
  const iconCalls = [];
  const renderer = createRenderer(iconCalls);
  const container = new FakeElement();
  renderer.renderTimelineEntry(container, {
    kind: "notice",
    title: "已引用本地记忆",
    summary: "提示词中引用了 1 条相关本地历史记录。",
    auditItems: [{ title: "偏好", summary: "紧凑输出" }]
  });
  assert(container.findByClass("codex-dock__notice-details-trigger"), "auditable notice title should be clickable");
  assert(container.findByClass("codex-dock__notice-details-icon"), "auditable notice should render the audit marker");
  assert(!iconCalls.some((call) => call.iconName === "clipboard-list"), "auditable notice should not use a heavy icon");
  assert(!iconCalls.some((call) => call.iconName === "chevron-right"), "auditable notice should not use a disclosure chevron");
}

{
  const reflection = {
    kind: "activity",
    noticeType: "reflection_candidate",
    title: "AI 连续性反思",
    summary: "提取了 2 项候选补充。",
    auditItems: [{
      title: "回答前评估 · 情绪",
      summary: "当前回答更谨慎。",
      fields: [{ label: "可见依据", value: "用户要求检查详情" }]
    }]
  };
  const ordinaryContainer = new FakeElement();
  createRenderer([], false).renderTimelineEntry(ordinaryContainer, reflection);
  assert(ordinaryContainer.findByClass("codex-dock__notice-details-trigger"), "reflection audit should be visible outside debug mode");

  const debugContainer = new FakeElement();
  createRenderer([], true).renderTimelineEntry(debugContainer, reflection);
  assert(debugContainer.findByClass("codex-dock__notice-details-trigger"), "debug reflection activity should open structured audit details");
  assert(debugContainer.findByClass("codex-dock__notice-details-icon"), "debug reflection activity should show the details marker");
}

{
  const fields = [
    { label: "Filtered", value: "Visible answer", preformatted: true },
    { label: "Raw", value: "<!-- hidden -->Visible answer", preformatted: true, debugOnly: true }
  ];
  assert.deepStrictEqual(
    memoryNoticeModalTest.getVisibleAuditFields(fields, false),
    [fields[0]],
    "ordinary mode should expose only the filtered reflection source"
  );
  assert.deepStrictEqual(
    memoryNoticeModalTest.getVisibleAuditFields(fields, true),
    fields,
    "debug mode should also expose the complete pre-filter source"
  );
}

{
  const iconCalls = [];
  const renderer = createRenderer(iconCalls);
  const container = new FakeElement();
  renderer.renderAuditableProcessedNoticeRow(container, {
    kind: "notice",
    title: "记忆已更新",
    auditItems: [{ title: "偏好", summary: "紧凑输出" }]
  });
  assert(container.findByClass("codex-dock__processed-item-summary"), "processed audit notice should render a top-level row");
  assert(container.findByClass("codex-dock__notice-details-icon"), "processed audit notice should render the audit marker");
  assert(!iconCalls.some((call) => call.iconName === "clipboard-list"), "processed audit notice should not use a heavy icon");
  assert(!iconCalls.some((call) => call.iconName === "chevron-right"), "processed audit notice should not look expandable");
}

{
  const iconCalls = [];
  const renderer = createRenderer(iconCalls);
  const container = new FakeElement();
  renderer.renderProcessedSubItemTitleRow(container, {
    kind: "notice",
    title: "深刻记忆已更新",
    auditItems: [{ title: "AI 反思", summary: "from reflection" }]
  }, { interactive: true });
  assert(container.findByClass("codex-dock__processed-subitem-summary"), "folded audit notice should render a subitem row");
  assert(container.findByClass("codex-dock__notice-details-icon"), "folded audit notice should render the audit marker");
  assert(!iconCalls.some((call) => call.iconName === "clipboard-list"), "folded audit notice should not use a heavy icon");
  assert(!iconCalls.some((call) => call.iconName === "chevron-right"), "folded audit notice should not use a disclosure chevron");
}

{
  const iconCalls = [];
  const renderer = createRenderer(iconCalls);
  const container = new FakeElement();
  renderer.renderChevron(container);
  assert(iconCalls.some((call) => call.iconName === "chevron-right"), "expandable rows should still use disclosure chevrons");
}

{
  let markdownRenderCalls = 0;
  let renderedMarkdown = "";
  let markdownRenderOptions = null;
  const modal = Object.create(MemoryNoticeModal.prototype);
  modal.renderMarkdownContent = (containerEl, text, options) => {
    markdownRenderCalls += 1;
    renderedMarkdown = text;
    markdownRenderOptions = options;
  };
  const container = new FakeElement();
  const valueEl = modal.renderFieldValue(container, "**bold** [[private note]] ![[embed.png]] [site](https://example.com) <iframe>");
  assert.strictEqual(markdownRenderCalls, 1, "audit field values should still use Markdown rendering");
  assert.strictEqual(
    renderedMarkdown,
    "**bold** [[private note]] ![[embed.png]] [site](https://example.com) <iframe>",
    "audit field rendering should receive the original captured evidence"
  );
  assert.deepStrictEqual(markdownRenderOptions, { restricted: true }, "audit field markdown should disable active embeds and raw HTML");
  assert.strictEqual(valueEl.text, "", "rendered markdown containers should not duplicate text fallback");
}

{
  const restricted = toRestrictedMarkdown([
    "**bold** [[private note]] ![[embed.png]] ![remote](https://example.com/image.png) <iframe src=\"https://example.com\">",
    "`![[inline-code]] <span>`",
    "```md",
    "![[fenced-code]] <iframe>",
    "```"
  ].join("\n"));
  assert.match(restricted, /\*\*bold\*\* \[\[private note\]\]/, "restricted markdown should preserve ordinary formatting and wiki links");
  assert.match(restricted, /\\!\[\[embed\.png\]\]/, "restricted markdown should neutralize wiki embeds");
  assert.match(restricted, /\\!\[remote\]\(https:\/\/example\.com\/image\.png\)/, "restricted markdown should neutralize remote images");
  assert.match(restricted, /&lt;iframe src="https:\/\/example\.com"&gt;/, "restricted markdown should escape raw HTML");
  assert.match(restricted, /`!\[\[inline-code\]\] <span>`/, "restricted markdown should leave inline code unchanged");
  assert.match(restricted, /```md\n!\[\[fenced-code\]\] <iframe>\n```/, "restricted markdown should leave fenced code unchanged");
  assert.strictEqual(
    toRestrictedMarkdown("\\![[already-safe]] \\\\![[active-after-literal-slash]]"),
    "\\![[already-safe]] \\\\\\![[active-after-literal-slash]]",
    "restricted markdown should preserve escaped embeds and neutralize embeds after literal backslashes"
  );
}

console.log("timeline tests passed");
