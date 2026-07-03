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

function getParentPath(path) {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function replaceObsidianOpenLinks(value) {
  return value.replace(/obsidian:\/\/open\?[^\s<>"']+/g, (url) => {
    const filePath = extractObsidianOpenFilePath(url);
    return filePath ? formatMentionToken(filePath) : url;
  });
}

function extractObsidianOpenFilePath(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "obsidian:" || parsed.hostname !== "open") {
      return "";
    }
    return parsed.searchParams.get("file") || "";
  } catch {
    return "";
  }
}

module.exports = {
  formatMentionToken,
  getMentionMatch,
  getParentPath,
  replaceObsidianOpenLinks
};
