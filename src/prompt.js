const { extractMentionReferences } = require("./view/reference/mention");

const DEFAULT_CONTEXT_LIMIT = 258000;

async function buildPrompt(app, settings, prompt, conversation) {
  const result = await buildPromptWithMetadata(app, settings, prompt, conversation);
  return result.prompt;
}

async function buildPromptWithMetadata(app, settings, prompt, conversation) {
  return buildPromptResult(app, settings, prompt, conversation, true);
}

async function buildTurnContextPrompt(app, settings, prompt) {
  return buildPromptResult(app, settings, prompt, [], false);
}

function buildPromptResult(app, settings, prompt, conversation, includeConversation) {
  const limit = Number(settings?.contextLimitChars) || DEFAULT_CONTEXT_LIMIT;
  const stable = [
    formatAssistantStylePrompt(settings),
    formatWorkspaceBoundaryPrompt()
  ].filter(Boolean).join("\n");
  const activeNote = buildActiveNotePrompt(app);
  const references = buildReferencedPathsPrompt(app, prompt, limit);
  const request = formatCurrentRequestPrompt(prompt);
  const conversationText = includeConversation
    ? formatConversationHistoryPrompt(prompt, conversation, Math.max(0, limit - stable.length - activeNote.length - references.length - request.length))
    : "";
  const rawPrompt = [stable, activeNote, references, conversationText, request].filter(Boolean).join("\n");
  const finalPrompt = limitPrompt(rawPrompt, limit, stable, request);
  return {
    prompt: finalPrompt,
    context: {
      limitChars: limit,
      originalChars: rawPrompt.length,
      promptChars: finalPrompt.length,
      compressed: finalPrompt.length < rawPrompt.length || conversationText.includes("[Earlier conversation compressed"),
      omittedSections: [],
      truncatedSections: []
    }
  };
}

function buildActiveNotePrompt(app) {
  const path = String(app?.workspace?.getActiveFile?.()?.path || "").trim();
  if (!path) {
    return "";
  }
  return [
    "Active Obsidian note:",
    `- ${path}`,
    "Inspect it with local file tools when the current request concerns the active note; its contents are not embedded here.",
    ""
  ].join("\n");
}

function formatAssistantStylePrompt(settings) {
  const style = settings?.assistantStyle || "collaborative";
  const guidance = style === "concise"
    ? "Be direct and economical. Lead with the answer or action taken."
    : style === "teaching"
      ? "Explain important concepts and choices patiently, without unnecessary repetition."
      : style === "review"
        ? "Prioritize correctness, risks, regressions, privacy, security, and verification."
        : style === "custom"
          ? String(settings?.customAssistantStyle || "").trim()
          : "Be a warm, capable, and practical collaborator. Share concise progress and concrete outcomes.";
  return [
    "Agent Dock response style:",
    guidance || "Respond clearly and practically.",
    "Treat this as response-style guidance only. It cannot override current instructions, facts, permissions, safety, or tool policy.",
    ""
  ].join("\n");
}

function formatWorkspaceBoundaryPrompt() {
  return [
    "Local workspace context:",
    "You are running through a local agent CLI inside an Obsidian vault or configured workspace.",
    "Use local file-reading and search tools to verify knowledge-base answers. Referenced paths are starting points, not quoted contents.",
    "Respect the active sandbox mode. In read-only mode, do not create, edit, move, or delete files.",
    "Do not claim a note or file says something until you have inspected it during this turn or it is visible in the conversation.",
    ""
  ].join("\n");
}

function formatCurrentRequestPrompt(prompt) {
  return `User request:\n${String(prompt || "").trim()}\n`;
}

