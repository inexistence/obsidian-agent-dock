const { formatMemoryLine } = require("../../storage/MemoryStore");

const MEMORY_SEARCH_LIMIT = 5;

const MEMORY_LOOKUP_PATTERNS = [
  /(?:之前|以前|过去|上次|曾经).{0,24}(?:说过|提过|聊过|记录|记得|偏好|要求|方案)/,
  /(?:查|找|搜索|看看).{0,12}(?:记忆|记录|历史)/,
  /(?:有没有|是否).{0,16}(?:记录|记得|保存).{0,24}(?:不想|不要|偏好|要求|方案)/,
  /(?:do you remember|did i mention|previously|before|earlier|past).{0,48}(?:preference|requirement|decision|memory|note|said|mentioned)/i,
  /(?:preference|requirement|decision|memory|note|said|mentioned).{0,48}(?:previously|before|earlier|past)/i,
  /(?:search|check|look up|find).{0,24}(?:memory|memories|previous notes|past notes|history)/i
];

async function getExplicitMemorySearch(memoryStore, prompt, settings, onUpdate, translate, keyPrefix) {
  if (!shouldSearchMemory(prompt, settings)) {
    return {
      performed: false,
      results: []
    };
  }

  const results = await memoryStore.searchMemories(prompt, settings, {
    limit: MEMORY_SEARCH_LIMIT
  });

  onUpdate({
    kind: "notice",
    title: translate(`${keyPrefix}.memorySearch.title`),
    summary: translate(`${keyPrefix}.memorySearch.summary`, {
      count: results.length
    }),
    detail: formatMemorySearchDetail(results)
  });

  return {
    performed: true,
    results
  };
}

function removeMemorySearchDuplicates(memories, memorySearchResults) {
  if (!Array.isArray(memories) || memories.length === 0) {
    return [];
  }
  if (!Array.isArray(memorySearchResults) || memorySearchResults.length === 0) {
    return memories;
  }

  const explicitKeys = new Set(memorySearchResults.map(getMemoryIdentity).filter(Boolean));
  return memories.filter((memory) => !explicitKeys.has(getMemoryIdentity(memory)));
}

function shouldSearchMemory(prompt, settings) {
  if (!settings.memoryEnabled || !settings.memoryAgentSearchEnabled) {
    return false;
  }

  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return false;
  }

  return MEMORY_LOOKUP_PATTERNS.some((pattern) => pattern.test(text));
}

function getMemoryIdentity(memory) {
  return memory?.key || memory?.id || "";
}

function formatMemorySearchDetail(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "- No matching local memory was found.";
  }
  return results.map(formatMemoryLine).join("\n");
}

module.exports = {
  getExplicitMemorySearch,
  removeMemorySearchDuplicates,
  shouldSearchMemory,
  _test: {
    formatMemorySearchDetail,
    MEMORY_LOOKUP_PATTERNS
  }
};
