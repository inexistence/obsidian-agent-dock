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
  isLocalFileReference,
  logReferenceDropDebug,
  normalizeReferenceInput,
  truncateDebugText
} = require("./ReferenceDropParser");
const { ReferenceResolver } = require("./ReferenceResolver");
const {
  cleanupExpiredPastedImages,
  extractClipboardImageFiles,
  saveClipboardImageFile
} = require("./ClipboardImageReference");

class ReferenceController {
  constructor(options) {
    this.plugin = options.plugin;
    this.getActiveSession = options.getActiveSession;
    this.persistSessionChange = options.persistSessionChange;
    this.updateContextStatus = options.updateContextStatus;
    this.onInputValueChanged = options.onInputValueChanged || (() => {});
    this.translate = options.translate || ((key) => key);
    this.resolver = new ReferenceResolver(options.app);
    this.dropParser = new ReferenceDropParser();
    this.mentionMenu = new MentionMenuController({
      getSuggestions: (query, menuOptions) => this.resolver.getVaultPathSuggestions(query, menuOptions),
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

  hasClipboardImagePaste(clipboardData) {
    return extractClipboardImageFiles(clipboardData).length > 0;
  }

  async handleClipboardImagePaste(clipboardData) {
    const files = extractClipboardImageFiles(clipboardData);
    if (files.length === 0) {
      return false;
    }

    const paths = [];
    await cleanupExpiredPastedImages(this.plugin.app);
    for (const file of files) {
      paths.push(await saveClipboardImageFile(this.plugin.app, file, { cleanup: false }));
    }
    this.recordPastedImagePaths(paths);
    this.insertReferenceTokens(paths);
    return true;
  }

  recordPastedImagePaths(paths) {
    const session = this.getActiveSession();
    if (!session || !Array.isArray(paths) || paths.length === 0) {
      return;
    }

    const existing = new Set(Array.isArray(session.pastedImagePaths) ? session.pastedImagePaths : []);
    session.pastedImagePaths = [...existing, ...paths.filter((path) => !existing.has(path))];
    this.persistSessionChange(session);
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
    const references = this.extractDroppedReferences(dataTransfer, debugInfo, debugEnabled);
    const paths = references.map((reference) => reference.path);
    if (references.length === 0) {
      const ambiguousReference = debugInfo.ambiguousReferences[0];
      if (ambiguousReference && this.mentionMenu.showChoices(ambiguousReference.suggestions)) {
        logReferenceDropDebug(debugInfo, paths, debugEnabled, { status: "chooser" });
        return true;
      }
      logReferenceDropDebug(debugInfo, paths, debugEnabled, { status: "ignored" });
      return false;
    }

    logReferenceDropDebug(debugInfo, paths, debugEnabled, { status: "accepted" });
    this.insertReferenceTokens(references);
    return true;
  }

  extractDroppedReferencePaths(dataTransfer, debugInfo, debugEnabled = false) {
    return this.extractDroppedReferences(dataTransfer, debugInfo, debugEnabled)
      .filter((reference) => reference.kind === "vault")
      .map((reference) => reference.path);
  }

  extractDroppedReferences(dataTransfer, debugInfo, debugEnabled = false) {
    const references = [];
    const seen = new Set();
    const attemptedInputs = new Set();
    const candidates = this.dropParser.extractCandidates(dataTransfer, debugInfo, debugEnabled);

    for (const candidate of candidates) {
      this.resolveDropCandidate(candidate, {
        attemptedInputs,
        debugEnabled,
        debugInfo,
        references,
        seen
      });
    }

    return references;
  }

  resolveDropCandidate(candidate, context) {
    const { attemptedInputs, debugEnabled, debugInfo, references, seen } = context;
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
      if (isLocalFileReference(path)) {
        seen.add(normalizedPath);
        references.push({ kind: "local", path: normalizedInput });
        result.accepted = true;
        result.reason = "local file outside vault";
        debugInfo.candidates.push(result);
        return;
      }
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
    references.push({ kind: "vault", path: normalizedPath });
    result.accepted = true;
    result.reason = `resolved to ${entry.path}`;
    debugInfo.candidates.push(result);
  }

  selectMentionSuggestion(suggestion, state) {
    const embed = state.trigger === "embed-wiki" ? true : undefined;
    this.replaceInputRange({
      start: state.start,
      end: state.end,
      insertion: formatMentionToken(suggestion.path, { embed }),
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
    const references = normalizeReferenceTokenInputs(paths);
    const tokens = references.map((reference) => (
      reference.kind === "local"
        ? formatLocalFileMarkdownReference(reference.path)
        : formatMentionToken(reference.path)
    ));
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

function normalizeReferenceTokenInputs(paths) {
  return Array.from(paths || [])
    .map((reference) => {
      if (typeof reference === "string") {
        return { kind: "vault", path: reference };
      }
      return {
        kind: reference?.kind === "local" ? "local" : "vault",
        path: String(reference?.path || "")
      };
    })
    .filter((reference) => reference.path);
}

function formatLocalFileMarkdownReference(path) {
  const cleanPath = normalizeReferenceInput(path);
  const name = cleanPath.split("/").filter(Boolean).pop() || cleanPath;
  return `[${escapeMarkdownLinkLabel(name)}](${encodeLocalPathForMarkdown(cleanPath)})`;
}

function escapeMarkdownLinkLabel(label) {
  return String(label || "").replace(/([\\\[\]])/g, "\\$1");
}

function encodeLocalPathForMarkdown(path) {
  const markdownTargetEscapes = {
    "(": "%28",
    ")": "%29",
    "#": "%23",
    "?": "%3F"
  };
  return encodeURI(path).replace(/[()#?]/g, (character) => markdownTargetEscapes[character]);
}

module.exports = {
  ReferenceController
};
