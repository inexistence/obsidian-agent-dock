function codexJsonEventToUpdates(event) {
  if (!event || typeof event !== "object") {
    return [];
  }

  const type = event.type || "event";
  const item = event.item;

  if (type === "error") {
    return [{ kind: "error", title: "Error", detail: extractText(event) || compactJson(event) }];
  }

  if (type === "thread.started") {
    return [{ kind: "activity", title: "Thread started", detail: event.thread_id || "" }];
  }

  if (type === "turn.started") {
    return [{ kind: "activity", title: "Turn started", detail: "" }];
  }

  if (type === "turn.completed") {
    return [{ kind: "activity", title: "Turn completed", detail: formatUsage(event.usage) }];
  }

  if (type === "turn.failed") {
    return [{ kind: "error", title: "Turn failed", detail: extractText(event) || compactJson(event) }];
  }

  if (!item || typeof item !== "object") {
    return [{ kind: "activity", title: type, detail: compactJson(event) }];
  }

  if (item.type === "agent_message") {
    const text = extractText(item);
    return text ? [{ kind: "content", text }] : [];
  }

  if (item.type === "reasoning") {
    return [{
      kind: "reasoning",
      title: type === "item.started" ? "Thinking..." : "Thinking",
      detail: extractText(item) || summarizeItem(item)
    }];
  }

  if (item.type === "command_execution") {
    return [{
      kind: "tool",
      title: formatCommandTitle(type, item),
      summary: formatCommandSummary(item),
      detail: formatCommandExecution(item)
    }];
  }

  if (isToolItem(item)) {
    const summary = extractText(item) || summarizeItem(item);
    return [{
      kind: "tool",
      title: formatEventTitle(type, formatToolTitle(item)),
      summary: compactOneLine(summary),
      detail: summary
    }];
  }

  if (item.type === "web_search") {
    const summary = extractText(item) || summarizeItem(item);
    return [{
      kind: "tool",
      title: formatEventTitle(type, "Web search"),
      summary: compactOneLine(summary),
      detail: summary
    }];
  }

  if (type.startsWith("item.")) {
    return [{
      kind: "activity",
      title: formatEventTitle(type, item.type || "Item"),
      detail: extractText(item) || summarizeItem(item)
    }];
  }

  return [{ kind: "activity", title: type, detail: compactJson(event) }];
}

function extractText(value) {
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? value : "";
  }

  for (const key of ["text", "message", "content", "output", "result", "summary"]) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      return candidate;
    }
    if (Array.isArray(candidate)) {
      const joined = candidate
        .map((entry) => typeof entry === "string" ? entry : extractText(entry))
        .filter(Boolean)
        .join("\n");
      if (joined) {
        return joined;
      }
    }
  }

  return "";
}

function isToolItem(item) {
  return [
    "tool_call",
    "mcp_tool_call",
    "function_call",
    "local_shell",
    "patch",
    "file_change"
  ].includes(item.type);
}

function formatToolTitle(item) {
  return item.name || item.tool_name || item.server_name || item.type || "Tool";
}

function formatEventTitle(eventType, label) {
  if (eventType === "item.started") {
    return `${label} started`;
  }
  if (eventType === "item.completed") {
    return `${label} completed`;
  }
  if (eventType === "item.failed") {
    return `${label} failed`;
  }
  return label;
}

function formatCommandTitle(eventType, item) {
  const command = formatCommand(item.command);
  const label = command ? `$ ${compactOneLine(command)}` : "Command";
  return formatEventTitle(eventType, label);
}

function formatCommandSummary(item) {
  const parts = [];
  const command = formatCommand(item.command);
  if (command) {
    parts.push(command);
  }
  if (item.exit_code !== undefined) {
    parts.push(`exit code: ${item.exit_code}`);
  }
  const text = extractText(item);
  if (text) {
    parts.push(compactOneLine(text));
  }
  return compactOneLine(parts.join(" | "));
}

function formatCommandExecution(item) {
  const parts = [];
  const command = formatCommand(item.command);
  if (command) {
    parts.push(`$ ${command}`);
  }
  if (item.exit_code !== undefined) {
    parts.push(`exit code: ${item.exit_code}`);
  }
  const text = extractText(item);
  if (text) {
    parts.push(text);
  }
  return parts.join("\n\n") || summarizeItem(item);
}

function formatCommand(command) {
  if (Array.isArray(command)) {
    return command.map((part) => String(part)).join(" ");
  }
  if (command === undefined || command === null) {
    return "";
  }
  return String(command);
}

function compactOneLine(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function formatUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return "";
  }

  const parts = [];
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === "number") {
      parts.push(`${key}: ${value}`);
    }
  }
  return parts.join(", ");
}

function summarizeItem(item) {
  const summary = {};
  for (const key of ["type", "status", "name", "tool_name", "server_name", "command", "exit_code", "path"]) {
    if (item[key] !== undefined) {
      summary[key] = item[key];
    }
  }
  return Object.keys(summary).length > 0 ? compactJson(summary) : compactJson(item);
}

function compactJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

module.exports = {
  codexJsonEventToUpdates
};
