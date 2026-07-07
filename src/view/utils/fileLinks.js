function safeDecodeUri(value) {
  try {
    return decodeURI(value);
  } catch (_error) {
    return value;
  }
}

function trimLinkTarget(value) {
  const text = String(value || "").trim();
  if (text.startsWith("<") && text.endsWith(">")) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function stripFileScheme(value) {
  if (!value.startsWith("file://")) {
    return value;
  }
  try {
    return decodeURI(new URL(value).pathname);
  } catch (_error) {
    return safeDecodeUri(value.replace(/^file:\/\//, ""));
  }
}

function parseLocalFileLinkTarget(target) {
  const decoded = stripFileScheme(safeDecodeUri(trimLinkTarget(target)));
  if (!decoded.startsWith("/")) {
    return null;
  }

  const match = decoded.match(/^(.+?)(?::(\d+)(?::(\d+))?)?$/);
  if (!match || !match[1]) {
    return null;
  }

  return {
    absolutePath: match[1],
    line: match[2] ? Math.max(1, Number.parseInt(match[2], 10)) : null,
    column: match[3] ? Math.max(1, Number.parseInt(match[3], 10)) : null
  };
}

function splitLineColumnSuffix(value) {
  const match = String(value || "").match(/^(.+?)(?::(\d+)(?::(\d+))?)?$/);
  if (!match || !match[1]) {
    return null;
  }
  return {
    path: match[1],
    line: match[2] ? Math.max(1, Number.parseInt(match[2], 10)) : null,
    column: match[3] ? Math.max(1, Number.parseInt(match[3], 10)) : null
  };
}

function parseMentionFileTarget(target) {
  const text = String(target || "").trim();
  if (!text.startsWith("@")) {
    return null;
  }

  const body = text.slice(1);
  let pathText = body;
  let suffixText = "";
  if (body.startsWith("\"")) {
    const quoted = body.match(/^"((?:\\"|[^"])*)"(.*)$/);
    if (!quoted) {
      return null;
    }
    pathText = quoted[1].replace(/\\"/g, "\"");
    suffixText = quoted[2] || "";
  }

  const suffix = splitLineColumnSuffix(`${pathText}${suffixText}`);
  if (!suffix || suffix.path.startsWith("/") || suffix.path.startsWith("@")) {
    return null;
  }

  const vaultPath = normalizePath(safeDecodeUri(suffix.path));
  if (!vaultPath || vaultPath.includes("://") || vaultPath.split("/").includes("..")) {
    return null;
  }

  return {
    line: suffix.line,
    column: suffix.column,
    vaultPath
  };
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

function formatLocalFileLinkTarget(target) {
  const parsed = parseLocalFileLinkTarget(target);
  if (!parsed) {
    return target;
  }
  const suffix = parsed.line ? `:${parsed.line}${parsed.column ? `:${parsed.column}` : ""}` : "";
  return `${encodeLocalPathForMarkdown(parsed.absolutePath)}${suffix}`;
}

function findMarkdownLinkTargetEnd(markdown, targetStart) {
  let depth = 0;
  for (let index = targetStart; index < markdown.length; index += 1) {
    const character = markdown[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character !== ")") {
      continue;
    }
    if (depth > 0) {
      depth -= 1;
      continue;
    }
    return index;
  }
  return -1;
}

function normalizeLocalFileMarkdownLinks(markdown) {
  const source = String(markdown || "");
  let result = "";
  let cursor = 0;

  while (cursor < source.length) {
    const linkTargetStart = source.indexOf("](", cursor);
    if (linkTargetStart === -1) {
      result += source.slice(cursor);
      break;
    }

    const targetStart = linkTargetStart + 2;
    const targetEnd = findMarkdownLinkTargetEnd(source, targetStart);
    if (targetEnd === -1) {
      result += source.slice(cursor);
      break;
    }

    const target = source.slice(targetStart, targetEnd);
    result += source.slice(cursor, targetStart);
    if (target.trim().startsWith("/") || target.trim().startsWith("file://")) {
      result += formatLocalFileLinkTarget(target);
    } else {
      result += target;
    }
    cursor = targetEnd;
  }

  return result;
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function getVaultBasePath(app) {
  const adapter = app?.vault?.adapter;
  if (!adapter) {
    return "";
  }
  if (typeof adapter.getBasePath === "function") {
    return normalizePath(adapter.getBasePath());
  }
  return normalizePath(adapter.basePath || "");
}

function absolutePathToVaultPath(absolutePath, vaultBasePath) {
  const filePath = normalizePath(absolutePath);
  const basePath = normalizePath(vaultBasePath);
  if (!filePath || !basePath) {
    return "";
  }
  if (filePath === basePath) {
    return "";
  }
  if (!filePath.startsWith(`${basePath}/`)) {
    return "";
  }
  return filePath.slice(basePath.length + 1);
}

function resolveVaultFile(app, vaultPath) {
  const normalizedPath = String(vaultPath || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalizedPath) {
    return null;
  }

  const exactEntry = app.vault.getAbstractFileByPath(normalizedPath);
  if (exactEntry && typeof exactEntry.extension === "string") {
    return exactEntry;
  }

  const mdPath = !/\.[^/]+$/.test(normalizedPath) ? `${normalizedPath}.md` : "";
  const mdEntry = mdPath ? app.vault.getAbstractFileByPath(mdPath) : null;
  if (mdEntry && typeof mdEntry.extension === "string") {
    return mdEntry;
  }

  const candidates = findVaultFileNameMatches(app, normalizedPath);
  return candidates.length === 1 ? candidates[0] : null;
}

function findVaultFileNameMatches(app, vaultPath) {
  const normalizedPath = String(vaultPath || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalizedPath || typeof app.vault.getAllLoadedFiles !== "function") {
    return [];
  }

  const name = normalizedPath.split("/").pop() || normalizedPath;
  const nameWithMd = /\.[^/]+$/.test(name) ? name : `${name}.md`;
  return app.vault.getAllLoadedFiles()
    .filter((entry) => entry?.path && typeof entry.extension === "string")
    .filter((entry) => (
      entry.path === normalizedPath
      || entry.name === name
      || entry.name === nameWithMd
      || entry.path.endsWith(`/${normalizedPath}`)
      || entry.path.endsWith(`/${normalizedPath}.md`)
    ));
}

function resolveLocalFileReference(app, target, vaultBasePath) {
  const parsed = parseLocalFileLinkTarget(target);
  if (!parsed) {
    return null;
  }

  const vaultPath = absolutePathToVaultPath(parsed.absolutePath, vaultBasePath);
  if (!vaultPath) {
    return null;
  }

  const file = resolveVaultFile(app, vaultPath);
  return {
    file,
    parsed,
    vaultPath
  };
}

function resolveMentionFileReference(app, target) {
  const parsed = parseMentionFileTarget(target);
  if (!parsed) {
    return null;
  }

  const file = resolveVaultFile(app, parsed.vaultPath);
  return {
    file,
    parsed,
    vaultPath: file?.path || parsed.vaultPath
  };
}

function parseObsidianInternalLinkTarget(target) {
  const text = safeDecodeUri(trimLinkTarget(target)).trim();
  if (!text || text.startsWith("/") || text.includes("://")) {
    return null;
  }
  const path = normalizePath(text.split("#")[0].split("|")[0]);
  if (!path || path.split("/").includes("..")) {
    return null;
  }
  return {
    linkText: text,
    vaultPath: path
  };
}

function resolveObsidianInternalLinkReference(app, target) {
  const parsed = parseObsidianInternalLinkTarget(target);
  if (!parsed) {
    return null;
  }
  const file = resolveVaultFile(app, parsed.vaultPath);
  return {
    file,
    parsed,
    vaultPath: file?.path || parsed.vaultPath
  };
}

function getLeafViewEditor(leaf) {
  return leaf?.view?.editor || leaf?.view?.sourceMode?.cmEditor || null;
}

function focusEditorLine(leaf, line, column) {
  const editor = getLeafViewEditor(leaf);
  if (!editor || !line) {
    return;
  }
  const cursor = {
    line: Math.max(0, line - 1),
    ch: Math.max(0, (column || 1) - 1)
  };
  if (typeof editor.setCursor === "function") {
    editor.setCursor(cursor);
  }
  if (typeof editor.scrollIntoView === "function") {
    editor.scrollIntoView({ from: cursor, to: cursor }, true);
  }
  if (typeof editor.focus === "function") {
    editor.focus();
  }
}

async function openVaultFileAtLine(app, file, line, column) {
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  focusEditorLine(leaf, line, column);
}

function addElementClass(element, className) {
  if (typeof element.addClass === "function") {
    element.addClass(className);
  } else {
    element.classList.add(className);
  }
}

function setElementAttr(element, name, value) {
  if (typeof element.setAttr === "function") {
    element.setAttr(name, value);
  } else {
    element.setAttribute(name, value);
  }
}

function attachLocalFileLinkHandler(anchor, app, reference, options) {
  const { file, parsed, vaultPath } = reference;
  addElementClass(anchor, "codex-dock__file-link");
  setElementAttr(anchor, "title", parsed.line ? `${vaultPath}:${parsed.line}` : vaultPath);
  anchor.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!file) {
      options.onOpenFailed?.({ error: null, vaultPath });
      return;
    }
    try {
      await openVaultFileAtLine(app, file, parsed.line, parsed.column);
    } catch (error) {
      console.warn("Agent Dock could not open local file link:", error);
      options.onOpenFailed?.({ error, vaultPath });
    }
  });
}

function attachObsidianInternalLinkHandler(anchor, app, reference, options) {
  const { parsed, vaultPath } = reference;
  addElementClass(anchor, "codex-dock__file-link");
  setElementAttr(anchor, "title", parsed.linkText || vaultPath);
  anchor.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (typeof app.workspace.openLinkText === "function") {
        await app.workspace.openLinkText(parsed.linkText, options.sourcePath || "", false);
        return;
      }
      if (!reference.file) {
        options.onOpenFailed?.({ error: null, vaultPath });
        return;
      }
      await openVaultFileAtLine(app, reference.file, null, null);
    } catch (error) {
      console.warn("Agent Dock could not open Obsidian internal link:", error);
      options.onOpenFailed?.({ error, vaultPath });
    }
  });
}

