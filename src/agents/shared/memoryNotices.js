const { formatMemoryLine } = require("../../storage/MemoryStore");
const { formatAuditDate } = require("./auditFormatting");

function emitMemoryNotice(onUpdate, memories, translate, keyPrefix = "cursor") {
  if (!Array.isArray(memories) || memories.length === 0) {
    return;
  }

  onUpdate({
    kind: "notice",
    noticeType: "memory_referenced",
    title: translate(`${keyPrefix}.memoryReferenced.title`),
    summary: formatMemoryNoticeSummary(memories, translate, keyPrefix),
    detail: memories.map(formatMemoryLine).join("\n"),
    auditItems: buildReferencedMemoryAuditItems(memories, translate, keyPrefix)
  });
}

function emitDeepMemoryNotice(onUpdate, memories, translate, keyPrefix = "cursor") {
  if (!Array.isArray(memories) || memories.length === 0) {
    return;
  }

  onUpdate({
    kind: "notice",
    noticeType: "deep_memory_referenced",
    title: translate(`${keyPrefix}.deepMemoryReferenced.title`),
    summary: translate(`${keyPrefix}.deepMemoryReferenced.summary`, {
      count: memories.length
    }),
    detail: memories.map(formatDeepMemoryLine).join("\n"),
    auditItems: buildReferencedDeepMemoryAuditItems(memories, translate, keyPrefix)
  });
}

function emitContextCompressedNotice(onUpdate, context, translate, keyPrefix = "cursor") {
  if (!context?.compressed) {
    return;
  }

  onUpdate({
    kind: "notice",
    title: translate(`${keyPrefix}.contextCompressed.title`),
    summary: translate(`${keyPrefix}.contextCompressed.summary`, {
      original: formatLocaleNumber(context.originalChars),
      prompt: formatLocaleNumber(context.promptChars),
      limit: formatLocaleNumber(context.limitChars)
    })
  });
}

function formatMemoryNoticeSummary(memories, translate, keyPrefix = "cursor") {
  const count = memories.length;
  return translate(`${keyPrefix}.memoryReferenced.summary`, {
    count,
    noteLabel: count === 1 ? "note" : "notes"
  });
}

function buildReferencedMemoryAuditItems(memories, translate, keyPrefix = "cursor") {
  return (Array.isArray(memories) ? memories : []).map((item, index) => {
    const source = translateMemorySource(translate, keyPrefix, item.source);
    const type = translate(`${keyPrefix}.memoryAudit.type.memory`);
    return {
      title: formatAuditItemTitle(type, index),
      summary: truncateNoticeText(item.text),
      type,
      source,
      badges: [item.scope, item.kind, source].filter(Boolean),
      fields: [
        createField(translate(`${keyPrefix}.memoryAudit.field.reason`), formatReferenceReason(item, translate, keyPrefix)),
        createField(translate(`${keyPrefix}.memoryAudit.field.source`), source),
        createField(translate(`${keyPrefix}.memoryAudit.field.createdAt`), formatAuditDate(item.createdAt)),
        createField(translate(`${keyPrefix}.memoryAudit.field.updatedAt`), formatAuditDate(item.updatedAt)),
        createField(translate(`${keyPrefix}.memoryAudit.field.content`), item.text),
        createField(translate(`${keyPrefix}.memoryAudit.field.scope`), item.scope),
        createField(translate(`${keyPrefix}.memoryAudit.field.kind`), item.kind),
        createField(translate(`${keyPrefix}.memoryAudit.field.confidence`), formatDecimal(item.confidence))
      ].filter(Boolean)
    };
  });
}

function buildReferencedDeepMemoryAuditItems(memories, translate, keyPrefix = "cursor") {
  return (Array.isArray(memories) ? memories : []).map((item, index) => {
    const type = translate(`${keyPrefix}.memoryAudit.type.deepMemory`);
    const source = isAiReflectionDeepMemory(item)
      ? translate(`${keyPrefix}.deepMemoryUpdated.aiReflectionSource`)
      : translate(`${keyPrefix}.memoryAudit.source.localRules`);
    return {
      title: formatAuditItemTitle(type, index),
      summary: truncateNoticeText(item.summary),
      type,
      source,
      badges: [item.kind, source].concat(item.salienceAxes || []).filter(Boolean),
      fields: [
        createField(
          translate(`${keyPrefix}.memoryAudit.field.reason`),
          translate(`${keyPrefix}.memoryAudit.reason.deepMemoryReferenced`)
        ),
        createField(translate(`${keyPrefix}.memoryAudit.field.source`), source),
        createField(translate(`${keyPrefix}.memoryAudit.field.createdAt`), formatAuditDate(item.createdAt)),
        createField(translate(`${keyPrefix}.memoryAudit.field.updatedAt`), formatAuditDate(item.updatedAt)),
        createField(translate(`${keyPrefix}.memoryAudit.field.summary`), item.summary),
        createField(translate(`${keyPrefix}.memoryAudit.field.why`), item.whyItMatters),
        createField(translate(`${keyPrefix}.memoryAudit.field.feltSense`), item.feltSense),
        createField(translate(`${keyPrefix}.memoryAudit.field.userExcerpt`), item.userExcerpt),
        createField(translate(`${keyPrefix}.memoryAudit.field.assistantExcerpt`), item.assistantExcerpt),
        createField(translate(`${keyPrefix}.memoryAudit.field.importance`), formatDecimal(item.importance)),
        createField(translate(`${keyPrefix}.memoryAudit.field.confidence`), formatDecimal(item.confidence))
      ].filter(Boolean)
    };
  });
}

