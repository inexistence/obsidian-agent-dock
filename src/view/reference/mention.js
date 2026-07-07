function getMentionMatch(value, cursor) {
  const beforeCursor = value.slice(0, cursor);
  const wikiMatch = /(^|[^\]])(!?)\[\[([^\]\n]*)$/.exec(beforeCursor);
  if (wikiMatch) {
    const start = beforeCursor.length - wikiMatch[0].length + wikiMatch[1].length;
    return {
      start,
      end: cursor,
      query: wikiMatch[3],
      trigger: wikiMatch[2] ? "embed-wiki" : "wiki"
    };
  }

  const mentionMatch = /(^|\s)@([^\s@]*)$/.exec(beforeCursor);
  if (mentionMatch) {
    const start = beforeCursor.length - mentionMatch[2].length - 1;
    return {
      start,
      end: cursor,
      query: mentionMatch[2],
      trigger: "mention"
    };
  }

  return null;
}

function formatMentionToken(path, options = {}) {
  const normalizedPath = normalizeMentionPath(path);
  const embed = options.embed === true || (options.embed !== false && isImagePath(normalizedPath));
  return `${embed ? "!" : ""}[[${normalizedPath}]]`;
}

function extractMentionReferences(value) {
  const references = [];
  const seen = new Set();
  const pattern = /(!?)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]|@(?:"((?:\\"|[^"])*)"|([^\s]+))|obsidian:\/\/open\?[^\s<>"']+/g;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    const raw = match[0];
    const path = raw.startsWith("obsidian://")
      ? extractObsidianOpenFilePath(raw)
      : match[2] || match[3] || match[4] || "";
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

function isImagePath(path) {
  return /\.(png|jpe?g|gif|webp|tiff?|bmp|svg)$/i.test(String(path || "").trim());
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
  isImagePath,
  replaceObsidianOpenLinks
};
