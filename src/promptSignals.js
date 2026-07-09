const MIN_INTERACTION_CONFIDENCE = 0.45;
const MAX_SOFT_MEMORY_DUPLICATE_DISTANCE = 0.82;
const MIN_SUBSTRING_DUPLICATE_LENGTH_RATIO = 0.72;

function planPromptSignals(signals = {}) {
  const memorySearchResults = normalizeArray(signals.memorySearchResults);
  const inputMemories = normalizeArray(signals.memories);
  const inputInteractionStance = normalizeArray(signals.interactionStance);
  const memories = selectPromptMemories(
    inputMemories,
    memorySearchResults
  );
  const interactionStance = selectInteractionStance(inputInteractionStance);
  const workingAffect = selectWorkingAffect(signals.workingAffect);
  return {
    memories,
    memorySearchResults,
    memorySearchPerformed: signals.memorySearchPerformed === true,
    interactionStance,
    workingAffect,
    metadata: {
      removedMemoryCount: Math.max(0, inputMemories.length - memories.length),
      removedInteractionStanceCount: Math.max(0, inputInteractionStance.length - interactionStance.length),
      affectIncluded: Boolean(workingAffect)
    }
  };
}

function selectPromptMemories(memories, explicitResults) {
  const explicitIdentities = new Set(explicitResults.map(getMemoryIdentity).filter(Boolean));
  const explicitTexts = explicitResults.map((memory) => normalizeComparableText(memory?.text)).filter(Boolean);
  const seen = new Set();
  const selected = [];

  for (const memory of memories) {
    const identity = getMemoryIdentity(memory);
    if (identity && explicitIdentities.has(identity)) {
      continue;
    }

    const comparableText = normalizeComparableText(memory?.text);
    if (comparableText && explicitTexts.some((text) => areSimilarTexts(comparableText, text))) {
      continue;
    }

    const dedupeKey = identity || comparableText;
    if (dedupeKey && seen.has(dedupeKey)) {
      continue;
    }

    if (dedupeKey) {
      seen.add(dedupeKey);
    }
    selected.push(memory);
  }

  return selected;
}

function selectInteractionStance(items) {
  const seen = new Set();
  return items
    .filter((item) => Number(item?.confidence) >= MIN_INTERACTION_CONFIDENCE)
    .filter((item) => {
      const key = [
        item.kind || "",
        item.axis || "",
        normalizeComparableText(item.text)
      ].join(":");
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function selectWorkingAffect(affect) {
  if (!affect) {
    return null;
  }
  if (affect.transient && affect.label === "steady") {
    return null;
  }
  return affect;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function getMemoryIdentity(memory) {
  return memory?.key || memory?.id || "";
}

function normalizeComparableText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function areSimilarTexts(left, right) {
  left = normalizeComparableText(left);
  right = normalizeComparableText(right);
  if (!left || !right) {
    return false;
  }
  if (left === right || areNearLengthSubstrings(left, right)) {
    return true;
  }
  return jaccardSimilarity(left, right) >= MAX_SOFT_MEMORY_DUPLICATE_DISTANCE;
}

function areNearLengthSubstrings(left, right) {
  if (!left.includes(right) && !right.includes(left)) {
    return false;
  }
  return Math.min(left.length, right.length) / Math.max(left.length, right.length) >= MIN_SUBSTRING_DUPLICATE_LENGTH_RATIO;
}

function jaccardSimilarity(left, right) {
  const leftTerms = new Set(left.split(/\s+/).filter(Boolean));
  const rightTerms = new Set(right.split(/\s+/).filter(Boolean));
  if (leftTerms.size === 0 || rightTerms.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      intersection += 1;
    }
  }
  return intersection / Math.max(1, leftTerms.size + rightTerms.size - intersection);
}

module.exports = {
  planPromptSignals,
  _test: {
    areSimilarTexts,
    areNearLengthSubstrings,
    selectInteractionStance,
    selectPromptMemories,
    selectWorkingAffect
  }
};
