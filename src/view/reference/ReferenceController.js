const { setIcon } = require("obsidian");

const {
  extractMentionReferences,
  formatMentionToken,
  replaceObsidianOpenLinks
} = require("./mention");
const { MentionMenuController } = require("./MentionMenuController");
const {
  ReferenceDropParser,
  createReferenceDropDebugInfo,
  logReferenceDropDebug,
  normalizeReferenceInput,
  truncateDebugText
} = require("./ReferenceDropParser");
const { ReferenceResolver } = require("./ReferenceResolver");

class ReferenceController {
  constructor(options) {
    this.plugin = options.plugin;
    this.getActiveSession = options.getActiveSession;
    this.persistSessionChange = options.persistSessionChange;
    this.updateContextStatus = options.updateContextStatus;
    this.onInputValueChanged = options.onInputValueChanged || (() => {});
    this.resolver = new ReferenceResolver(options.app);
    this.dropParser = new ReferenceDropParser();
    this.mentionMenu = new MentionMenuController({
      getSuggestions: (query) => this.resolver.getVaultPathSuggestions(query),
      onSelect: (suggestion, state) => this.selectMentionSuggestion(suggestion, state),
      translate: options.translate
    });
  }

  setElements(elements) {
    this.inputEl = elements.inputEl;
    this.mentionChipsEl = elements.mentionChipsEl;
    this.mentionMenu.setElements({
      inputEl: elements.inputEl,
      mentionMenuEl: elements.mentionMenuEl
    });
    this.updateMentionChips();
  }

  handleMentionKeydown(event) {
    return this.mentionMenu.handleKeydown(event);
  }

  updateMentionSuggestions() {
    this.mentionMenu.updateSuggestions();
  }

  hideMentionSuggestions() {
    this.mentionMenu.hide();
  }

  replaceObsidianLinksInInput() {
    const value = this.inputEl.value;
    const nextValue = replaceObsidianOpenLinks(value, (path) => this.resolver.normalizeReferencedPath(path));
    if (nextValue === value) {
      return false;
    }

    const cursor = this.inputEl.selectionStart;
    const delta = nextValue.length - value.length;
    this.inputEl.value = nextValue;
    this.inputEl.selectionStart = Math.max(0, cursor + delta);
    this.inputEl.selectionEnd = this.inputEl.selectionStart;
    this.saveDraft(nextValue);
    this.updateMentionChips();
    this.updateContextStatus();
    this.updateMentionSuggestions();
    return true;
  }

  handleReferenceDrop(dataTransfer) {
    const debugInfo = createReferenceDropDebugInfo(dataTransfer);
    const debugEnabled = Boolean(this.plugin.settings.debugActivity);
    const paths = this.extractDroppedReferencePaths(dataTransfer, debugInfo, debugEnabled);
    if (paths.length === 0) {
      const ambiguousReference = debugInfo.ambiguousReferences[0];
      if (ambiguousReference && this.mentionMenu.showChoices(ambiguousReference.suggestions)) {
        logReferenceDropDebug(debugInfo, paths, debugEnabled, { status: "chooser" });
        return true;
      }
      logReferenceDropDebug(debugInfo, paths, debugEnabled, { status: "ignored" });
      return false;
    }

    logReferenceDropDebug(debugInfo, paths, debugEnabled, { status: "accepted" });
    this.insertReferenceTokens(paths);
    return true;
  }

  extractDroppedReferencePaths(dataTransfer, debugInfo, debugEnabled = false) {
    const paths = [];
    const seen = new Set();
    const attemptedInputs = new Set();
    const candidates = this.dropParser.extractCandidates(dataTransfer, debugInfo, debugEnabled);

    for (const candidate of candidates) {
      this.resolveDropCandidate(candidate, {
        attemptedInputs,
        debugEnabled,
        debugInfo,
        paths,
        seen
      });
    }

    return paths;
  }

  resolveDropCandidate(candidate, context) {
    const { attemptedInputs, debugEnabled, debugInfo, paths, seen } = context;
    const { path, source } = candidate;
    const normalizedInput = normalizeReferenceInput(path);
    if (normalizedInput && attemptedInputs.has(normalizedInput)) {
      debugInfo.candidates.push({
        source,
        raw: truncateDebugText(path),
        normalized: normalizedInput,
        accepted: false,
        reason: "duplicate input"
      });
      return;
    }
    if (normalizedInput) {
      attemptedInputs.add(normalizedInput);
    }

    const normalizedPath = this.resolver.normalizeReferencedPath(path);
    const entry = normalizedPath ? this.resolver.resolveReferencedEntry(normalizedPath) : null;
    if (debugEnabled || !entry) {
      debugInfo.resolutions.push(this.resolver.getReferenceResolutionDebug(path, normalizedPath, entry));
    }
    const result = {
      source,
      raw: truncateDebugText(path),
      normalized: normalizedPath,
      accepted: false,
      reason: ""
    };
    if (!normalizedPath) {
      result.reason = "empty";
      debugInfo.candidates.push(result);
      return;
    }
    if (seen.has(normalizedPath)) {
      result.reason = "duplicate";
      debugInfo.candidates.push(result);
      return;
    }
    if (!entry) {
      const ambiguousSuggestions = this.resolver.getAmbiguousReferenceSuggestions(path);
      if (ambiguousSuggestions.length > 1) {
        debugInfo.ambiguousReferences.push({
          source,
          raw: truncateDebugText(path),
          normalized: normalizedPath,
          suggestions: ambiguousSuggestions
        });
      }
      result.reason = "not found in vault";
      debugInfo.candidates.push(result);
      return;
    }
    seen.add(normalizedPath);
    paths.push(normalizedPath);
    result.accepted = true;
    result.reason = `resolved to ${entry.path}`;
    debugInfo.candidates.push(result);
  }

