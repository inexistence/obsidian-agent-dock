async function buildPrompt(app, settings, prompt, conversation) {
  const promptParts = [];

  if (!settings.includeActiveNote) {
    promptParts.push(formatConversationPrompt(prompt, conversation));
    return promptParts.join("\n");
  }

  const file = app.workspace.getActiveFile();
  if (!file) {
    promptParts.push(formatConversationPrompt(prompt, conversation));
    return promptParts.join("\n");
  }

  const note = await app.vault.cachedRead(file);
  const maxChars = Number(settings.activeNoteMaxChars) || 6000;
  const clippedNote = note.length > maxChars
    ? `${note.slice(0, maxChars)}\n\n[Note clipped]`
    : note;

  promptParts.push(
    `Active Obsidian note: ${file.path}`,
    "",
    clippedNote,
    "",
    formatConversationPrompt(prompt, conversation)
  );

  return promptParts.join("\n");
}

function formatConversationPrompt(prompt, conversation) {
  if (!conversation || conversation.length <= 1) {
    return ["User request:", prompt].join("\n");
  }

  const transcript = conversation
    .map((message) => `${message.role === "user" ? "User" : "Agent"}: ${message.content}`)
    .join("\n\n");

  return [
    "Conversation so far:",
    transcript,
    "",
    "Respond to the latest user request."
  ].join("\n");
}

module.exports = {
  buildPrompt
};
