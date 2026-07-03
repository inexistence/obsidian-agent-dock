async function buildPrompt(app, settings, prompt, conversation) {
  const result = await buildPromptWithMetadata(app, settings, prompt, conversation);
  return result.prompt;
}

async function buildPromptWithMetadata(app, settings, prompt, conversation) {
  const promptParts = [];
  const contextLimit = Number(settings.contextLimitChars) || 258000;

  if (!settings.includeActiveNote) {
    promptParts.push(formatConversationPrompt(prompt, conversation, contextLimit));
    return buildPromptResult(promptParts.join("\n"), contextLimit);
  }

  const file = app.workspace.getActiveFile();
  if (!file) {
    promptParts.push(formatConversationPrompt(prompt, conversation, contextLimit));
    return buildPromptResult(promptParts.join("\n"), contextLimit);
  }

  const note = await app.vault.cachedRead(file);
  const maxChars = Number(settings.activeNoteMaxChars) || 6000;
  const clippedNote = note.length > maxChars
    ? `${note.slice(0, maxChars)}\n\n[Note clipped]`
    : note;

  const notePrompt = [
    `Active Obsidian note: ${file.path}`,
    "",
    clippedNote,
    ""
  ].join("\n");
  const conversationBudget = Math.max(1000, contextLimit - notePrompt.length);

  promptParts.push(
    notePrompt,
    formatConversationPrompt(prompt, conversation, conversationBudget)
  );

  return buildPromptResult(promptParts.join("\n"), contextLimit);
}

function formatConversationPrompt(prompt, conversation, maxChars) {
  if (!conversation || conversation.length <= 1) {
    return ["User request:", prompt].join("\n");
  }

  const transcript = formatConversationTranscript(conversation, maxChars);

  return [
    "Conversation so far:",
    transcript,
    "",
    "Respond to the latest user request."
  ].join("\n");
}

function formatConversationTranscript(conversation, maxChars) {
  const fullTranscript = conversation.map(formatMessageForTranscript).join("\n\n");
  if (!maxChars || fullTranscript.length <= maxChars) {
    return fullTranscript;
  }

  const latestMessage = conversation[conversation.length - 1];
  const latestText = formatMessageForTranscript(latestMessage);
  const summaryHeader = `[Earlier conversation compressed because it exceeded the context character limit. Original messages: ${conversation.length - 1}.]`;
  const availableForRecent = Math.max(0, maxChars - latestText.length - summaryHeader.length - 8);
  const recentMessages = [];
  let used = 0;

  for (let index = conversation.length - 2; index >= 0; index -= 1) {
    const formatted = formatMessageForTranscript(conversation[index]);
    const nextUsed = used + formatted.length + (recentMessages.length > 0 ? 2 : 0);
    if (nextUsed > availableForRecent) {
      break;
    }
    recentMessages.unshift(formatted);
    used = nextUsed;
  }

  const omittedCount = Math.max(0, conversation.length - 1 - recentMessages.length);
  const compressedSummary = summarizeMessages(conversation.slice(0, omittedCount), summaryHeader);
  const compressedTranscript = [
    compressedSummary,
    recentMessages.join("\n\n"),
    latestText
  ].filter(Boolean).join("\n\n");

  return limitCompressedTranscript(compressedTranscript, latestText, maxChars);
}

function summarizeMessages(messages, header) {
  if (messages.length === 0) {
    return "";
  }

  const maxSummaryChars = 12000;
  const lines = [header];
  let used = header.length;

  for (const message of messages) {
    const content = compactText(message.content);
    const line = `- ${message.role === "user" ? "User" : "Agent"}: ${truncateText(content, 500)}`;
    if (used + line.length + 1 > maxSummaryChars) {
      lines.push(`- ... ${messages.length - lines.length + 1} earlier messages omitted`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
}

function formatMessageForTranscript(message) {
  return `${message.role === "user" ? "User" : "Agent"}: ${message.content}`;
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 3) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - 3)}...`;
}

function limitCompressedTranscript(transcript, latestText, maxChars) {
  if (!maxChars || transcript.length <= maxChars) {
    return transcript;
  }

  if (latestText.length >= maxChars) {
    return truncateText(latestText, maxChars);
  }

  const prefixBudget = Math.max(0, maxChars - latestText.length - 2);
  const prefix = truncateText(transcript.slice(0, transcript.length - latestText.length), prefixBudget);
  return [prefix, latestText].filter(Boolean).join("\n\n");
}

function limitPrompt(prompt, maxChars) {
  if (!maxChars || prompt.length <= maxChars) {
    return prompt;
  }

  const notice = "[Prompt compressed to fit the configured context character limit.]\n\n";
  const available = Math.max(0, maxChars - notice.length);
  if (available === 0) {
    return notice.slice(0, maxChars);
  }
  return `${notice}${prompt.slice(prompt.length - available)}`;
}

function buildPromptResult(rawPrompt, contextLimit) {
  const prompt = limitPrompt(rawPrompt, contextLimit);
  return {
    prompt,
    context: {
      limitChars: contextLimit,
      originalChars: rawPrompt.length,
      promptChars: prompt.length,
      compressed: prompt.length < rawPrompt.length || rawPrompt.includes("[Earlier conversation compressed")
    }
  };
}

module.exports = {
  buildPrompt,
  buildPromptWithMetadata
};
