const DEFAULT_PASTE_FOLDER = ".agent-dock-cache/pasted-images";
const DEFAULT_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function extractClipboardImageFiles(clipboardData) {
  const files = [];
  const genericClipboardImages = [];
  const seen = new Set();

  for (const item of Array.from(clipboardData?.items || [])) {
    if (item?.kind !== "file" || !isImageType(item.type)) {
      continue;
    }
    const file = item.getAsFile?.();
    if (file && !hasSeenClipboardFile(seen, file)) {
      markClipboardFileSeen(seen, file);
      addClipboardImageFile(files, genericClipboardImages, file);
    }
  }

  for (const file of Array.from(clipboardData?.files || [])) {
    if (isImageType(file?.type) && !hasSeenClipboardFile(seen, file)) {
      markClipboardFileSeen(seen, file);
      addClipboardImageFile(files, genericClipboardImages, file);
    }
  }

  return files;
}

function addClipboardImageFile(files, genericClipboardImages, file) {
  if (!isGenericClipboardImageFile(file)) {
    files.push(file);
    return;
  }
  genericClipboardImages.push(file);
  if (genericClipboardImages.length === 1) {
    files.push(file);
  }
}

function hasSeenClipboardFile(seen, file) {
  return seen.has(file) || seen.has(getClipboardFileKey(file));
}

function markClipboardFileSeen(seen, file) {
  seen.add(file);
  seen.add(getClipboardFileKey(file));
}

function getClipboardFileKey(file) {
  return [
    String(file?.name || ""),
    String(file?.type || "").toLowerCase(),
    Number.isFinite(Number(file?.size)) ? Number(file.size) : "",
    Number.isFinite(Number(file?.lastModified)) ? Number(file.lastModified) : ""
  ].join("|");
}

function isImageType(type) {
  return String(type || "").toLowerCase().startsWith("image/");
}

function isGenericClipboardImageFile(file) {
  const name = String(file?.name || "").trim().toLowerCase();
  return !name || /^image\.(png|jpe?g|gif|webp|tiff?|bmp|svg)$/.test(name);
}

async function saveClipboardImageFile(app, file, options = {}) {
  if (options.cleanup !== false) {
    await cleanupExpiredPastedImages(app, options);
  }
  const folder = resolvePasteFolder(app, options);
  const extension = getImageExtension(file);
  const baseName = createPastedImageBaseName(options.now || new Date());
  await ensureVaultFolder(app, folder);
  const path = await getAvailableVaultPath(app, joinVaultPath(folder, `${baseName}.${extension}`));
  const buffer = await file.arrayBuffer();
  await app.vault.createBinary(path, buffer);
  return path;
}

function resolvePasteFolder(app, options = {}) {
  if (options.useObsidianAttachmentFolder === true) {
    return resolveObsidianAttachmentFolder(app, options);
  }
  return DEFAULT_PASTE_FOLDER;
}

function resolveObsidianAttachmentFolder(app, options = {}) {
  const rawConfigured = String(
    options.attachmentFolderPath
    ?? app?.vault?.getConfig?.("attachmentFolderPath")
    ?? ""
  ).trim();
  const configured = normalizeVaultPath(rawConfigured);
  const activeFile = options.activeFile ?? app?.workspace?.getActiveFile?.();
  const activeFolder = normalizeVaultPath(activeFile?.parent?.path || getParentPath(activeFile?.path || ""));

  if (rawConfigured === "/") {
    return "";
  }
  if (rawConfigured === "." || rawConfigured === "./") {
    return activeFolder;
  }
  if (rawConfigured.startsWith("./")) {
    return joinVaultPath(activeFolder, rawConfigured.slice(2));
  }
  if (!configured) {
    return DEFAULT_PASTE_FOLDER;
  }
  return configured;
}

async function cleanupExpiredPastedImages(app, options = {}) {
  const folder = normalizeVaultPath(options.folder || DEFAULT_PASTE_FOLDER);
  const maxAgeMs = Number(options.maxAgeMs) || DEFAULT_CACHE_MAX_AGE_MS;
  const now = Number(options.nowMs) || Date.now();
  const adapter = app?.vault?.adapter;
  if (!adapter || !folder || !await adapter.exists(folder)) {
    return 0;
  }

  const files = await listVaultFiles(adapter, folder);
  let removed = 0;
  for (const path of files) {
    if (!isCacheImagePath(path, folder)) {
      continue;
    }
    const stat = await safeStat(adapter, path);
    const mtime = Number(stat?.mtime);
    if (!Number.isFinite(mtime) || now - mtime <= maxAgeMs) {
      continue;
    }
    if (await removeVaultFile(adapter, path)) {
      removed += 1;
    }
  }
  return removed;
}

