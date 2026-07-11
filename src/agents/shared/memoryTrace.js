const { formatRecallLine } = require("../../storage/MemoryRecallPacket");
const { redactSensitiveText } = require("../../storage/sensitiveText");

const MAX_TRACE_SOURCE_MEMORIES = 12;

function shouldTracePreviousAnswer(prompt) {
  return /(?:为什么这么说|为什么这样说|依据是什么|来源是什么|从哪里(?:看到|知道|得出)|证据(?:是|呢|在哪)|怎么知道的|why (?:did you|do you) say|what(?:'s| is) (?:the )?(?:source|evidence)|where did (?:that|this) come from)/i
    .test(String(prompt || ""));
}

async function getPreviousAnswerMemoryTrace(memoryStore, prompt, conversation) {
  if (!shouldTracePreviousAnswer(prompt)) {
    return null;
  }
  const previousAssistant = findPreviousAssistantMessage(conversation);
  const previousUser = findPreviousUserMessage(conversation, previousAssistant);
  const conversationTrace = formatConversationTrace(previousUser, previousAssistant);
  const provenance = previousAssistant?.memoryProvenance;
  const available = Array.isArray(provenance?.available) ? provenance.available : [];
  if (available.length === 0) {
    return {
      performed: true,
      claimed: false,
      items: [],
      prompt: formatEmptyTracePrompt(conversationTrace)
    };
  }

  const claimedRefs = new Set(provenance.claimedUsedRefs || []);
  const selectedRefs = claimedRefs.size > 0
    ? available.filter((item) => claimedRefs.has(item.ref))
    : available;
  const memories = await memoryStore.getMemoriesByIds(selectedRefs.map((item) => item.memoryId));
  const byId = new Map(memories.map((item) => [item.id, item]));
  const items = selectedRefs
    .map((reference) => {
      const memory = byId.get(reference.memoryId);
      return memory ? Object.assign({}, memory, { recallRef: reference.ref }) : null;
    })
    .filter(Boolean);
  await attachSourceMemoryGraph(memoryStore, items, 3);

  return {
    performed: true,
    claimed: claimedRefs.size > 0,
    items,
    prompt: formatMemoryTracePrompt(items, claimedRefs.size > 0, conversationTrace)
  };
}

function formatMemoryTracePrompt(items, claimed, conversationTrace = "") {
  const heading = claimed
    ? "Evidence trace for the previous assistant answer:"
    : "Memory context available to the previous assistant answer:";
  const instruction = claimed
    ? "These references were explicitly cited by the answer's reflection metadata. Explain the source chain briefly and distinguish summary from exact quotation."
    : "These memories were available in the previous prompt, but there is no validated record proving which one caused the wording. Be explicit about that limitation; do not claim they were definitely used.";
  if (!Array.isArray(items) || items.length === 0) {
    return `${heading}\n${conversationTrace}\n- The referenced local memories are no longer available.\n${instruction}\n`;
  }
  return [
    heading,
    conversationTrace,
    ...items.flatMap((item) => [
      formatRecallLine(item, { explicit: true }),
      ...formatSourceMemoryLines(item.sourceMemories, 1, new Set([item.id]))
    ]),
    instruction,
    ""
  ].join("\n");
}

async function attachSourceMemoryGraph(memoryStore, roots, maxDepth) {
  const byId = new Map((roots || []).map((item) => [item.id, item]));
  let loadedSourceCount = 0;
  let frontier = roots || [];
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const sourceIds = [...new Set(frontier.flatMap((item) => (
      (item.evidenceRefs || []).map((evidence) => evidence.sourceMemoryId).filter(Boolean)
    )))].filter((id) => !byId.has(id))
      .slice(0, Math.max(0, MAX_TRACE_SOURCE_MEMORIES - loadedSourceCount));
    if (sourceIds.length === 0) {
      break;
    }
    const loaded = await memoryStore.getMemoriesByIds(sourceIds);
    loadedSourceCount += loaded.length;
    for (const item of loaded) {
      byId.set(item.id, item);
    }
    frontier = loaded;
  }
  for (const item of byId.values()) {
    item.sourceMemories = (item.evidenceRefs || [])
      .map((evidence) => byId.get(evidence.sourceMemoryId))
      .filter(Boolean);
  }
}

function formatSourceMemoryLines(items, depth, visited) {
  const lines = [];
  for (const source of items || []) {
    if (!source?.id || visited.has(source.id)) {
      continue;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(source.id);
    const indent = "  ".repeat(Math.min(depth, 3));
    lines.push(`${indent}↳ Source memory: ${formatRecallLine(Object.assign({}, source, { recallRef: "source" }), { explicit: true }).replace(/^- /, "")}`);
    lines.push(...formatSourceMemoryLines(source.sourceMemories, depth + 1, nextVisited));
  }
  return lines;
}

function formatEmptyTracePrompt(conversationTrace = "") {
  return [
    "Evidence trace for the previous assistant answer:",
    conversationTrace,
    "- No persisted memory references were recorded for that answer.",
    "Say that no auditable memory reference was recorded. The visible preceding request may still explain the answer; distinguish that current-session context from durable memory. You may re-check current files or local memory if useful, but do not invent a prior source.",
    ""
  ].join("\n");
}

function formatConversationTrace(message, assistantMessage) {
  const lines = [];
  if (!message?.content) {
    lines.push("- No preceding visible user message was available for this trace.");
  } else {
    const id = message.id ? `; message=${message.id}` : "";
    const date = Number(message.createdAt) > 0
    ? `; observed=${new Date(message.createdAt).toISOString()}`
    : "";
    lines.push(`- Preceding current-session user request [origin=user_message; speaker=user${id}${date}]: “${truncateText(redactSensitiveText(message.content), 240)}”`);
  }
  const toolEntries = (Array.isArray(assistantMessage?.timeline) ? assistantMessage.timeline : [])
    .filter((entry) => entry?.kind === "tool")
    .slice(0, 5);
  for (const entry of toolEntries) {
    const description = redactSensitiveText([entry.title, entry.summary].filter(Boolean).join(" — "));
    if (description) {
      lines.push(`- Previous-answer tool/file context [origin=tool_result; speaker=none; type=${entry.toolType || "tool"}]: ${truncateText(description, 240)}`);
    }
  }
  if (toolEntries.length > 0) {
    lines.push("- Tool/file entries show visible activity available around the answer, not proof that a particular claim came from them.");
  }
  return lines.join("\n");
}

function findPreviousAssistantMessage(conversation) {
  for (let index = (Array.isArray(conversation) ? conversation.length : 0) - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    if (message?.role === "assistant") {
      return message;
    }
  }
  return null;
}

function findPreviousUserMessage(conversation, previousAssistant) {
  const messages = Array.isArray(conversation) ? conversation : [];
  const assistantIndex = previousAssistant ? messages.indexOf(previousAssistant) : messages.length;
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index];
    }
  }
  return null;
}

function truncateText(value, maxChars) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;
}

module.exports = {
  getPreviousAnswerMemoryTrace,
  shouldTracePreviousAnswer,
  _test: {
    findPreviousAssistantMessage,
    findPreviousUserMessage,
    formatMemoryTracePrompt
  }
};