function isAiReflectionDeepMemory(item) {
  return item?.kind === "visible_reflection"
    || (Array.isArray(item?.topics) && item.topics.includes("agent_dock_signal"));
}

function formatDeepMemoryLine(item) {
  const label = [item?.kind].concat(item?.salienceAxes || []).filter(Boolean).join("/");
  const summary = truncateNoticeText(item?.summary);
  return label ? `[${label}] ${summary}` : summary;
}

function formatReferenceReason(item, translate, keyPrefix) {
  const audit = item?.referenceAudit || {};
  if (audit.reasonCode === "global_memory") {
    return translate(`${keyPrefix}.memoryAudit.reason.globalMemory`);
  }
  const sourceSummary = formatMatchedTokenSources(audit.matchedTokenSources, translate, keyPrefix);
  if (sourceSummary) {
    return translate(`${keyPrefix}.memoryAudit.reason.matchedSources`, {
      sources: sourceSummary,
      score: formatDecimal(audit.matchScore)
    });
  }
  const terms = Array.isArray(audit.matchedTokens)
    ? audit.matchedTokens.filter(Boolean).slice(0, 6).join(", ")
    : "";
  if (terms) {
    return translate(`${keyPrefix}.memoryAudit.reason.matchedTerms`, {
      terms,
      score: formatDecimal(audit.matchScore)
    });
  }
  return translate(`${keyPrefix}.memoryAudit.reason.relevantMemory`);
}

function formatMatchedTokenSources(matchedTokenSources, translate, keyPrefix) {
  if (!Array.isArray(matchedTokenSources) || matchedTokenSources.length === 0) {
    return "";
  }
  const bySource = new Map();
  for (const entry of matchedTokenSources) {
    const token = String(entry?.token || "").trim();
    if (!token) {
      continue;
    }
    const sources = Array.isArray(entry.sources) && entry.sources.length > 0
      ? entry.sources
      : ["prompt"];
    for (const source of sources) {
      const sourceKey = normalizeMatchSource(source);
      const tokens = bySource.get(sourceKey) || [];
      if (!tokens.includes(token)) {
        tokens.push(token);
      }
      bySource.set(sourceKey, tokens);
    }
  }
  return Array.from(bySource.entries())
    .map(([source, tokens]) => translate(`${keyPrefix}.memoryAudit.reason.sourceGroup`, {
      source: translate(`${keyPrefix}.memoryAudit.matchSource.${source}`),
      terms: tokens.slice(0, 6).join(", ")
    }))
    .join("; ");
}

function normalizeMatchSource(source) {
  if (source === "activeFilePath" || source === "activeFilePathExpansion") {
    return source;
  }
  if (source === "workingDirectory" || source === "workingDirectoryExpansion") {
    return source;
  }
  if (source === "promptExpansion") {
    return source;
  }
  return "prompt";
}

function formatAuditItemTitle(type, index) {
  const label = String(type || "").trim();
  const number = Number.isFinite(index) ? index + 1 : 1;
  return label ? `${label} ${number}` : `Item ${number}`;
}

function createField(label, value) {
  const text = String(value === undefined || value === null ? "" : value).replace(/\s+/g, " ").trim();
  if (!label || !text) {
    return null;
  }
  return {
    label,
    value: truncateNoticeText(text, 1400)
  };
}

function truncateNoticeText(text, maxChars = 180) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, maxChars - 1)}...`;
}

function translateMemorySource(translate, keyPrefix, source) {
  const normalized = String(source || "").trim();
  if (normalized === "user") {
    return translate(`${keyPrefix}.memoryAudit.source.user`);
  }
  if (normalized === "ai") {
    return translate(`${keyPrefix}.memoryAudit.source.aiReflection`);
  }
  return translate(`${keyPrefix}.memoryAudit.source.localRules`);
}

function formatDecimal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "";
  }
  return number.toFixed(2).replace(/\.?0+$/, "");
}

function formatLocaleNumber(value) {
  return new Intl.NumberFormat().format(value);
}

module.exports = {
  buildReferencedDeepMemoryAuditItems,
  buildReferencedMemoryAuditItems,
  emitDeepMemoryNotice,
  emitContextCompressedNotice,
  emitMemoryNotice,
  formatMemoryNoticeSummary
};
