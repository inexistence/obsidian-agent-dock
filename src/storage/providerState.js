function serializeProviderState(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const providerState = {};
  if (value.cursor && typeof value.cursor === "object") {
    const acpSessionId = typeof value.cursor.acpSessionId === "string" ? value.cursor.acpSessionId : "";
    const model = normalizeModel(value.cursor.model);
    if (acpSessionId || model) {
      providerState.cursor = model ? { acpSessionId, model } : { acpSessionId };
    }
  }
  if (value.codex && typeof value.codex === "object") {
    const model = normalizeModel(value.codex.model);
    if (model) {
      providerState.codex = { model };
    }
  }
  return providerState;
}

function normalizeProviderState(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const providerState = {};
  if (value.cursor && typeof value.cursor === "object") {
    const acpSessionId = typeof value.cursor.acpSessionId === "string" ? value.cursor.acpSessionId : "";
    const model = normalizeModel(value.cursor.model);
    providerState.cursor = model ? { acpSessionId, model } : { acpSessionId };
  }
  if (value.codex && typeof value.codex === "object") {
    providerState.codex = { model: normalizeModel(value.codex.model) };
  }
  return providerState;
}

function normalizeModel(value) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

module.exports = {
  normalizeProviderState,
  serializeProviderState
};
