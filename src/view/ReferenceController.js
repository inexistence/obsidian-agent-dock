const { setIcon } = require("obsidian");

const {
  extractMentionReferences,
  formatMentionToken,
  getMentionMatch,
  getParentPath,
  replaceObsidianOpenLinks
} = require("./mention");

const MAX_PARTIAL_MENTION_SUGGESTIONS = 7;

class ReferenceController {
  constructor(options) {
    this.app = options.app;
    this.plugin = options.plugin;
    this.translate = options.translate;
    this.getActiveSession = options.getActiveSession;
    this.persistSessionChange = options.persistSessionChange;
    this.updateContextStatus = options.updateContextStatus;
    this.resetMentionState();
  }

  setElements(elements) {
    this.inputEl = elements.inputEl;
    this.mentionChipsEl = elements.mentionChipsEl;
    this.mentionMenuEl = elements.mentionMenuEl;
    this.resetMentionState();
    this.updateMentionChips();
  }

  handleMentionKeydown(event) {
    if (!this.mentionState?.active) {
      return false;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.mentionState.selectedIndex = Math.min(
        this.mentionState.selectedIndex + 1,
        this.mentionState.suggestions.length - 1
      );
      this.updateMentionSelection({ scrollIntoView: true });
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.mentionState.selectedIndex = Math.max(this.mentionState.selectedIndex - 1, 0);
      this.updateMentionSelection({ scrollIntoView: true });
      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      this.selectMentionSuggestion(this.mentionState.selectedIndex);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.hideMentionSuggestions();
      return true;
    }

    return false;
  }

  updateMentionSuggestions() {
    const match = getMentionMatch(this.inputEl.value, this.inputEl.selectionStart);
    if (!match) {
      this.hideMentionSuggestions();
      return;
    }

    const suggestions = this.getVaultPathSuggestions(match.query);
    if (suggestions.length === 0) {
      this.hideMentionSuggestions();
      return;
    }

    this.mentionState = {
      active: true,
      start: match.start,
      end: match.end,
      selectedIndex: 0,
      suggestions
    };
    this.renderMentionSuggestions();
  }

  getVaultPathSuggestions(query) {
    const normalizedQuery = query.toLowerCase();
    const suggestions = this.app.vault.getAllLoadedFiles()
      .map((entry) => this.getMentionSuggestionForEntry(entry))
      .filter((entry) => entry.path)
      .filter((entry) => {
        if (!normalizedQuery) {
          return true;
        }
        return entry.path.toLowerCase().includes(normalizedQuery);
      })
      .map((suggestion) => ({
        ...suggestion,
        matchScore: getMentionSuggestionMatchScore(suggestion, normalizedQuery)
      }))
      .sort((left, right) => compareMentionSuggestions(left, right, normalizedQuery));
    const exactNameMatches = normalizedQuery
      ? suggestions.filter((suggestion) => suggestion.matchScore === 0)
      : [];
    const partialMatches = normalizedQuery
      ? suggestions.filter((suggestion) => suggestion.matchScore !== 0)
      : suggestions;

    return [
      ...exactNameMatches,
      ...partialMatches.slice(0, MAX_PARTIAL_MENTION_SUGGESTIONS)
    ];
  }

  getMentionSuggestionForEntry(entry) {
    const name = entry.name || entry.path;
    return {
      path: entry.path,
      name,
      basename: getMarkdownBasename(name),
      folder: getParentPath(entry.path),
      kind: entry.children ? "folder" : "file"
    };
  }

  showDroppedReferenceChoices(suggestions) {
    if (!this.inputEl || !Array.isArray(suggestions) || suggestions.length === 0) {
      return false;
    }

    const value = this.inputEl.value;
    const start = this.inputEl.selectionStart ?? value.length;
    const end = this.inputEl.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    this.mentionState = {
      active: true,
      start,
      end,
      selectedIndex: 0,
      suggestions,
      insertionPrefix: before && !/\s$/.test(before) ? " " : "",
      insertionSuffix: after && !/^\s/.test(after) ? " " : " "
    };
    this.renderMentionSuggestions();
    this.inputEl.focus();
    return true;
  }

