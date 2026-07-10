const MAX_NOTICE_ITEMS = 3;
const MAX_NOTICE_TEXT_CHARS = 180;
const MAX_AUDIT_TEXT_CHARS = 1400;

function formatMemoryUpdateSummary(settings, keyPrefix, translate, saved) {
  const count = saved.length;
  return translate(settings, `${keyPrefix}.memoryUpdated.summary`, {
    count,
    noteLabel: count === 1 ? "note" : "notes"
  });
}

function formatDeepMemoryUpdateSummary(settings, keyPrefix, translate, saved) {
  const count = saved.length;
  const aiCount = saved.filter(isAiReflectionDeepMemory).length;
  const base = translate(settings, `${keyPrefix}.deepMemoryUpdated.summary`, { count });
  if (aiCount <= 0) {
    return base;
  }
  return `${base}\n${translate(settings, `${keyPrefix}.deepMemoryUpdated.aiReflectionCount`, { count: aiCount })}`;
}

function formatInteractionMemoryUpdateSummary(settings, keyPrefix, translate, result) {
  const closedEpisodes = Array.isArray(result?.closedEpisodes) ? result.closedEpisodes : [];
  const changed = []
    .concat((Array.isArray(result?.updatedPatterns) ? result.updatedPatterns : []).map((item) => ({
      type: item.generatedBy === "ai"
        ? translate(settings, `${keyPrefix}.interactionMemoryUpdated.aiPatternLabel`)
        : translate(settings, `${keyPrefix}.interactionMemoryUpdated.patternLabel`),
      text: item.summary,
      evidenceCount: item.evidenceCount
    })))
    .concat((Array.isArray(result?.updatedTensions) ? result.updatedTensions : []).map((item) => ({
      type: translate(settings, `${keyPrefix}.interactionMemoryUpdated.tensionLabel`),
      text: item.resolutionStyle,
      evidenceCount: item.evidenceCount
    })))
    .concat((Array.isArray(result?.updatedStableImpressions) ? result.updatedStableImpressions : []).map((item) => ({
      type: item.generatedBy === "ai"
        ? translate(settings, `${keyPrefix}.interactionMemoryUpdated.aiImpressionLabel`)
        : translate(settings, `${keyPrefix}.interactionMemoryUpdated.impressionLabel`),
      text: item.text,
      evidenceCount: item.evidenceCount
    })));

  const base = translate(settings, `${keyPrefix}.interactionMemoryUpdated.summary`, {
    count: closedEpisodes.length
  });
  const sections = [];
  if (closedEpisodes.length > 0) {
    sections.push(translate(settings, `${keyPrefix}.interactionMemoryUpdated.episodes`, {
      items: formatItemList(closedEpisodes, formatInteractionEpisode)
    }));
  }
  if (changed.length > 0) {
    sections.push(translate(settings, `${keyPrefix}.interactionMemoryUpdated.changed`, {
      items: formatItemList(changed, (item) => formatInteractionChange(settings, keyPrefix, translate, item))
    }));
  } else if (closedEpisodes.length > 0) {
    sections.push(translate(settings, `${keyPrefix}.interactionMemoryUpdated.unchanged`));
  }
  return [base].concat(sections).filter(Boolean).join("\n");
}

function formatInteractionMemoryUpdateTitle(settings, keyPrefix, translate, result) {
  return translate(settings, hasInteractionDerivedChanges(result)
    ? `${keyPrefix}.interactionMemoryUpdated.title`
    : `${keyPrefix}.interactionMemoryUpdated.episodeTitle`);
}

function formatInteractionMemoryUpdateKind(result) {
  return hasInteractionDerivedChanges(result) ? "notice" : "activity";
}

