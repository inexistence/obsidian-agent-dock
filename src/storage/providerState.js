function serializeProviderState(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const providerState = {};
  if (value.cursor && typeof value.cursor === "object") {
    const acpSessionId = typeof value.cursor.acpSessionId === "string" ? value.cursor.acpSessionId : "";
    if (acpSessionId) {
      providerState.cursor = { acpSessionId };
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
    providerState.cursor = {
      acpSessionId: typeof value.cursor.acpSessionId === "string" ? value.cursor.acpSessionId : ""
    };
  }
  return providerState;
}

module.exports = {
  normalizeProviderState,
  serializeProviderState
};
