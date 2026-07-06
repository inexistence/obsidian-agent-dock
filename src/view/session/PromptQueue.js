function ensurePromptQueue(session) {
  if (!session) {
    return [];
  }
  if (!Array.isArray(session.promptQueue)) {
    session.promptQueue = [];
  }
  return session.promptQueue;
}

function normalizePromptQueue(queue) {
  if (!Array.isArray(queue)) {
    return [];
  }

  return queue.map((entry) => {
    if (typeof entry === "string") {
      return createPromptQueueEntry(entry);
    }
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const text = String(entry.text || "").trim();
    if (!text) {
      return null;
    }
    return {
      id: typeof entry.id === "string" && entry.id ? entry.id : createPromptQueueId(),
      text,
      createdAt: normalizeTimestamp(entry.createdAt)
    };
  }).filter(Boolean);
}

function enqueuePrompt(session, prompt) {
  const entry = createPromptQueueEntry(prompt);
  if (!entry) {
    return null;
  }
  ensurePromptQueue(session).push(entry);
  return entry;
}

function removePromptById(session, queuedPromptId) {
  const queue = ensurePromptQueue(session);
  const index = queue.findIndex((entry) => entry.id === queuedPromptId);
  if (index === -1) {
    return null;
  }
  return queue.splice(index, 1)[0] || null;
}

function shiftPrompt(session) {
  return ensurePromptQueue(session).shift() || null;
}

function createDraftFromQueuedPrompt(entry, currentDraft) {
  const text = String(entry?.text || "").trim();
  const draft = String(currentDraft || "");
  if (!text) {
    return draft;
  }
  return draft.trim()
    ? `${text}\n\n${draft}`
    : text;
}

function createPromptQueueEntry(text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    return null;
  }
  return {
    id: createPromptQueueId(),
    text: normalizedText,
    createdAt: Date.now()
  };
}

function createPromptQueueId() {
  return `queued-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

module.exports = {
  createDraftFromQueuedPrompt,
  enqueuePrompt,
  ensurePromptQueue,
  normalizePromptQueue,
  removePromptById,
  shiftPrompt
};
