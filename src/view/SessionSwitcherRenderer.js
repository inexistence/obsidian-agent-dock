const { setIcon } = require("obsidian");

function renderSessionSwitcher(options) {
  const {
    containerEl,
    sessions,
    activeSessionId,
    activeSession,
    onSwitchSession,
    onDeleteSession,
    onNewSession,
    addGlobalPointerListener,
    removeGlobalPointerListener
  } = options;

  containerEl.empty();
  const switcher = containerEl.createEl("details", { cls: "codex-dock__conversation-switcher" });
  const summary = switcher.createEl("summary", {
    cls: "codex-dock__conversation-summary",
    attr: {
      "aria-label": "Switch conversation",
      title: "Switch conversation"
    }
  });
  summary.createSpan({ cls: "codex-dock__conversation-title", text: activeSession.title });
  const chevron = summary.createSpan({ cls: "codex-dock__conversation-chevron", attr: { "aria-hidden": "true" } });
  setIcon(chevron, "chevron-down");

  const menu = switcher.createDiv({ cls: "codex-dock__conversation-menu" });
  menu.createDiv({ cls: "codex-dock__conversation-menu-title", text: "Conversations" });
  const list = menu.createDiv({ cls: "codex-dock__conversation-list" });
  for (const session of sessions) {
    const item = list.createDiv({
      cls: `codex-dock__conversation-item${session.id === activeSessionId ? " is-active" : ""}`
    });
    const switchButton = item.createEl("button", {
      cls: "codex-dock__conversation-item-main",
      attr: {
        type: "button",
        title: session.title
      }
    });
    const check = switchButton.createSpan({ cls: "codex-dock__conversation-check", attr: { "aria-hidden": "true" } });
    if (session.id === activeSessionId) {
      setIcon(check, "check");
    }
    switchButton.createSpan({ cls: "codex-dock__conversation-item-title", text: session.title });
    switchButton.addEventListener("click", () => {
      onSwitchSession(session.id);
      switcher.removeAttribute("open");
    });

    const deleteButton = item.createEl("button", {
      cls: "codex-dock__conversation-delete",
      attr: {
        type: "button",
        "aria-label": `Delete ${session.title}`,
        title: "Delete conversation"
      }
    });
    setIcon(deleteButton, "trash-2");
    deleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onDeleteSession(session.id);
    });
  }

  const newSessionButton = containerEl.createEl("button", {
    cls: "codex-dock__conversation-new",
    attr: {
      type: "button",
      "aria-label": "New conversation",
      title: "New conversation"
    }
  });
  setIcon(newSessionButton, "plus");
  newSessionButton.addEventListener("click", onNewSession);

  const closeConversationMenu = (event) => {
    if (!switcher.contains(event.target)) {
      switcher.removeAttribute("open");
      removeGlobalPointerListener(closeConversationMenu);
    }
  };
  switcher.addEventListener("toggle", () => {
    if (switcher.open) {
      window.setTimeout(() => {
        if (switcher.isConnected && switcher.open) {
          addGlobalPointerListener(closeConversationMenu);
        }
      }, 0);
    } else {
      removeGlobalPointerListener(closeConversationMenu);
    }
  });
}

module.exports = {
  renderSessionSwitcher
};