  renderMentionSuggestions() {
    if (!this.mentionMenuEl || !this.mentionState.active) {
      return;
    }

    this.mentionMenuEl.empty();
    this.mentionMenuEl.addClass("is-open");
    const list = this.mentionMenuEl.createDiv({ cls: "codex-dock__mention-list" });
    for (let index = 0; index < this.mentionState.suggestions.length; index += 1) {
      const suggestion = this.mentionState.suggestions[index];
      const option = list.createEl("button", {
        cls: `codex-dock__mention-option${index === this.mentionState.selectedIndex ? " is-selected" : ""}`,
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
        this.selectMentionSuggestion(index);
      });
      option.addEventListener("mouseenter", () => {
        if (this.mentionState.selectedIndex === index) {
          return;
        }
        this.mentionState.selectedIndex = index;
        this.updateMentionSelection();
      });
    }

    this.renderMentionPreview();
  }

  updateMentionSelection(options = {}) {
    if (!this.mentionMenuEl || !this.mentionState.active) {
      return;
    }

    const optionEls = this.mentionMenuEl.querySelectorAll(".codex-dock__mention-option");
    for (let index = 0; index < optionEls.length; index += 1) {
      const isSelected = index === this.mentionState.selectedIndex;
      optionEls[index].classList.toggle("is-selected", isSelected);
      if (isSelected && options.scrollIntoView) {
        optionEls[index].scrollIntoView({ block: "nearest" });
      }
    }
    this.renderMentionPreview();
  }

  renderMentionPreview() {
    if (!this.mentionMenuEl || !this.mentionState.active) {
      return;
    }

    this.mentionMenuEl.querySelector(".codex-dock__mention-preview")?.remove();
    const selected = this.mentionState.suggestions[this.mentionState.selectedIndex];
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

  selectMentionSuggestion(index) {
    const suggestion = this.mentionState?.suggestions[index];
    if (!suggestion) {
      return;
    }

    const value = this.inputEl.value;
    const mention = formatMentionToken(suggestion.path);
    const prefix = this.mentionState.insertionPrefix || "";
    const suffix = this.mentionState.insertionSuffix ?? " ";
    const nextValue = `${value.slice(0, this.mentionState.start)}${prefix}${mention}${suffix}${value.slice(this.mentionState.end)}`;
    const nextCursor = this.mentionState.start + prefix.length + mention.length + suffix.length;
    this.inputEl.value = nextValue;
    this.inputEl.selectionStart = nextCursor;
    this.inputEl.selectionEnd = nextCursor;
    const session = this.getActiveSession();
    if (session) {
      session.draft = nextValue;
      this.persistSessionChange(session);
    }
    this.hideMentionSuggestions();
    this.updateMentionChips();
    this.updateContextStatus();
    this.inputEl.focus();
  }

  hideMentionSuggestions() {
    if (!this.mentionMenuEl) {
      return;
    }

    this.resetMentionState();
    this.mentionMenuEl.empty();
    this.mentionMenuEl.removeClass("is-open");
  }

  replaceObsidianLinksInInput() {
    const value = this.inputEl.value;
    const nextValue = replaceObsidianOpenLinks(value, (path) => this.normalizeReferencedPath(path));
    if (nextValue === value) {
      return false;
    }

    const cursor = this.inputEl.selectionStart;
    const delta = nextValue.length - value.length;
    this.inputEl.value = nextValue;
    this.inputEl.selectionStart = Math.max(0, cursor + delta);
    this.inputEl.selectionEnd = this.inputEl.selectionStart;
    const session = this.getActiveSession();
    if (session) {
      session.draft = nextValue;
      this.persistSessionChange(session);
    }
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
      if (ambiguousReference && this.showDroppedReferenceChoices(ambiguousReference.suggestions)) {
        logReferenceDropDebug(debugInfo, paths, debugEnabled, { status: "chooser" });
        return true;
      }
      logReferenceDropDebug(debugInfo, paths, debugEnabled, { status: "ignored" });
      return false;
    }

    logReferenceDropDebug(debugInfo, paths, debugEnabled, { status: "accepted" });

    const tokens = paths.map((path) => formatMentionToken(path));
    const value = this.inputEl.value;
    const start = this.inputEl.selectionStart ?? value.length;
    const end = this.inputEl.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    const suffix = after && !/^\s/.test(after) ? " " : "";
    const insertion = `${prefix}${tokens.join(" ")}${suffix || " "}`;
    const nextValue = `${before}${insertion}${after}`;
    const nextCursor = before.length + insertion.length;

    this.inputEl.value = nextValue;
    this.inputEl.selectionStart = nextCursor;
    this.inputEl.selectionEnd = nextCursor;
    const session = this.getActiveSession();
    if (session) {
      session.draft = nextValue;
      this.persistSessionChange(session);
    }
    this.updateMentionChips();
    this.updateContextStatus();
    this.hideMentionSuggestions();
    this.inputEl.focus();
    return true;
  }

