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
    translate,
    addGlobalPointerListener,
    removeGlobalPointerListener
  } = options;

  containerEl.empty();
  const switcher = containerEl.createEl("details", { cls: "codex-dock__conversation-switcher" });
  const summary = switcher.createEl("summary", {
    cls: "codex-dock__conversation-summary",
    attr: {
      "aria-label": translate("session.switchConversation"),
      title: translate("session.switchConversation")
    }
  });
  const activeTitle = getSessionDisplayTitle(activeSession);
  if (activeTitle) {
    summary.createSpan({ cls: "codex-dock__conversation-title", text: activeTitle });
  }
  const chevron = summary.createSpan({ cls: "codex-dock__conversation-chevron", attr: { "aria-hidden": "true" } });
  setIcon(chevron, "chevron-down");

  const menu = switcher.createDiv({ cls: "codex-dock__conversation-menu" });
  menu.createDiv({ cls: "codex-dock__conversation-menu-title", text: translate("session.conversations") });
  const list = menu.createDiv({ cls: "codex-dock__conversation-list" });
  for (const session of sessions) {
    const title = getSessionDisplayTitle(session);
    const accessibleTitle = title || translate("session.untitledConversation");
    const unreadTurnStatus = getUnreadTurnStatus(session);
    const hasUnreadCompletion = Boolean(unreadTurnStatus) && session.id !== activeSessionId;
    const completedTitle = hasUnreadCompletion
      ? translate(getCompletedConversationTitleKey(unreadTurnStatus), { title: accessibleTitle })
      : accessibleTitle;
    const item = list.createDiv({
      cls: [
        "codex-dock__conversation-item",
        session.id === activeSessionId ? "is-active" : "",
        title ? "" : "is-untitled",
        hasUnreadCompletion ? "has-unread-completion" : "",
        hasUnreadCompletion ? `has-unread-completion--${unreadTurnStatus}` : ""
      ].filter(Boolean).join(" ")
    });
    const switchButton = item.createEl("button", {
      cls: "codex-dock__conversation-item-main",
      attr: {
        type: "button",
        title: completedTitle,
        "aria-label": completedTitle
      }
    });
    const check = switchButton.createSpan({ cls: "codex-dock__conversation-check", attr: { "aria-hidden": "true" } });
    if (session.id === activeSessionId) {
      setIcon(check, "check");
    }
    if (title) {
      switchButton.createSpan({ cls: "codex-dock__conversation-item-title", text: title });
    }
    if (hasUnreadCompletion) {
      switchButton.createSpan({
        cls: `codex-dock__conversation-complete-dot codex-dock__conversation-complete-dot--${unreadTurnStatus}`,
        attr: {
          "aria-hidden": "true",
          title: translate(getCompletedLabelKey(unreadTurnStatus))
        }
      });
    }
    switchButton.addEventListener("click", () => {
      onSwitchSession(session.id);
      switcher.removeAttribute("open");
    });

    const deleteButton = item.createEl("button", {
      cls: "codex-dock__conversation-delete",
      attr: {
        type: "button",
        "aria-label": translate("session.deleteNamedConversation", { title: accessibleTitle }),
        title: translate("session.deleteConversation")
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
      "aria-label": translate("session.newConversation"),
      title: translate("session.newConversation")
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

function getSessionDisplayTitle(session) {
  if (!session) {
    return "";
  }
  return String(session.title || "").trim();
}

function getUnreadTurnStatus(session) {
  const status = String(session?.unreadTurnStatus || "");
  if (status === "success" || status === "failed" || status === "stopped") {
    return status;
  }
  return session?.hasUnreadCompletion === true ? "success" : "";
}

function getCompletedLabelKey(status) {
  if (status === "failed") {
    return "session.failed";
  }
  if (status === "stopped") {
    return "session.stopped";
  }
  return "session.completed";
}

function getCompletedConversationTitleKey(status) {
  if (status === "failed") {
    return "session.failedConversationTitle";
  }
  if (status === "stopped") {
    return "session.stoppedConversationTitle";
  }
  return "session.completedConversationTitle";
}

module.exports = {
  renderSessionSwitcher
};
