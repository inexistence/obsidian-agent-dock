function codexJsonEventToUpdates(event, translate = defaultTranslate) {
  if (!event || typeof event !== "object") {
    return [];
  }

  const type = event.type || "event";
  const item = event.item;

  if (type === "error") {
    return [{ kind: "error", title: translate("codex.error"), detail: extractText(event) || compactJson(event) }];
  }

  if (type === "thread.started") {
    return [{ kind: "activity", title: translate("codex.threadStarted"), detail: event.thread_id || "" }];
  }

  if (type === "turn.started") {
    return [{ kind: "activity", title: translate("codex.turnStarted"), detail: "" }];
  }

  if (type === "turn.completed") {
    return [{ kind: "activity", title: translate("codex.turnCompleted"), detail: formatUsage(event.usage) }];
  }

  if (type === "turn.failed") {
    return [{ kind: "error", title: translate("codex.turnFailed"), detail: extractText(event) || compactJson(event) }];
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
      title: type === "item.started" ? translate("codex.thinkingStarted") : translate("codex.thinking"),
      detail: extractText(item) || summarizeItem(item)
    }];
  }

  if (item.type === "command_execution") {
    return [{
      kind: "tool",
      title: formatCommandTitle(type, item, translate),
      summary: formatCommandSummary(item, translate),
      detail: formatCommandExecution(item, translate)
    }];
  }

  if (isToolItem(item)) {
    const summary = extractText(item) || summarizeItem(item);
    return [{
      kind: "tool",
      title: formatEventTitle(type, formatToolTitle(item), translate),
      summary: compactOneLine(summary),
      detail: summary
    }];
  }

  if (item.type === "web_search") {
    const summary = extractText(item) || summarizeItem(item);
    return [{
      kind: "tool",
      title: formatEventTitle(type, translate("codex.webSearch"), translate),
      summary: compactOneLine(summary),
      detail: summary
    }];
  }

  if (type.startsWith("item.")) {
    return [{
      kind: "activity",
      title: formatEventTitle(type, item.type || translate("codex.item"), translate),
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

function formatEventTitle(eventType, label, translate = defaultTranslate) {
  if (eventType === "item.started") {
    return translate("codex.started", { label });
  }
  if (eventType === "item.completed") {
    return translate("codex.completed", { label });
  }
  if (eventType === "item.failed") {
    return translate("codex.failed", { label });
  }
  return label;
}

function formatCommandTitle(eventType, item, translate = defaultTranslate) {
  const command = formatCommand(item.command);
  const label = command ? `$ ${compactOneLine(command)}` : translate("codex.command");
  return formatEventTitle(eventType, label, translate);
}

function formatCommandSummary(item, translate = defaultTranslate) {
  const parts = [];
  const command = formatCommand(item.command);
  if (command) {
    parts.push(command);
  }
  if (item.exit_code !== undefined) {
    parts.push(translate("codex.exitCode", { code: item.exit_code }));
  }
  const text = extractText(item);
  if (text) {
    parts.push(compactOneLine(text));
  }
  return compactOneLine(parts.join(" | "));
}

function formatCommandExecution(item, translate = defaultTranslate) {
  const parts = [];
  const command = formatCommand(item.command);
  if (command) {
    parts.push(`$ ${command}`);
  }
  if (item.exit_code !== undefined) {
    parts.push(translate("codex.exitCode", { code: item.exit_code }));
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

function defaultTranslate(key, params = {}) {
  const defaults = {
    "codex.error": "Error",
    "codex.threadStarted": "Thread started",
    "codex.turnStarted": "Turn started",
    "codex.turnCompleted": "Turn completed",
    "codex.turnFailed": "Turn failed",
    "codex.thinkingStarted": "Thinking...",
    "codex.thinking": "Thinking",
    "codex.webSearch": "Web search",
    "codex.item": "Item",
    "codex.command": "Command",
    "codex.started": "{label} started",
    "codex.completed": "{label} completed",
    "codex.failed": "{label} failed",
    "codex.exitCode": "exit code: {code}"
  };
  return String(defaults[key] || key).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    params[name] === undefined ? match : String(params[name])
  ));
}

module.exports = {
  codexJsonEventToUpdates
};