function buildMemoryUpdateAuditItems(saved, settings, keyPrefix, translate) {
  return (Array.isArray(saved) ? saved : []).map((item, index) => {
    const type = translate(settings, `${keyPrefix}.memoryAudit.type.memory`);
    const source = translateMemorySource(settings, keyPrefix, translate, item.source);
    return {
      title: formatAuditItemTitle(type, index),
      summary: truncateNoticeText(item.text),
      type,
      source,
      badges: [item.scope, item.kind, source].filter(Boolean),
      fields: [
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.reason`), formatUpdateReason(item, settings, keyPrefix, translate)),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.source`), source),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.content`), item.text),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.scope`), item.scope),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.kind`), item.kind),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.confidence`), formatNumber(item.confidence))
      ].filter(Boolean)
    };
  });
}

function formatUpdateReason(item, settings, keyPrefix, translate) {
  const audit = item?.updateAudit || {};
  if (audit.reasonCode === "existing_memory_refreshed") {
    return translate(settings, `${keyPrefix}.memoryAudit.reason.existingMemoryRefreshed`, {
      kind: item.kind || audit.kind || "",
      confidence: formatNumber(item.confidence || audit.confidence)
    });
  }
  if (audit.reasonCode === "ai_signal_capture") {
    return translate(settings, `${keyPrefix}.memoryAudit.reason.aiSignalCapture`, {
      kind: item.kind || audit.kind || "",
      confidence: formatNumber(item.confidence || audit.confidence)
    });
  }
  return translate(settings, `${keyPrefix}.memoryAudit.reason.localRuleCapture`, {
    kind: item.kind || audit.kind || "",
    confidence: formatNumber(item.confidence || audit.confidence)
  });
}

