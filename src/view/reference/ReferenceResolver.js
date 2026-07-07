const { getParentPath, isImagePath } = require("./mention");
const {
  normalizeReferenceInput,
  truncateDebugText
} = require("./ReferenceDropParser");

const MAX_PARTIAL_MENTION_SUGGESTIONS = 7;

class ReferenceResolver {
  constructor(app) {
    this.app = app;
  }

  getVaultPathSuggestions(query, options = {}) {
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
      .sort((left, right) => compareMentionSuggestions(left, right, normalizedQuery, options));
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
}

function compareMentionSuggestions(left, right, normalizedQuery, options = {}) {
  if (options.preferImages) {
    const leftImage = isImagePath(left.path);
    const rightImage = isImagePath(right.path);
    if (leftImage !== rightImage) {
      return leftImage ? -1 : 1;
    }
  }

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

module.exports = {
  ReferenceResolver
};