function decorateRenderedAnchorLinks(markdownEl, app, vaultBasePath, options) {
  for (const anchor of markdownEl.querySelectorAll("a[href]")) {
    const internalTarget = anchor.getAttribute("data-href") || (
      anchor.classList.contains("internal-link") ? anchor.getAttribute("href") : ""
    );
    const internalReference = resolveObsidianInternalLinkReference(app, internalTarget);
    if (internalReference) {
      attachObsidianInternalLinkHandler(anchor, app, internalReference, options);
      continue;
    }

    const reference = resolveLocalFileReference(app, anchor.getAttribute("href"), vaultBasePath);
    if (!reference) {
      continue;
    }
    attachLocalFileLinkHandler(anchor, app, reference, options);
  }
}

function shouldSkipBareLinkTextNode(node) {
  const parent = node.parentElement;
  return !parent || Boolean(parent.closest("a, button, code, pre, textarea, input"));
}

function findBareLocalFileReferences(text) {
  const pattern = /(^|[\s([{（【《;，。！？、])((?:file:\/\/)?\/[^\s<>"'`]+(?::\d+(?::\d+)?)?)/g;
  const matches = [];
  let match;
  while ((match = pattern.exec(String(text || ""))) !== null) {
    const prefix = match[1] || "";
    const raw = match[2] || "";
    const matchText = trimTrailingReferencePunctuation(raw);
    if (!matchText) {
      continue;
    }
    matches.push({
      index: match.index + prefix.length,
      text: matchText
    });
  }
  return matches;
}

function findMentionFileReferences(text) {
  const pattern = /(^|[\s([{:;（【《，。！？、])@(?:"((?:\\"|[^"])*)"(?:\:\d+(?:\:\d+)?)?|[^\s<>"'`]+(?::\d+(?::\d+)?)?)/g;
  const matches = [];
  let match;
  while ((match = pattern.exec(String(text || ""))) !== null) {
    const prefix = match[1] || "";
    const raw = match[0].slice(prefix.length);
    const matchText = trimTrailingReferencePunctuation(raw);
    if (!matchText) {
      continue;
    }
    matches.push({
      index: match.index + prefix.length,
      text: matchText,
      type: "mention"
    });
  }
  return matches;
}

function trimTrailingReferencePunctuation(value) {
  return String(value || "").replace(/[.,;:!?，。；：！？、)\]\}）】》]+$/g, "");
}

function findTextFileReferences(text) {
  return [
    ...findBareLocalFileReferences(text).map((match) => ({ ...match, type: "absolute" })),
    ...findMentionFileReferences(text)
  ].sort((left, right) => left.index - right.index);
}

function linkifyTextFileReferences(markdownEl, app, vaultBasePath, options) {
  const ownerDocument = markdownEl.ownerDocument || document;
  const nodeFilter = ownerDocument.defaultView?.NodeFilter || window.NodeFilter;
  const walker = ownerDocument.createTreeWalker(markdownEl, nodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node = walker.nextNode();
  while (node) {
    if (!shouldSkipBareLinkTextNode(node)) {
      textNodes.push(node);
    }
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const source = textNode.nodeValue || "";
    const matches = findTextFileReferences(source);
    if (matches.length === 0) {
      continue;
    }

    const fragment = ownerDocument.createDocumentFragment();
    let cursor = 0;
    let changed = false;
    for (const match of matches) {
      if (match.index < cursor) {
        continue;
      }
      const reference = match.type === "mention"
        ? resolveMentionFileReference(app, match.text)
        : resolveLocalFileReference(app, match.text, vaultBasePath);
      if (!reference) {
        continue;
      }

      fragment.appendChild(ownerDocument.createTextNode(source.slice(cursor, match.index)));
      const anchor = ownerDocument.createElement("a");
      setElementAttr(anchor, "href", match.type === "mention" ? match.text : formatLocalFileLinkTarget(match.text));
      anchor.textContent = match.text;
      attachLocalFileLinkHandler(anchor, app, reference, options);
      fragment.appendChild(anchor);
      cursor = match.index + match.text.length;
      changed = true;
    }

    if (!changed) {
      continue;
    }

    fragment.appendChild(ownerDocument.createTextNode(source.slice(cursor)));
    textNode.parentNode.replaceChild(fragment, textNode);
  }
}

function decorateLocalFileLinks(markdownEl, app, options = {}) {
  const vaultBasePath = getVaultBasePath(app);
  if (!markdownEl) {
    return;
  }
  decorateRenderedAnchorLinks(markdownEl, app, vaultBasePath, options);
  if (vaultBasePath) {
    linkifyTextFileReferences(markdownEl, app, vaultBasePath, options);
  }
}

module.exports = {
  decorateLocalFileLinks,
  normalizeLocalFileMarkdownLinks,
  _test: {
    absolutePathToVaultPath,
    attachLocalFileLinkHandler,
    findVaultFileNameMatches,
    findBareLocalFileReferences,
    findMentionFileReferences,
    findTextFileReferences,
    normalizeLocalFileMarkdownLinks,
    parseObsidianInternalLinkTarget,
    parseLocalFileLinkTarget,
    parseMentionFileTarget,
    resolveVaultFile,
    resolveObsidianInternalLinkReference,
    resolveMentionFileReference,
    resolveLocalFileReference
  }
};