async function deletePastedImagePaths(app, paths, options = {}) {
  const folder = normalizeVaultPath(options.folder || DEFAULT_PASTE_FOLDER);
  const adapter = app?.vault?.adapter;
  if (!adapter || !Array.isArray(paths) || paths.length === 0) {
    return 0;
  }

  let removed = 0;
  const seen = new Set();
  for (const rawPath of paths) {
    const path = normalizeVaultPath(rawPath);
    if (!path || seen.has(path) || !isCacheImagePath(path, folder)) {
      continue;
    }
    seen.add(path);
    if (await removeVaultFile(adapter, path)) {
      removed += 1;
    }
  }
  return removed;
}

async function listVaultFiles(adapter, folder) {
  const listing = await adapter.list(folder);
  const files = [...(listing.files || [])];
  for (const childFolder of listing.folders || []) {
    files.push(...await listVaultFiles(adapter, childFolder));
  }
  return files;
}

async function safeStat(adapter, path) {
  try {
    return await adapter.stat(path);
  } catch {
    return null;
  }
}

async function removeVaultFile(adapter, path) {
  try {
    if (await adapter.exists(path)) {
      await adapter.remove(path);
      return true;
    }
  } catch (error) {
    console.warn(`Agent Dock could not remove pasted image cache file ${path}:`, error);
  }
  return false;
}

function isCacheImagePath(path, folder = DEFAULT_PASTE_FOLDER) {
  const normalizedPath = normalizeVaultPath(path);
  const normalizedFolder = normalizeVaultPath(folder);
  if (!normalizedPath || !normalizedFolder || !normalizedPath.startsWith(`${normalizedFolder}/`)) {
    return false;
  }
  return /\.(png|jpe?g|gif|webp|tiff?|bmp|svg)$/i.test(normalizedPath);
}

async function ensureVaultFolder(app, folder) {
  const normalizedFolder = normalizeVaultPath(folder);
  if (!normalizedFolder || app.vault.getAbstractFileByPath(normalizedFolder)) {
    return;
  }

  const parts = normalizedFolder.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = joinVaultPath(current, part);
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

async function getAvailableVaultPath(app, requestedPath) {
  const normalizedPath = normalizeVaultPath(requestedPath);
  if (!app.vault.getAbstractFileByPath(normalizedPath)) {
    return normalizedPath;
  }

  const dotIndex = normalizedPath.lastIndexOf(".");
  const slashIndex = normalizedPath.lastIndexOf("/");
  const hasExtension = dotIndex > slashIndex;
  const base = hasExtension ? normalizedPath.slice(0, dotIndex) : normalizedPath;
  const extension = hasExtension ? normalizedPath.slice(dotIndex) : "";
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${base}-${index}${extension}`;
    if (!app.vault.getAbstractFileByPath(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not create a unique image filename.");
}

function getImageExtension(file) {
  const nameExtension = String(file?.name || "").match(/\.([a-z0-9]+)$/i)?.[1];
  const mimeExtension = getImageExtensionForMime(file?.type);
  return sanitizeExtension(nameExtension || mimeExtension || "png");
}

function getImageExtensionForMime(type) {
  const normalizedType = String(type || "").toLowerCase();
  if (normalizedType === "image/jpeg" || normalizedType === "image/jpg") {
    return "jpg";
  }
  if (normalizedType === "image/svg+xml") {
    return "svg";
  }
  const match = normalizedType.match(/^image\/([a-z0-9.+-]+)$/);
  return match ? match[1].replace(/^x-/, "").replace(/\+xml$/, "") : "";
}

function sanitizeExtension(extension) {
  const value = String(extension || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return value || "png";
}

function createPastedImageBaseName(date) {
  const safeDate = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return [
    "pasted-image",
    safeDate.getFullYear(),
    pad(safeDate.getMonth() + 1),
    pad(safeDate.getDate()),
    "-",
    pad(safeDate.getHours()),
    pad(safeDate.getMinutes()),
    pad(safeDate.getSeconds()),
    "-",
    pad(safeDate.getMilliseconds(), 3)
  ].join("");
}

function normalizeVaultPath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .trim()
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/");
}

function joinVaultPath(...parts) {
  return normalizeVaultPath(parts.filter((part) => String(part || "").trim()).join("/"));
}

function getParentPath(path) {
  const normalizedPath = normalizeVaultPath(path);
  const index = normalizedPath.lastIndexOf("/");
  return index >= 0 ? normalizedPath.slice(0, index) : "";
}

module.exports = {
  cleanupExpiredPastedImages,
  deletePastedImagePaths,
  extractClipboardImageFiles,
  saveClipboardImageFile,
  _test: {
    cleanupExpiredPastedImages,
    createPastedImageBaseName,
    deletePastedImagePaths,
    extractClipboardImageFiles,
    getImageExtension,
    isCacheImagePath,
    isGenericClipboardImageFile,
    joinVaultPath,
    normalizeVaultPath,
    resolvePasteFolder,
    resolveObsidianAttachmentFolder
  }
};