  selectMentionSuggestion(suggestion, state) {
    this.replaceInputRange({
      start: state.start,
      end: state.end,
      insertion: formatMentionToken(suggestion.path),
      prefix: state.insertionPrefix || "",
      suffix: state.insertionSuffix ?? " "
    });
    this.hideMentionSuggestions();
    this.updateMentionChips();
    this.updateContextStatus();
    this.inputEl.focus();
  }

  insertActiveFileReference() {
    const file = this.plugin.app.workspace.getActiveFile();
    const path = this.resolver.normalizeReferencedPath(file?.path || "");
    if (!path) {
      return false;
    }

    const existingPaths = new Set(
      extractMentionReferences(this.inputEl?.value || "")
        .map((reference) => this.resolver.normalizeReferencedPath(reference.path))
        .filter(Boolean)
    );
    if (!existingPaths.has(path)) {
      this.insertReferenceTokens([path]);
    } else {
      this.inputEl?.focus();
    }
    this.updateMentionChips();
    this.updateContextStatus();
    this.hideMentionSuggestions();
    return true;
  }

  insertReferenceTokens(paths) {
    const tokens = paths.map((path) => formatMentionToken(path));
    const value = this.inputEl.value;
    const start = this.inputEl.selectionStart ?? value.length;
    const end = this.inputEl.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    const suffix = after && !/^\s/.test(after) ? " " : "";
    this.replaceInputRange({
      start,
      end,
      insertion: tokens.join(" "),
      prefix,
      suffix: suffix || " "
    });
    this.updateMentionChips();
    this.updateContextStatus();
    this.hideMentionSuggestions();
    this.inputEl.focus();
  }

  replaceInputRange(options) {
    const value = this.inputEl.value;
    const nextValue = `${value.slice(0, options.start)}${options.prefix}${options.insertion}${options.suffix}${value.slice(options.end)}`;
    const nextCursor = options.start + options.prefix.length + options.insertion.length + options.suffix.length;
    this.inputEl.value = nextValue;
    this.inputEl.selectionStart = nextCursor;
    this.inputEl.selectionEnd = nextCursor;
    this.saveDraft(nextValue);
  }

  saveDraft(value) {
    const session = this.getActiveSession();
    if (session) {
      session.draft = value;
      this.persistSessionChange(session);
    }
    this.onInputValueChanged();
  }

  updateMentionChips() {
    if (!this.mentionChipsEl) {
      return;
    }

    const references = extractMentionReferences(this.inputEl?.value || "")
      .map((reference) => ({
        path: this.resolver.normalizeReferencedPath(reference.path),
        name: reference.name
      }))
      .filter((reference) => reference.path);
    this.mentionChipsEl.empty();
    this.mentionChipsEl.toggleClass("is-empty", references.length === 0);
    this.mentionChipsEl.setAttr("aria-hidden", references.length === 0 ? "true" : "false");

    for (const reference of references) {
      const entry = this.resolver.resolveReferencedEntry(reference.path);
      const isFolder = Boolean(entry?.children);
      const chip = this.mentionChipsEl.createSpan({
        cls: `codex-dock__mention-chip${isFolder ? " is-folder" : " is-file"}`,
        attr: {
          title: reference.path
        }
      });
      if (isFolder) {
        const icon = chip.createSpan({ cls: "codex-dock__mention-chip-icon", attr: { "aria-hidden": "true" } });
        setIcon(icon, "folder");
      } else {
        chip.createSpan({
          cls: "codex-dock__mention-chip-type",
          text: getMentionFileType(reference.name)
        });
      }
      chip.createSpan({ cls: "codex-dock__mention-chip-name", text: reference.name || reference.path });
    }
  }
}

function getMentionFileType(name) {
  const extension = String(name || "").split(".").pop();
  if (!extension || extension === name || extension.length > 4) {
    return "FILE";
  }
  return extension.toUpperCase();
}

module.exports = {
  ReferenceController
};