function buildDeepMemoryAuditItems(saved, settings, keyPrefix, translate) {
  return (Array.isArray(saved) ? saved : []).map((item, index) => {
    const type = translate(settings, `${keyPrefix}.memoryAudit.type.deepMemory`);
    const source = isAiReflectionDeepMemory(item)
      ? translate(settings, `${keyPrefix}.deepMemoryUpdated.aiReflectionSource`)
      : translate(settings, `${keyPrefix}.memoryAudit.source.localRules`);
    return {
      title: formatAuditItemTitle(type, index),
      summary: truncateNoticeText(item.summary),
      type,
      source,
      badges: [item.kind, source].concat(item.salienceAxes || []).filter(Boolean),
      fields: [
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.reason`), formatDeepMemoryReason(item, source, settings, keyPrefix, translate)),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.source`), source),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.summary`), item.summary),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.why`), item.whyItMatters),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.feltSense`), item.feltSense),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.userExcerpt`), item.userExcerpt),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.assistantExcerpt`), item.assistantExcerpt),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.importance`), formatNumber(item.importance)),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.confidence`), formatNumber(item.confidence))
      ].filter(Boolean)
    };
  });
}

function buildInteractionMemoryAuditItems(result, settings, keyPrefix, translate) {
  const closedEpisodes = Array.isArray(result?.closedEpisodes) ? result.closedEpisodes : [];
  const items = closedEpisodes.map((item, index) => {
    const type = translate(settings, `${keyPrefix}.memoryAudit.type.interactionEpisode`);
    const source = item.aiReflectionContribution
      ? translate(settings, `${keyPrefix}.memoryAudit.source.localRulesAndAiReflection`)
      : translate(settings, `${keyPrefix}.memoryAudit.source.localRules`);
    const affectedItems = getInteractionChangesForEpisode(result, item, settings, keyPrefix, translate);
    const patternCandidateUpdate = (Array.isArray(result?.patternCandidateUpdates) ? result.patternCandidateUpdates : [])
      .find((entry) => entry.episodeId === item.id);
    return {
      title: formatAuditItemTitle(type, index),
      summary: truncateNoticeText([item.userExcerpt, item.reaction?.excerpt || item.outcomeHint].filter(Boolean).join(" -> ")),
      type,
      source,
      badges: [item.context, item.phase, item.memoryRole].filter(Boolean),
      fields: [
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.reason`), formatInteractionEpisodeReason(item, settings, keyPrefix, translate)),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.source`), source),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.userExcerpt`), item.userExcerpt),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.assistantExcerpt`), item.assistantExcerpt),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.reaction`), item.reaction?.excerpt || item.outcomeHint),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.reactionType`), formatInteractionReaction(item, settings, keyPrefix, translate)),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.aiReflection`), formatAiReflectionContribution(item.aiReflectionContribution, settings, keyPrefix, translate)),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.patternCandidate`), formatPatternCandidateUpdate(patternCandidateUpdate, settings, keyPrefix, translate)),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.effect`), formatInteractionEpisodeEffect(item, affectedItems, settings, keyPrefix, translate)),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.role`), item.memoryRole),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.weight`), formatNumber(item.eventWeight))
      ].filter(Boolean)
    };
  });

  const changed = []
    .concat((Array.isArray(result?.updatedPatterns) ? result.updatedPatterns : []).map((item) => ({
      item,
      type: item.generatedBy === "ai"
        ? translate(settings, `${keyPrefix}.interactionMemoryUpdated.aiPatternLabel`)
        : translate(settings, `${keyPrefix}.interactionMemoryUpdated.patternLabel`),
      text: item.summary,
      source: item.generatedBy === "ai"
        ? translate(settings, `${keyPrefix}.memoryAudit.source.aiReflectionPromotedLocally`)
        : translate(settings, `${keyPrefix}.memoryAudit.source.localRules`)
    })))
    .concat((Array.isArray(result?.updatedTensions) ? result.updatedTensions : []).map((item) => ({
      item,
      type: translate(settings, `${keyPrefix}.interactionMemoryUpdated.tensionLabel`),
      text: item.resolutionStyle
    })))
    .concat((Array.isArray(result?.updatedStableImpressions) ? result.updatedStableImpressions : []).map((item) => ({
      item,
      type: item.generatedBy === "ai"
        ? translate(settings, `${keyPrefix}.interactionMemoryUpdated.aiImpressionLabel`)
        : translate(settings, `${keyPrefix}.interactionMemoryUpdated.impressionLabel`),
      text: item.text,
      source: item.generatedBy === "ai"
        ? translate(settings, `${keyPrefix}.memoryAudit.source.aiReflection`)
        : translate(settings, `${keyPrefix}.memoryAudit.source.localRules`)
    })));

  for (const [index, entry] of changed.entries()) {
    const source = entry.source || translate(settings, `${keyPrefix}.memoryAudit.source.localRules`);
    items.push({
      title: formatAuditItemTitle(entry.type, index),
      summary: truncateNoticeText(entry.text),
      type: entry.type,
      source,
      badges: [
        entry.type,
        entry.item.evidenceCount ? translate(settings, `${keyPrefix}.interactionMemoryUpdated.evidenceLabel`, {
          count: entry.item.evidenceCount
        }) : ""
      ].filter(Boolean),
      fields: [
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.reason`), formatInteractionChangeReason(entry, settings, keyPrefix, translate)),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.source`), source),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.content`), entry.text),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.evidenceCount`), entry.item.evidenceCount),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.confidence`), formatNumber(entry.item.confidence)),
        createField(translate(settings, `${keyPrefix}.memoryAudit.field.strength`), formatNumber(entry.item.strength))
      ].filter(Boolean)
    });
  }

  return items;
}

function formatAiReflectionContribution(contribution, settings, keyPrefix, translate) {
  if (!contribution) {
    return "";
  }
  return translate(settings, `${keyPrefix}.memoryAudit.effect.aiReflectionContribution`, {
    summary: contribution.summary || "",
    shapes: (Array.isArray(contribution.shapes) ? contribution.shapes : []).join(", "),
    confidence: formatNumber(contribution.confidence),
    weight: formatNumber(contribution.weight)
  });
}

function formatPatternCandidateUpdate(update, settings, keyPrefix, translate) {
  if (!update) {
    return "";
  }
  return translate(settings, `${keyPrefix}.memoryAudit.patternCandidate.${update.status}`, {
    key: update.key,
    axis: update.axis,
    summary: update.summary,
    canonicalSummary: update.canonicalSummary,
    evidenceQuote: update.evidenceQuote,
    evidenceCount: update.evidenceCount,
    minEvidence: update.minEvidence
  });
}

function hasInteractionDerivedChanges(result) {
  return [result?.updatedPatterns, result?.updatedTensions, result?.updatedStableImpressions]
    .some((items) => Array.isArray(items) && items.length > 0);
}

function formatDeepMemoryReason(item, source, settings, keyPrefix, translate) {
  if (item?.whyItMatters) {
    return item.whyItMatters;
  }
  if (isAiReflectionDeepMemory(item)) {
    return translate(settings, `${keyPrefix}.memoryAudit.reason.deepMemoryAiReflection`, { source });
  }
  return translate(settings, `${keyPrefix}.memoryAudit.reason.deepMemoryLocalRules`, {
    kind: item?.kind || "",
    importance: formatNumber(item?.importance),
    confidence: formatNumber(item?.confidence)
  });
}

function formatInteractionEpisodeReason(item, settings, keyPrefix, translate) {
  if (item?.repairPath) {
    return translate(settings, `${keyPrefix}.memoryAudit.reason.interactionRepairEpisode`, {
      context: item.context || "",
      phase: item.phase || "",
      role: item.memoryRole || "",
      weight: formatNumber(item.eventWeight)
    });
  }
  return translate(settings, `${keyPrefix}.memoryAudit.reason.interactionClosedEpisode`, {
    context: item?.context || "",
    phase: item?.phase || "",
    role: item?.memoryRole || "",
    weight: formatNumber(item?.eventWeight)
  });
}

function formatInteractionReaction(item, settings, keyPrefix, translate) {
  const code = item?.reaction?.outcomeHint || item?.outcomeHint || item?.reaction?.kind || "";
  if (!code) {
    return "";
  }
  const label = translate(settings, `${keyPrefix}.memoryAudit.reaction.${code}`);
  return label && label !== `${keyPrefix}.memoryAudit.reaction.${code}`
    ? `${code} — ${label}`
    : code;
}

function formatInteractionEpisodeEffect(item, affectedItems, settings, keyPrefix, translate) {
  if (!Array.isArray(affectedItems) || affectedItems.length === 0) {
    return translate(settings, `${keyPrefix}.memoryAudit.effect.interactionEpisodeOnly`, {
      role: item?.memoryRole || "short_term_episode"
    });
  }
  const labels = affectedItems.map((entry) => entry.type).filter(Boolean).join("、");
  return translate(settings, `${keyPrefix}.memoryAudit.effect.interactionDerivedChanged`, {
    count: affectedItems.length,
    items: labels
  });
}

function getInteractionChangesForEpisode(result, episode, settings, keyPrefix, translate) {
  const entries = []
    .concat((Array.isArray(result?.updatedPatterns) ? result.updatedPatterns : []).map((item) => ({
      item,
      type: item.generatedBy === "ai"
        ? translate(settings, `${keyPrefix}.interactionMemoryUpdated.aiPatternLabel`)
        : translate(settings, `${keyPrefix}.interactionMemoryUpdated.patternLabel`)
    })))
    .concat((Array.isArray(result?.updatedTensions) ? result.updatedTensions : []).map((item) => ({
      item,
      type: translate(settings, `${keyPrefix}.interactionMemoryUpdated.tensionLabel`)
    })))
    .concat((Array.isArray(result?.updatedStableImpressions) ? result.updatedStableImpressions : []).map((item) => ({
      item,
      type: item.generatedBy === "ai"
        ? translate(settings, `${keyPrefix}.interactionMemoryUpdated.aiImpressionLabel`)
        : translate(settings, `${keyPrefix}.interactionMemoryUpdated.impressionLabel`)
    })));
  return entries.filter((entry) => (
    Array.isArray(entry.item?.evidenceEpisodeIds)
    && entry.item.evidenceEpisodeIds.includes(episode?.id)
  ));
}

function formatInteractionChangeReason(entry, settings, keyPrefix, translate) {
  const evidenceCount = entry?.item?.evidenceCount || 0;
  const confidence = formatNumber(entry?.item?.confidence);
  const strength = formatNumber(entry?.item?.strength);
  if (entry?.source === translate(settings, `${keyPrefix}.memoryAudit.source.aiReflection`)) {
    return translate(settings, `${keyPrefix}.memoryAudit.reason.interactionAiImpression`, {
      type: entry.type || "",
      evidenceCount,
      confidence,
      strength
    });
  }
  return translate(settings, `${keyPrefix}.memoryAudit.reason.interactionEvidenceUpdate`, {
    type: entry?.type || "",
    evidenceCount,
    confidence,
    strength
  });
}

function formatAuditItemTitle(type, index) {
  const label = String(type || "").trim();
  const number = Number.isFinite(index) ? index + 1 : 1;
  return label ? `${label} ${number}` : `Item ${number}`;
}

function formatItemList(items, formatter) {
  const visible = items.slice(0, MAX_NOTICE_ITEMS)
    .map((item) => formatter(item))
    .filter(Boolean);
  const remaining = Math.max(0, items.length - visible.length);
  if (remaining > 0) {
    visible.push(`- ... +${remaining}`);
  }
  return visible.join("\n");
}

function formatInteractionEpisode(item) {
  const parts = [
    item.userExcerpt,
    item.reaction?.excerpt || item.outcomeHint
  ].map((part) => truncateNoticeText(part)).filter(Boolean);
  return parts.length > 1 ? `- ${parts[0]} -> ${parts[1]}` : `- ${parts[0] || item.context || item.phase}`;
}

function formatInteractionChange(settings, keyPrefix, translate, item) {
  const label = [
    item.type,
    item.evidenceCount ? translate(settings, `${keyPrefix}.interactionMemoryUpdated.evidenceLabel`, {
      count: item.evidenceCount
    }) : ""
  ].filter(Boolean).join(", ");
  const text = truncateNoticeText(item.text);
  return label ? `- [${label}] ${text}` : `- ${text}`;
}

function isAiReflectionDeepMemory(item) {
  return item?.kind === "visible_reflection"
    || (Array.isArray(item?.topics) && item.topics.includes("agent_dock_signal"));
}

function translateMemorySource(settings, keyPrefix, translate, source) {
  const normalized = String(source || "").trim();
  if (normalized === "user") {
    return translate(settings, `${keyPrefix}.memoryAudit.source.user`);
  }
  if (normalized === "ai") {
    return translate(settings, `${keyPrefix}.memoryAudit.source.aiReflection`);
  }
  return translate(settings, `${keyPrefix}.memoryAudit.source.localRules`);
}

function createField(label, value) {
  const text = String(value === undefined || value === null ? "" : value).replace(/\s+/g, " ").trim();
  if (!label || !text) {
    return null;
  }
  return {
    label,
    value: truncateAuditText(text)
  };
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "";
  }
  return number.toFixed(2).replace(/\.?0+$/, "");
}

function truncateNoticeText(text, maxChars = MAX_NOTICE_TEXT_CHARS) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, maxChars - 1)}...`;
}

function truncateAuditText(text) {
  return truncateNoticeText(text, MAX_AUDIT_TEXT_CHARS);
}

module.exports = {
  buildDeepMemoryAuditItems,
  buildInteractionMemoryAuditItems,
  buildMemoryUpdateAuditItems,
  formatDeepMemoryUpdateSummary,
  formatInteractionMemoryUpdateKind,
  formatInteractionMemoryUpdateSummary,
  formatInteractionMemoryUpdateTitle,
  formatMemoryUpdateSummary
};
