const {
  extractMentionReferences,
  replaceObsidianOpenLinks
} = require("./mention");

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

class ReferenceDropParser {
  extractCandidates(dataTransfer, debugInfo, debugEnabled = false) {
    debugInfo.debugEnabled = debugEnabled;
    const candidates = [];
    const addPath = (path, source = "unknown") => {
      candidates.push({ path, source });
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
        addPath(getDataTransferEntryPath(itemEntry), `${source}.webkitGetAsEntry`);
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

    return candidates;
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

function getDataTransferEntryPath(entry) {
  const name = String(entry?.name || "");
  const fullPath = String(entry?.fullPath || "");
  if (fullPath && fullPath !== `/${name}`) {
    return fullPath;
  }
  return name || fullPath;
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

function normalizeReferenceInput(path) {
  const value = String(path || "").replace(/\\"/g, "\"").trim();
  const obsidianPath = extractObsidianOpenPathFromValue(value);
  return decodeUriPath(obsidianPath || value).replace(/^file:\/\//i, "").replace(/\\/g, "/").trim();
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

function decodeUriPath(path) {
  try {
    return decodeURIComponent(String(path || ""));
  } catch {
    return String(path || "");
  }
}

function isLocalFileReference(path) {
  const normalizedPath = normalizeReferenceInput(path);
  return normalizedPath.startsWith("/");
}

module.exports = {
  ReferenceDropParser,
  containsObsidianOpenUrl,
  createReferenceDropDebugInfo,
  decodeUriPath,
  extractReferenceCandidatesFromText,
  isLocalFileReference,
  logReferenceDropDebug,
  normalizeReferenceInput,
  truncateDebugText
};
