const { Modal } = require("obsidian");

class MemoryNoticeModal extends Modal {
  constructor(app, options) {
    super(app);
    this.entry = options.entry || {};
    this.translate = options.translate;
    this.renderMarkdownContent = options.renderMarkdownContent;
    this.debugActivity = options.debugActivity === true;
    this.selectedIndex = 0;
    this.itemButtons = [];
    this.itemTitles = [];
    this.listEl = null;
    this.detailEl = null;
  }

  onOpen() {
    this.render();
  }

  onClose() {
    this.itemButtons = [];
    this.itemTitles = [];
    this.listEl = null;
    this.detailEl = null;
    this.contentEl.empty();
  }

  render() {
    const items = getAuditItems(this.entry);
    this.selectedIndex = clampIndex(this.selectedIndex, items.length);
    this.itemButtons = [];
    this.itemTitles = [];
    this.listEl = null;
    this.detailEl = null;
    this.contentEl.empty();
    this.modalEl.addClass("codex-dock__memory-modal");

    const header = this.contentEl.createDiv({ cls: "codex-dock__memory-modal-header" });
    header.createEl("h2", {
      cls: "codex-dock__memory-modal-title",
      text: this.entry.title || this.translate("memoryNotice.title")
    });
    header.createDiv({
      cls: "codex-dock__memory-modal-summary",
      text: this.entry.summary || this.translate("memoryNotice.empty")
    });

    if (items.length === 0) {
      this.contentEl.createDiv({
        cls: "codex-dock__memory-modal-empty",
        text: this.entry.detail || this.translate("memoryNotice.empty")
      });
      return;
    }

    const layout = this.contentEl.createDiv({ cls: "codex-dock__memory-modal-layout" });
    const list = layout.createDiv({
      cls: "codex-dock__memory-modal-list",
      attr: { role: "listbox" }
    });
    this.listEl = list;
    this.detailEl = layout.createDiv({ cls: "codex-dock__memory-modal-detail" });

    items.forEach((item, index) => {
      const displayTitle = this.getAuditItemDisplayTitle(item, index);
      this.itemTitles[index] = displayTitle;
      const button = list.createDiv({
        cls: [
          "codex-dock__memory-modal-list-item",
          index === this.selectedIndex ? "is-selected" : ""
        ].filter(Boolean).join(" "),
        attr: {
          role: "option",
          tabindex: "0",
          "aria-selected": index === this.selectedIndex ? "true" : "false"
        }
      });
      button.addEventListener("click", () => {
        this.selectItem(index);
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        this.selectItem(index);
      });
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      this.itemButtons.push(button);
      button.createDiv({
        cls: "codex-dock__memory-modal-list-title",
        text: displayTitle
      });
      const meta = [item.type, item.source].filter(Boolean).join(" · ");
      if (meta) {
        button.createDiv({ cls: "codex-dock__memory-modal-list-meta", text: meta });
      }
    });

    this.renderSelectedItemDetail(items);
  }

  selectItem(index) {
    const items = getAuditItems(this.entry);
    const nextIndex = clampIndex(index, items.length);
    if (nextIndex === this.selectedIndex && this.detailEl) {
      return;
    }
    const listScrollTop = this.listEl ? this.listEl.scrollTop : 0;
    this.selectedIndex = nextIndex;
    this.itemButtons.forEach((button, itemIndex) => {
      const isSelected = itemIndex === this.selectedIndex;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-selected", isSelected ? "true" : "false");
    });
    this.renderSelectedItemDetail(items);
    this.restoreListScroll(listScrollTop);
  }

  renderSelectedItemDetail(items = getAuditItems(this.entry)) {
    if (!this.detailEl) {
      return;
    }
    this.detailEl.empty();
    this.renderItemDetail(this.detailEl, items[this.selectedIndex] || items[0], this.selectedIndex);
    this.detailEl.scrollTop = 0;
  }

  restoreListScroll(scrollTop) {
    if (!this.listEl) {
      return;
    }
    this.listEl.scrollTop = scrollTop;
    window.requestAnimationFrame(() => {
      if (this.listEl) {
        this.listEl.scrollTop = scrollTop;
      }
    });
  }

  renderItemDetail(containerEl, item, index = 0) {
    if (!item) {
      containerEl.createDiv({
        cls: "codex-dock__memory-modal-empty",
        text: this.translate("memoryNotice.empty")
      });
      return;
    }
    const top = containerEl.createDiv({ cls: "codex-dock__memory-modal-detail-top" });
    top.createEl("h3", {
      cls: "codex-dock__memory-modal-detail-title",
      text: this.getItemTitle(index, item)
    });

    const badges = Array.isArray(item.badges) ? item.badges.filter(Boolean) : [];
    if (badges.length > 0) {
      const badgeRow = containerEl.createDiv({ cls: "codex-dock__memory-modal-badges" });
      for (const badge of badges) {
        badgeRow.createSpan({ cls: "codex-dock__memory-modal-badge", text: badge });
      }
    }

    const fields = getVisibleAuditFields(item.fields, this.debugActivity);
    if (fields.length === 0 && item.summary) {
      this.renderFieldValue(containerEl, item.summary);
      return;
    }

    for (const field of fields) {
      const row = containerEl.createDiv({ cls: "codex-dock__memory-modal-field" });
      row.createDiv({ cls: "codex-dock__memory-modal-field-label", text: field.label });
      this.renderFieldValue(row, field.value, { preformatted: field.preformatted === true });
    }
  }

  getItemTitle(index, item) {
    return this.itemTitles[index] || this.getAuditItemDisplayTitle(item, index);
  }

  getAuditItemDisplayTitle(item, index) {
    const title = String(item?.title || "").replace(/\s+/g, " ").trim();
    if (title && title.length <= 64) {
      return title;
    }
    const type = String(item?.type || this.translate("memoryNotice.item")).trim();
    return `${type} ${index + 1}`;
  }

  renderFieldValue(containerEl, value, options = {}) {
    const valueEl = containerEl.createDiv({ cls: "codex-dock__memory-modal-field-value" });
    if (options.preformatted) {
      valueEl.createEl("pre", {
        cls: "codex-dock__memory-modal-field-pre",
        text: value || ""
      });
      return valueEl;
    }
    if (typeof this.renderMarkdownContent === "function") {
      this.renderMarkdownContent(valueEl, value || "", { restricted: true });
      return valueEl;
    }
    valueEl.setText(value || "");
    return valueEl;
  }

}

function getAuditItems(entry) {
  return Array.isArray(entry?.auditItems) ? entry.auditItems : [];
}

function getVisibleAuditFields(fields, debugActivity) {
  return (Array.isArray(fields) ? fields : [])
    .filter((field) => !field?.debugOnly || debugActivity === true);
}

function clampIndex(index, length) {
  const count = Number(length);
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  const value = Number(index);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(Math.floor(value), count - 1);
}

module.exports = {
  MemoryNoticeModal,
  _test: {
    getVisibleAuditFields
  }
};