  extractDroppedReferencePaths(dataTransfer, debugInfo, debugEnabled = false) {
    debugInfo.debugEnabled = debugEnabled;
    const paths = [];
    const seen = new Set();
    const attemptedInputs = new Set();
    const addPath = (path, source = "unknown") => {
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
      const normalizedPath = this.normalizeReferencedPath(path);
      const entry = normalizedPath ? this.resolveReferencedEntry(normalizedPath) : null;
      if (debugEnabled || !entry) {
        debugInfo.resolutions.push(this.getReferenceResolutionDebug(path, normalizedPath, entry));
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
        const ambiguousSuggestions = this.getAmbiguousReferenceSuggestions(path);
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
    };
    const addText = (text, source) => {
      if (text) {
        const fullText = String(text || "");
        debugInfo.payloads.push({
          source,
          text: truncateDebugText(fullText, 600),
          ...(debugEnabled && containsObsidianOpenUrl(fullText) ? { textFull: fullText } : {})
        });
      }
      for (const candidate of extractReferenceCandidatesFromText(text, debugInfo, source)) {
        addPath(candidate, source);
      }
    };

    Array.from(dataTransfer.items || []).forEach((item, index) => {
      const source = `dataTransfer.items[${index}]`;
      const itemFile = getDataTransferItemFile(item);
      if (itemFile) {
        addPath(itemFile.path || itemFile.name || "", `${source}.getAsFile`);
      }

      const itemEntry = getDataTransferItemEntry(item);
      if (itemEntry) {
        addPath(itemEntry.fullPath || itemEntry.name || "", `${source}.webkitGetAsEntry`);
      }
    });

    for (const file of Array.from(dataTransfer.files || [])) {
      addPath(file.path || file.name || "", "dataTransfer.files");
    }

    for (const type of Array.from(dataTransfer.types || [])) {
      try {
        addText(dataTransfer.getData(type), type);
      } catch {
        // Some drag payload types are read-protected by the host.
        debugInfo.payloads.push({
          source: type,
          text: "[read-protected]"
        });
      }
    }

    return paths;
  }

  updateMentionChips() {
    if (!this.mentionChipsEl) {
      return;
    }

    const references = extractMentionReferences(this.inputEl?.value || "")
      .map((reference) => ({
        path: this.normalizeReferencedPath(reference.path),
        name: reference.name
      }))
      .filter((reference) => reference.path);
    this.mentionChipsEl.empty();
    this.mentionChipsEl.toggleClass("is-empty", references.length === 0);
    this.mentionChipsEl.setAttr("aria-hidden", references.length === 0 ? "true" : "false");

    for (const reference of references) {
      const entry = this.resolveReferencedEntry(reference.path);
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

  normalizeReferencedPath(path) {
    const normalizedPath = normalizeReferenceInput(path);
    if (!normalizedPath) {
      return "";
    }

    const vaultBasePath = String(this.app.vault.adapter.basePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (vaultBasePath && normalizedPath === vaultBasePath) {
      return "";
    }
    if (vaultBasePath && normalizedPath.startsWith(`${vaultBasePath}/`)) {
      return this.resolveReferencedPath(normalizedPath.slice(vaultBasePath.length + 1));
    }

    return this.resolveReferencedPath(normalizedPath.replace(/^\/+/, ""));
  }

  resolveReferencedPath(path) {
    const normalizedPath = String(path || "").trim();
    if (!normalizedPath) {
      return "";
    }

    const entry = this.resolveReferencedEntry(normalizedPath);
    return entry?.path || normalizedPath;
  }

  resolveReferencedEntry(path) {
    const normalizedPath = String(path || "").trim();
    if (!normalizedPath) {
      return null;
    }

    return this.app.vault.getAbstractFileByPath(normalizedPath)
      || (!/\.[^/]+$/.test(normalizedPath) ? this.app.vault.getAbstractFileByPath(`${normalizedPath}.md`) : null)
      || this.findUniqueVaultEntryByName(normalizedPath);
  }

  getReferenceResolutionDebug(rawPath, normalizedPath, entry) {
    const normalizedInput = normalizeReferenceInput(rawPath);
    const vaultBasePath = String(this.app.vault.adapter.basePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
    const lookupPath = vaultBasePath && normalizedInput.startsWith(`${vaultBasePath}/`)
      ? normalizedInput.slice(vaultBasePath.length + 1)
      : normalizedInput.replace(/^\/+/, "");
    const mdPath = !/\.[^/]+$/.test(lookupPath) ? `${lookupPath}.md` : "";
    const exactEntry = lookupPath ? this.app.vault.getAbstractFileByPath(lookupPath) : null;
    const mdEntry = mdPath ? this.app.vault.getAbstractFileByPath(mdPath) : null;
    const nameMatches = this.findVaultEntryNameMatches(lookupPath).map((match) => match.path).slice(0, 10);

    return {
      raw: truncateDebugText(rawPath),
      normalizedInput,
      lookupPath,
      normalizedPath,
      exact: exactEntry?.path || "",
      mdFallback: mdEntry?.path || "",
      nameMatches,
      accepted: entry?.path || ""
    };
  }

  getAmbiguousReferenceSuggestions(rawPath) {
    const lookupPath = this.getReferenceLookupPath(rawPath);
    return this.findVaultEntryNameMatches(lookupPath)
      .map((entry) => this.getMentionSuggestionForEntry(entry))
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "file" ? -1 : 1;
        }
        return left.path.localeCompare(right.path);
      });
  }

  getReferenceLookupPath(rawPath) {
    const normalizedInput = normalizeReferenceInput(rawPath);
    const vaultBasePath = String(this.app.vault.adapter.basePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
    return vaultBasePath && normalizedInput.startsWith(`${vaultBasePath}/`)
      ? normalizedInput.slice(vaultBasePath.length + 1)
      : normalizedInput.replace(/^\/+/, "");
  }

  findUniqueVaultEntryByName(path) {
    const candidates = this.findVaultEntryNameMatches(path);

    return candidates.length === 1 ? candidates[0] : null;
  }

  findVaultEntryNameMatches(path) {
    const normalizedPath = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!normalizedPath) {
      return [];
    }

    const name = normalizedPath.split("/").pop() || normalizedPath;
    const nameWithMd = /\.[^/]+$/.test(name) ? name : `${name}.md`;
    return this.app.vault.getAllLoadedFiles()
      .filter((entry) => entry.path)
      .filter((entry) => (
        entry.path === normalizedPath
        || entry.name === name
        || entry.name === nameWithMd
        || entry.path.endsWith(`/${normalizedPath}`)
        || entry.path.endsWith(`/${normalizedPath}.md`)
      ));
  }

  resetMentionState() {
    this.mentionState = {
      active: false,
      start: -1,
      end: -1,
      selectedIndex: 0,
      suggestions: []
    };
  }
}

function getMentionFileType(name) {
  const extension = String(name || "").split(".").pop();
  if (!extension || extension === name || extension.length > 4) {
    return "FILE";
  }
  return extension.toUpperCase();
}

function compareMentionSuggestions(left, right, normalizedQuery) {
  const leftScore = typeof left.matchScore === "number"
    ? left.matchScore
    : getMentionSuggestionMatchScore(left, normalizedQuery);
  const rightScore = typeof right.matchScore === "number"
    ? right.matchScore
    : getMentionSuggestionMatchScore(right, normalizedQuery);

  if (leftScore !== rightScore) {
    return leftScore - rightScore;
  }
  if (left.kind !== right.kind) {
    return left.kind === "file" ? -1 : 1;
  }
  return left.path.localeCompare(right.path);
}

function getMentionSuggestionMatchScore(suggestion, normalizedQuery) {
  if (!normalizedQuery) {
    return 0;
  }

  const name = String(suggestion.name || "").toLowerCase();
  const basename = String(suggestion.basename || "").toLowerCase();
  if (name === normalizedQuery || basename === normalizedQuery) {
    return 0;
  }
  if (name.startsWith(normalizedQuery) || basename.startsWith(normalizedQuery)) {
    return 1;
  }
  if (name.includes(normalizedQuery) || basename.includes(normalizedQuery)) {
    return 2;
  }
  return 3;
}

function getMarkdownBasename(name) {
  return String(name || "").replace(/\.md$/i, "");
}

function normalizeReferenceInput(path) {
  const value = String(path || "").replace(/\\"/g, "\"").trim();
  const obsidianPath = extractObsidianOpenPathFromValue(value);
  return String(obsidianPath || value).replace(/\\/g, "/").trim();
}

function extractObsidianOpenPathFromValue(value) {
  const match = String(value || "").match(/^obsidian:\/\/open\?([^#\s<>"']+)/i);
  if (!match) {
    return "";
  }
  return getObsidianOpenQueryPath(match[1]);
}

function getObsidianOpenQueryPath(query) {
  try {
    const params = new URLSearchParams(query);
    return decodeUriPath(params.get("file") || params.get("path") || "");
  } catch {
    return "";
  }
}

function createReferenceDropDebugInfo(dataTransfer) {
  return {
    dropEffect: dataTransfer?.dropEffect || "",
    effectAllowed: dataTransfer?.effectAllowed || "",
    types: Array.from(dataTransfer?.types || []),
    items: Array.from(dataTransfer?.items || []).map((item, index) => describeDataTransferItem(item, index)),
    files: Array.from(dataTransfer?.files || []).map((file, index) => describeDataTransferFile(file, index)),
    payloads: [],
    extractions: [],
    resolutions: [],
    candidates: [],
    ambiguousReferences: []
  };
}

function logReferenceDropDebug(debugInfo, paths, debugEnabled = false, options = {}) {
  const status = options.status || (paths.length > 0 ? "accepted" : "ignored");
  const payload = {
    stamp: "drop-ob-open-v8",
    status,
    dropEffect: debugInfo.dropEffect,
    effectAllowed: debugInfo.effectAllowed,
    types: debugInfo.types,
    items: debugEnabled ? debugInfo.items : debugInfo.items.map(stripDataTransferItemDebug),
    files: debugEnabled ? debugInfo.files : debugInfo.files.map(stripDataTransferFileDebug),
    payloads: debugInfo.payloads,
    extractions: debugInfo.extractions,
    resolutions: debugInfo.resolutions,
    candidates: debugInfo.candidates,
    ambiguousReferences: debugInfo.ambiguousReferences,
    acceptedPaths: paths
  };

  if (status === "accepted" && debugEnabled) {
    console.info("[Agent Dock] Reference drop accepted", payload);
  } else if (status === "chooser" && debugEnabled) {
    console.info("[Agent Dock] Reference drop needs selection", payload);
  } else if (status === "ignored") {
    console.warn("[Agent Dock] Reference drop ignored", payload);
  }
}

function stripDataTransferItemDebug(item) {
  return {
    index: item.index,
    kind: item.kind,
    type: item.type,
    file: item.file ? stripDataTransferFileDebug(item.file) : null,
    entry: item.entry ? stripDataTransferEntryDebug(item.entry) : null
  };
}

function stripDataTransferFileDebug(file) {
  return {
    index: file.index,
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified
  };
}

function stripDataTransferEntryDebug(entry) {
  return {
    name: entry.name,
    filesystemName: entry.filesystemName,
    isFile: entry.isFile,
    isDirectory: entry.isDirectory
  };
}

function describeDataTransferItem(item, index) {
  const file = getDataTransferItemFile(item);
  const entry = getDataTransferItemEntry(item);
  return {
    index,
    kind: item?.kind || "",
    type: item?.type || "",
    file: file ? describeDataTransferFile(file) : null,
    entry: entry ? describeDataTransferEntry(entry) : null
  };
}

function describeDataTransferFile(file, index = undefined) {
  return {
    ...(index === undefined ? {} : { index }),
    name: file?.name || "",
    path: file?.path || "",
    type: file?.type || "",
    size: Number.isFinite(file?.size) ? file.size : null,
    lastModified: Number.isFinite(file?.lastModified) ? file.lastModified : null
  };
}

function describeDataTransferEntry(entry) {
  return {
    name: entry?.name || "",
    fullPath: entry?.fullPath || "",
    filesystemName: entry?.filesystem?.name || "",
    isFile: Boolean(entry?.isFile),
    isDirectory: Boolean(entry?.isDirectory)
  };
}

function getDataTransferItemFile(item) {
  try {
    return typeof item?.getAsFile === "function" ? item.getAsFile() : null;
  } catch {
    return null;
  }
}

function getDataTransferItemEntry(item) {
  try {
    return typeof item?.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
  } catch {
    return null;
  }
}

function truncateDebugText(value, maxChars = 180) {
  const text = String(value || "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function containsObsidianOpenUrl(value) {
  return /obsidian:\/\/open\?/i.test(String(value || ""));
}

function extractReferenceCandidatesFromText(text, debugInfo = null, sourceLabel = "") {
  const source = String(text || "").trim();
  if (!source) {
    return [];
  }

  const candidates = [];
  const addCandidate = (path, stage) => {
    const obsidianPath = extractObsidianOpenPathFromValue(path);
    const cleanPath = String(obsidianPath || path || "").replace(/^file:\/\//, "").trim();
    if (debugInfo) {
      const rawText = String(path || "");
      debugInfo.extractions.push({
        source: sourceLabel,
        stage,
        raw: truncateDebugText(rawText),
        ...(debugInfo.debugEnabled && containsObsidianOpenUrl(rawText) ? { rawFull: rawText } : {}),
        obsidianPath,
        candidate: cleanPath
      });
    }
    if (cleanPath) {
      candidates.push(cleanPath);
    }
  };

  for (const candidate of extractJsonReferenceCandidates(source)) {
    addCandidate(candidate, "json");
  }

  for (const candidate of extractObsidianOpenPathCandidates(source)) {
    addCandidate(candidate, "obsidian-url");
  }

  for (const reference of extractMentionReferences(replaceObsidianOpenLinks(source))) {
    addCandidate(reference.path, "mention");
  }

  let match;
  const wikiPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  while ((match = wikiPattern.exec(source)) !== null) {
    addCandidate(match[1], "wikilink");
  }

  const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  while ((match = markdownLinkPattern.exec(source)) !== null) {
    addCandidate(decodeUriPath(match[1]), "markdown-link");
  }

  const hrefPattern = /\b(?:href|src)=["']([^"']+)["']/gi;
  while ((match = hrefPattern.exec(source)) !== null) {
    addCandidate(decodeUriPath(match[1]), "href");
  }

  const dataAttributePattern = /\bdata-(?:path|href|file)=["']([^"']+)["']/gi;
  while ((match = dataAttributePattern.exec(source)) !== null) {
    addCandidate(decodeUriPath(match[1]), "data-attribute");
  }

  const objectPathPattern = /["'](?:path|file|sourcePath|source-path|data-path)["']\s*:\s*["']([^"']+)["']/gi;
  while ((match = objectPathPattern.exec(source)) !== null) {
    addCandidate(decodeUriPath(match[1]), "object-path");
  }

  for (const line of source.split(/\r?\n/)) {
    const compact = line.trim();
    if (/^[^\s<>"']+(?:\/[^\s<>"']+)*$/.test(compact) || /^file:\/\/[^\s<>"']+$/i.test(compact)) {
      addCandidate(decodeUriPath(compact), "line");
    }
  }

  return candidates;
}

function extractObsidianOpenPathCandidates(text) {
  const candidates = [];
  const pattern = /obsidian:\/\/open\?[^\s<>"']+/g;
  let match;

  while ((match = pattern.exec(String(text || ""))) !== null) {
    const path = extractObsidianOpenPathFromValue(match[0]);
    if (path) {
      candidates.push(path);
    }
  }

  return candidates;
}

function extractJsonReferenceCandidates(text) {
  try {
    return collectJsonReferenceCandidates(JSON.parse(text));
  } catch {
    return [];
  }
}

function collectJsonReferenceCandidates(value) {
  const candidates = [];
  const visit = (item) => {
    if (!item) {
      return;
    }
    if (typeof item === "string") {
      candidates.push(item);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child);
      }
      return;
    }
    if (typeof item !== "object") {
      return;
    }
    for (const key of ["path", "file", "sourcePath", "source-path", "data-path", "href"]) {
      if (typeof item[key] === "string") {
        candidates.push(item[key]);
      }
    }
    for (const child of Object.values(item)) {
      if (child && typeof child === "object") {
        visit(child);
      }
    }
  };

  visit(value);
  return candidates;
}

function decodeUriPath(path) {
  try {
    return decodeURIComponent(String(path || ""));
  } catch {
    return String(path || "");
  }
}

module.exports = {
  ReferenceController
};
