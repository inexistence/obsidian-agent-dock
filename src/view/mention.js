function getMentionMatch(value, cursor) {
  const beforeCursor = value.slice(0, cursor);
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCursor);
  if (!match) {
    return null;
  }

  const start = beforeCursor.length - match[2].length - 1;
  return {
    start,
    end: cursor,
    query: match[2]
  };
}

function formatMentionToken(path) {
  return /\s/.test(path) ? `@"${path.replace(/"/g, "\\\"")}"` : `@${path}`;
}

function extractMentionReferences(value) {
  const references = [];
  const seen = new Set();
  const pattern = /@(?:"((?:\\"|[^"])*)"|([^\s]+))|obsidian:\/\/open\?[^\s<>"']+/g;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    const raw = match[0];
    const path = raw.startsWith("obsidian://")
      ? extractObsidianOpenFilePath(raw)
      : match[1] || match[2] || "";
    const normalizedPath = normalizeMentionPath(path);

    if (normalizedPath && !seen.has(normalizedPath)) {
      seen.add(normalizedPath);
      references.push({
        path: normalizedPath,
        name: getPathName(normalizedPath)
      });
    }
  }

  return references;
}

function normalizeMentionPath(path) {
  return String(path || "").replace(/\\"/g, "\"").trim();
}

function getPathName(path) {
  const normalized = String(path || "").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function getParentPath(path) {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function replaceObsidianOpenLinks(value, normalizePath = (path) => path) {
  return value.replace(/obsidian:\/\/open\?[^\s<>"']+/g, (url) => {
    const filePath = normalizePath(extractObsidianOpenFilePath(url));
    return filePath ? formatMentionToken(filePath) : url;
  });
}

function extractObsidianOpenFilePath(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "obsidian:" || parsed.hostname !== "open") {
      return "";
    }
    return parsed.searchParams.get("file") || parsed.searchParams.get("path") || "";
  } catch {
    return "";
  }
}

module.exports = {
  extractMentionReferences,
  formatMentionToken,
  getMentionMatch,
  getParentPath,
  replaceObsidianOpenLinks
};
