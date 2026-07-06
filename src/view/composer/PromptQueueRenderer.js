const { setIcon } = require("obsidian");

function renderQueuedPrompts(containerEl, queuedPrompts, options) {
  const queue = Array.isArray(queuedPrompts) ? queuedPrompts : [];
  if (queue.length === 0) {
    return;
  }

  const { onRemoveQueuedPrompt, onEditQueuedPrompt, translate } = options;
  const queueEl = containerEl.createDiv({ cls: "codex-dock__prompt-queue" });
  const header = queueEl.createDiv({ cls: "codex-dock__prompt-queue-header" });
  header.createSpan({ text: translate("composer.queueTitle", { count: queue.length }) });

  const list = queueEl.createDiv({ cls: "codex-dock__prompt-queue-list" });
  for (const entry of queue) {
    renderQueuedPromptItem(list, entry, {
      onRemoveQueuedPrompt,
      onEditQueuedPrompt,
      translate
    });
  }
}

function renderQueuedPromptItem(containerEl, entry, options) {
  const { onRemoveQueuedPrompt, onEditQueuedPrompt, translate } = options;
  const item = containerEl.createDiv({ cls: "codex-dock__prompt-queue-item" });
  item.createDiv({
    cls: "codex-dock__prompt-queue-text",
    text: entry.text || "",
    attr: {
      title: entry.text || ""
    }
  });

  const actions = item.createDiv({ cls: "codex-dock__prompt-queue-actions" });
  const editButton = actions.createEl("button", {
    cls: "codex-dock__prompt-queue-button",
    attr: {
      type: "button",
      "aria-label": translate("composer.editQueuedMessage"),
      title: translate("composer.editQueuedMessage")
    }
  });
  setIcon(editButton, "pencil");
  editButton.addEventListener("click", () => {
    onEditQueuedPrompt?.(entry.id);
  });

  const removeButton = actions.createEl("button", {
    cls: "codex-dock__prompt-queue-button",
    attr: {
      type: "button",
      "aria-label": translate("composer.removeQueuedMessage"),
      title: translate("composer.removeQueuedMessage")
    }
  });
  setIcon(removeButton, "x");
  removeButton.addEventListener("click", () => {
    onRemoveQueuedPrompt?.(entry.id);
  });
}

module.exports = {
  renderQueuedPrompts
};
