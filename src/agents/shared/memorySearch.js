const { formatMemoryLine } = require("../../storage/MemoryStore");
const { buildReferencedMemoryAuditItems } = require("./memoryNotices");

const MEMORY_SEARCH_LIMIT = 5;

const MEMORY_LOOKUP_PATTERNS = [
  /(?:之前|以前|过去|上次|曾经).{0,24}(?:说过|说的|提过|聊过|记录|记得|偏好|要求|方案|感觉)/,
  /(?:之前|以前|过去|上次|曾经|上回|前面|刚才).{0,24}(?:定的|约定|决定|选的|用的|习惯|风格|规则|结论)/,
  /(?:按|照|根据).{0,12}(?:之前|以前|上次|上回|过去).{0,24}(?:习惯|偏好|要求|约定|方案|规则|结论)/,
  /(?:回忆|想起来|记一下|翻一下|看一下).{0,16}(?:记忆|记录|历史|之前|以前|上次|上回|约定)/,
  /(?:查|找|搜索|看看).{0,12}(?:记忆|记录|历史)/,
  /(?:有没有|是否).{0,16}(?:记录|记得|保存).{0,24}(?:不想|不要|偏好|要求|方案)/,
  /(?:有没有|是否).{0,16}(?:保存|记录|记住|提过).{0,24}(?:约定|决定|结论|习惯|规则|风格)/,
  /(?:记得|记住|想起来).{0,24}(?:那个|这种|这种感觉|感觉|不要太刻意|不刻意|自然|连续)/,
  /(?:do you remember|did i mention|previously|before|earlier|past).{0,48}(?:preference|requirement|decision|memory|note|said|mentioned)/i,
  /(?:preference|requirement|decision|agreement|convention|rule|style|habit|memory|note|said|mentioned).{0,48}(?:previously|before|earlier|past|last time)/i,
  /(?:previously|before|earlier|past|last time).{0,48}(?:agreement|convention|rule|style|habit|choice|decision)/i,
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
    noticeType: "memory_search",
    title: translate(`${keyPrefix}.memorySearch.title`),
    summary: translate(`${keyPrefix}.memorySearch.summary`, {
      count: results.length
    }),
    detail: formatMemorySearchDetail(results),
    auditItems: buildReferencedMemoryAuditItems(results, translate, keyPrefix)
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