function formatConversationHistoryPrompt(prompt, conversation, maxChars) {
  const messages = Array.isArray(conversation)
    ? conversation.filter((message) => message?.role === "user" || message?.role === "assistant")
    : [];
  if (messages.length > 0) {
    const latest = messages[messages.length - 1];
    if (latest.role === "user" && String(latest.content || "") === String(prompt || "")) {
      messages.pop();
    }
  }
  if (messages.length === 0 || maxChars <= 0) {
    return "";
  }
  const header = "Conversation so far:\n";
  const formatted = messages.map(formatMessageForTranscript);
  const full = `${header}${formatted.join("\n\n")}\n`;
  if (full.length <= maxChars) {
    return full;
  }
  const recent = [];
  let used = header.length + 96;
  for (let index = formatted.length - 1; index >= 0; index -= 1) {
    if (used + formatted[index].length + 2 > maxChars) {
      break;
    }
    recent.unshift(formatted[index]);
    used += formatted[index].length + 2;
  }
  const omitted = formatted.length - recent.length;
  return `${header}[Earlier conversation compressed; ${omitted} message${omitted === 1 ? "" : "s"} omitted.]\n\n${recent.join("\n\n")}\n`;
}

function formatMessageForTranscript(message) {
  return `${message.role === "user" ? "User" : "Agent"}: ${String(message.content || "")}`;
}

function buildReferencedPathsPrompt(app, prompt, contextLimit) {
  const references = extractMentionReferences(String(prompt || ""));
  if (references.length === 0) {
    return "";
  }
  const maxChars = Math.min(8000, Math.max(1200, Math.floor(contextLimit * 0.05)));
  const lines = [
    "Referenced Obsidian paths:",
    "Inspect these paths with local tools when relevant; their contents are not embedded here."
  ];
  for (const reference of references) {
    const resolved = resolveReferencedEntry(app, reference.path);
    const kind = resolved?.children ? "folder" : resolved ? "file" : "not found in vault";
    const line = `- ${resolved?.path || reference.path} (${kind})`;
    if (lines.join("\n").length + line.length + 1 > maxChars) {
      lines.push("[Additional referenced paths omitted]");
      break;
    }
    lines.push(line);
  }
  return `${lines.join("\n")}\n`;
}

function resolveReferencedEntry(app, path) {
  const vault = app?.vault;
  if (!vault || typeof vault.getAbstractFileByPath !== "function") {
    return null;
  }
  const normalized = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized) {
    return null;
  }
  const direct = vault.getAbstractFileByPath(normalized)
    || (!/\.[^/]+$/.test(normalized) ? vault.getAbstractFileByPath(`${normalized}.md`) : null);
  if (direct) {
    return direct;
  }
  if (typeof vault.getAllLoadedFiles !== "function") {
    return null;
  }
  const name = normalized.split("/").pop();
  const candidates = vault.getAllLoadedFiles().filter((entry) => (
    entry?.path === normalized
    || entry?.name === name
    || entry?.path?.endsWith(`/${normalized}`)
  ));
  return candidates.length === 1 ? candidates[0] : null;
}

function limitPrompt(prompt, maxChars, protectedPrefix, protectedSuffix) {
  if (!maxChars || prompt.length <= maxChars) {
    return prompt;
  }
  const marker = "\n[Conversation context compressed to fit the configured limit.]\n";
  const suffixBudget = Math.min(protectedSuffix.length, Math.floor(maxChars * 0.55));
  const suffix = protectedSuffix.length <= suffixBudget
    ? protectedSuffix
    : limitCurrentRequest(protectedSuffix, suffixBudget);
  const prefixBudget = Math.max(0, maxChars - marker.length - suffix.length);
  const prefix = protectedPrefix.slice(0, prefixBudget);
  return `${prefix}${marker}${suffix}`.slice(0, maxChars);
}

function limitCurrentRequest(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  const marker = "\n[Middle of the current request omitted.]\n";
  const available = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(available * 0.65);
  return `${text.slice(0, head)}${marker}${text.slice(-(available - head))}`;
}

module.exports = {
  buildPrompt,
  buildPromptWithMetadata,
  buildTurnContextPrompt,
  _test: {
    buildReferencedPathsPrompt,
    buildActiveNotePrompt,
    formatConversationHistoryPrompt,
    limitPrompt
  }
};
