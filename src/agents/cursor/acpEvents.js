function acpUpdateToEvents(update, translate = defaultTranslate) {
  if (!update || typeof update !== "object") {
    return [];
  }

  const sessionUpdate = update.sessionUpdate || update.type || "unknown";

  if (sessionUpdate === "agent_message_chunk") {
    const text = extractChunkText(update.content);
    return text ? [{ kind: "content", text }] : [];
  }

  if (sessionUpdate === "agent_thought_chunk") {
    const detail = extractChunkText(update.content);
    return detail ? [{
      kind: "reasoning",
      title: translate("cursor.thinking"),
      detail
    }] : [];
  }

  if (sessionUpdate === "user_message_chunk") {
    return [];
  }

  if (sessionUpdate === "tool_call") {
    return [{
      kind: "tool",
      toolCallId: update.toolCallId || "",
      title: update.title || update.kind || translate("cursor.toolCall"),
      summary: formatToolCallSummary(update, translate),
      detail: formatToolCallDetail(update)
    }];
  }

  if (sessionUpdate === "tool_call_update") {
    return [{
      kind: "tool",
      toolCallId: update.toolCallId || "",
      title: update.title || translate("cursor.toolCall"),
      summary: formatToolCallUpdateSummary(update, translate),
      detail: formatToolCallUpdateDetail(update)
    }];
  }

  if (sessionUpdate === "plan" || sessionUpdate === "plan_update") {
    return [{
      kind: "reasoning",
      title: translate("cursor.plan"),
      detail: formatPlanDetail(update),
      // Standalone plan blocks must not merge into streamed thought chunks.
      discrete: true
    }];
  }

  if (sessionUpdate === "current_mode_update") {
    const mode = update.mode || update.currentMode || "";
    return [{
      kind: "notice",
      title: translate("cursor.modeUpdated.title"),
      summary: mode ? translate("cursor.modeUpdated.summary", { mode }) : translate("cursor.modeUpdated.summaryGeneric")
    }];
  }

  if (sessionUpdate === "available_commands_update" || sessionUpdate === "usage_update") {
    return [];
  }

  if (sessionUpdate === "plan_removed") {
    return [{
      kind: "notice",
      title: translate("cursor.planRemoved"),
      summary: ""
    }];
  }

  return [{
    kind: "activity",
    title: sessionUpdate,
    detail: compactJson(update)
  }];
}

function extractChunkText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!content || typeof content !== "object") {
    return "";
  }
  if (content.type === "text" && typeof content.text === "string") {
    return content.text;
  }
  if (typeof content.text === "string") {
    return content.text;
  }
  return "";
}

function formatToolCallSummary(update, translate) {
  const parts = [];
  if (update.kind) {
    parts.push(String(update.kind));
  }
  if (update.status) {
    parts.push(String(update.status));
  }
  const input = summarizeRawInput(update.rawInput);
  if (input) {
    parts.push(compactOneLine(input));
  }
  return compactOneLine(parts.join(" | ") || update.title || translate("cursor.toolCall"));
}

function formatToolCallDetail(update) {
  const parts = [];
  if (update.title) {
    parts.push(update.title);
  }
  if (update.kind) {
    parts.push(`kind: ${update.kind}`);
  }
  if (update.status) {
    parts.push(`status: ${update.status}`);
  }
  const input = summarizeRawInput(update.rawInput);
  if (input) {
    parts.push(input);
  }
  if (Array.isArray(update.locations) && update.locations.length > 0) {
    parts.push(update.locations.map((entry) => entry.path || compactJson(entry)).join("\n"));
  }
  return parts.join("\n\n") || compactJson(update);
}

function formatToolCallUpdateSummary(update, translate) {
  const parts = [];
  if (update.status) {
    parts.push(String(update.status));
  }
  const output = extractToolOutput(update);
  if (output) {
    parts.push(compactOneLine(output));
  }
  return compactOneLine(parts.join(" | ") || translate("cursor.toolCall"));
}

function formatToolCallUpdateDetail(update) {
  const parts = [];
  if (update.status) {
    parts.push(`status: ${update.status}`);
  }
  if (update.rawOutput !== undefined) {
    parts.push(formatRawOutput(update.rawOutput));
  }
  if (Array.isArray(update.content) && update.content.length > 0) {
    parts.push(update.content.map((entry) => extractChunkText(entry) || compactJson(entry)).filter(Boolean).join("\n"));
  }
  if (update.appendContent) {
    parts.push(extractChunkText(update.appendContent) || compactJson(update.appendContent));
  }
  return parts.join("\n\n") || compactJson(update);
}

function formatPlanDetail(update) {
  const parts = [];
  if (update.description) {
    parts.push(String(update.description));
  }
  if (Array.isArray(update.steps)) {
    for (const [index, step] of update.steps.entries()) {
      const label = typeof step === "string" ? step : step.content || step.title || compactJson(step);
      const status = typeof step === "object" && step.status ? ` (${step.status})` : "";
      parts.push(`${index + 1}. ${label}${status}`);
    }
  }
  return parts.join("\n") || compactJson(update);
}

function summarizeRawInput(rawInput) {
  if (rawInput === undefined || rawInput === null) {
    return "";
  }
  if (typeof rawInput === "string") {
    return rawInput;
  }
  if (typeof rawInput === "object") {
    for (const key of ["command", "path", "query", "pattern", "description"]) {
      if (typeof rawInput[key] === "string" && rawInput[key]) {
        return rawInput[key];
      }
    }
    return compactJson(rawInput);
  }
  return String(rawInput);
}

function extractToolOutput(update) {
  if (typeof update.rawOutput === "string") {
    return update.rawOutput;
  }
  if (Array.isArray(update.content)) {
    return update.content
      .map((entry) => extractChunkText(entry) || (typeof entry === "string" ? entry : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function formatRawOutput(rawOutput) {
  if (typeof rawOutput === "string") {
    return rawOutput;
  }
  return compactJson(rawOutput);
}

function compactOneLine(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function compactJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function defaultTranslate(key, params = {}) {
  const defaults = {
    "cursor.thinking": "Thinking",
    "cursor.userEcho": "User echo",
    "cursor.toolCall": "Tool call",
    "cursor.plan": "Plan",
    "cursor.planRemoved": "Plan removed",
    "cursor.modeUpdated.title": "Mode updated",
    "cursor.modeUpdated.summary": "Cursor mode is now {mode}.",
    "cursor.modeUpdated.summaryGeneric": "Cursor mode changed.",
    "cursor.usage": "Usage"
  };
  return String(defaults[key] || key).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    params[name] === undefined ? match : String(params[name])
  ));
}

module.exports = {
  acpUpdateToEvents
};
