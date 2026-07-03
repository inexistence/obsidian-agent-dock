const { setIcon } = require("obsidian");

const { getMentionMatch } = require("./mention");

class MentionMenuController {
  constructor(options) {
    this.getSuggestions = options.getSuggestions;
    this.onSelect = options.onSelect;
    this.translate = options.translate;
    this.resetState();
  }

  setElements(elements) {
    this.inputEl = elements.inputEl;
    this.mentionMenuEl = elements.mentionMenuEl;
    this.resetState();
  }

  handleKeydown(event) {
    if (!this.state?.active) {
      return false;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.state.selectedIndex = Math.min(
        this.state.selectedIndex + 1,
        this.state.suggestions.length - 1
      );
      this.updateSelection({ scrollIntoView: true });
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.state.selectedIndex = Math.max(this.state.selectedIndex - 1, 0);
      this.updateSelection({ scrollIntoView: true });
      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      this.select(this.state.selectedIndex);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.hide();
      return true;
    }

    return false;
  }

  updateSuggestions() {
    const match = getMentionMatch(this.inputEl.value, this.inputEl.selectionStart);
    if (!match) {
      this.hide();
      return;
    }

    const suggestions = this.getSuggestions(match.query);
    if (suggestions.length === 0) {
      this.hide();
      return;
    }

    this.state = {
      active: true,
      start: match.start,
      end: match.end,
      selectedIndex: 0,
      suggestions
    };
    this.render();
  }

  showChoices(suggestions, options = {}) {
    if (!this.inputEl || !Array.isArray(suggestions) || suggestions.length === 0) {
      return false;
    }

    const value = this.inputEl.value;
    const start = options.start ?? this.inputEl.selectionStart ?? value.length;
    const end = options.end ?? this.inputEl.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    this.state = {
      active: true,
      start,
      end,
      selectedIndex: 0,
      suggestions,
      insertionPrefix: before && !/\s$/.test(before) ? " " : "",
      insertionSuffix: after && !/^\s/.test(after) ? " " : " "
    };
    this.render();
    this.inputEl.focus();
    return true;
  }

  render() {
    if (!this.mentionMenuEl || !this.state.active) {
      return;
    }

    this.mentionMenuEl.empty();
    this.mentionMenuEl.addClass("is-open");
    const list = this.mentionMenuEl.createDiv({ cls: "codex-dock__mention-list" });
    for (let index = 0; index < this.state.suggestions.length; index += 1) {
      const suggestion = this.state.suggestions[index];
      const option = list.createEl("button", {
        cls: `codex-dock__mention-option${index === this.state.selectedIndex ? " is-selected" : ""}`,
        attr: {
          type: "button",
          title: suggestion.path
        }
      });
      const icon = option.createSpan({ cls: "codex-dock__mention-icon", attr: { "aria-hidden": "true" } });
      setIcon(icon, suggestion.kind === "folder" ? "folder" : "file-text");
      const text = option.createSpan({ cls: "codex-dock__mention-text" });
      text.createSpan({ cls: "codex-dock__mention-name", text: suggestion.name });
      text.createSpan({
        cls: "codex-dock__mention-path",
        text: suggestion.folder || this.translate("view.vaultRoot")
      });
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.select(index);
      });
      option.addEventListener("mouseenter", () => {
        if (this.state.selectedIndex === index) {
          return;
        }
        this.state.selectedIndex = index;
        this.updateSelection();
      });
    }

    this.renderPreview();
  }

  updateSelection(options = {}) {
    if (!this.mentionMenuEl || !this.state.active) {
      return;
    }

    const optionEls = this.mentionMenuEl.querySelectorAll(".codex-dock__mention-option");
    for (let index = 0; index < optionEls.length; index += 1) {
      const isSelected = index === this.state.selectedIndex;
      optionEls[index].classList.toggle("is-selected", isSelected);
      if (isSelected && options.scrollIntoView) {
        optionEls[index].scrollIntoView({ block: "nearest" });
      }
    }
    this.renderPreview();
  }

  renderPreview() {
    if (!this.mentionMenuEl || !this.state.active) {
      return;
    }

    this.mentionMenuEl.querySelector(".codex-dock__mention-preview")?.remove();
    const selected = this.state.suggestions[this.state.selectedIndex];
    if (selected) {
      const preview = this.mentionMenuEl.createDiv({ cls: "codex-dock__mention-preview" });
      const segments = selected.path.split("/");
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const row = preview.createDiv({
          cls: `codex-dock__mention-preview-row depth-${Math.min(index, 4)}`
        });
        const icon = row.createSpan({ cls: "codex-dock__mention-preview-icon", attr: { "aria-hidden": "true" } });
        setIcon(icon, index === segments.length - 1 && selected.kind === "file" ? "file-text" : "folder");
        row.createSpan({ cls: "codex-dock__mention-preview-name", text: segment });
      }
    }
  }

  select(index) {
    const suggestion = this.state?.suggestions[index];
    if (!suggestion) {
      return;
    }

    this.onSelect(suggestion, {
      start: this.state.start,
      end: this.state.end,
      insertionPrefix: this.state.insertionPrefix || "",
      insertionSuffix: this.state.insertionSuffix ?? " "
    });
  }

  hide() {
    if (!this.mentionMenuEl) {
      return;
    }

    this.resetState();
    this.mentionMenuEl.empty();
    this.mentionMenuEl.removeClass("is-open");
  }

  resetState() {
    this.state = {
      active: false,
      start: -1,
      end: -1,
      selectedIndex: 0,
      suggestions: []
    };
  }
}

module.exports = {
  MentionMenuController
};
