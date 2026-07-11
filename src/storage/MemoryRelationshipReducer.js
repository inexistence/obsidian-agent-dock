const {
  createEventInstanceKey,
  isGenericEventTopic,
  isTimelineEventTopic
} = require("./MemoryEventClassifier");
const { normalizeTemporal } = require("./MemoryReliability");

function applyMemoryRelationship(next, existingItems, now, tokenize) {
  const related = existingItems
    .filter((item) => item.status === "active" || item.status === "contested")
    .filter((item) => item.kind === next.kind && item.scope === next.scope)
    .map((item) => {
      const overlap = memoryTokenOverlap(item.text, next.text, tokenize);
      return {
        item,
        overlap,
        sameEvent: isSameEventInstance(item.event, next.event, overlap)
      };
    })
    .filter((entry) => entry.sameEvent || entry.overlap >= minimumRelationshipOverlap(next.event))
    .sort((left, right) => Number(right.sameEvent) - Number(left.sameEvent) || right.overlap - left.overlap);
  if (related.length === 0) {
    return;
  }

  const match = related[0];
  const previous = match.item;
  if (match.sameEvent && previous.event?.id) {
    next.event.id = previous.event.id;
    next.event.sequence = (Number(previous.event.sequence) || 1) + 1;
  }
  const stateTransition = match.sameEvent && isEventTransition(previous, next);
  const explicitCorrection = isExplicitCorrection(next.text) && !stateTransition;
  if (explicitCorrection || stateTransition) {
    previous.status = explicitCorrection ? "corrected" : "superseded";
    previous.updatedAt = now;
    next.supersedes = [previous.id];
    return;
  }

  if (match.overlap >= 3 && looksContradictory(previous.text, next.text)) {
    previous.status = "contested";
    previous.conflictIds = normalizeStringArray([...(previous.conflictIds || []), next.id]);
    previous.updatedAt = now;
    next.status = "contested";
    next.conflictIds = [previous.id];
  }
}

function minimumRelationshipOverlap(event) {
  return isGenericEventTopic(event?.topic) ? 3 : 2;
}

function isSameEventInstance(previous, next, overlap) {
  if (!previous?.topic || previous.topic !== next?.topic) {
    return false;
  }
  if (previous.id && next.id && previous.id === next.id) {
    return true;
  }
  if (isTimelineEventTopic(next.topic)) {
    return Boolean(previous.instanceKey && previous.instanceKey === next.instanceKey);
  }
  if (isGenericEventTopic(next.topic)) {
    return overlap >= 3;
  }
  return overlap >= 1;
}

function isEventTransition(previous, next) {
  return previous.event?.status !== next.event?.status;
}

function mergeEvent(existing, incoming, seed, normalizeMemoryEvent) {
  if (!incoming) {
    return normalizeMemoryEvent(existing, "fact", seed);
  }
  const left = normalizeMemoryEvent(existing, "fact", seed);
  const right = normalizeMemoryEvent(incoming, "fact", seed);
  return Object.assign({}, left || {}, right || {}, {
    id: left?.id || right?.id,
    sequence: Math.max(Number(left?.sequence) || 1, Number(right?.sequence) || 1)
  });
}

function mergeTemporal(existing, incoming, kind) {
  const left = normalizeTemporal(existing, kind);
  const right = normalizeTemporal(incoming, kind);
  return {
    class: right.class || left.class,
    validFrom: right.validFrom || left.validFrom,
    validUntil: right.validUntil || left.validUntil,
    containsRelativeTime: right.containsRelativeTime || left.containsRelativeTime
  };
}

function normalizeMemoryEvent(value, kind, seed, helpers) {
  if ((!value || typeof value !== "object") && kind !== "task") {
    return null;
  }
  const source = value && typeof value === "object" ? value : {};
  const topic = helpers.compactText(source.topic);
  if (!topic && kind !== "task") {
    return null;
  }
  const status = ["planned", "active", "completed", "cancelled", "observed"].includes(source.status)
    ? source.status
    : "observed";
  const occurredAt = helpers.normalizeTimestamp(source.occurredAt, 0);
  return {
    id: helpers.compactText(source.id) || helpers.createEventId(seed || topic || kind),
    topic: topic || "project_task",
    instanceKey: helpers.compactText(source.instanceKey)
      || createEventInstanceKey(topic || "project_task", occurredAt),
    status,
    sequence: Math.max(1, Number.parseInt(source.sequence, 10) || 1),
    occurredAt
  };
}

function memoryTokenOverlap(left, right, tokenize) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token) && token.length >= 2) {
      overlap += 1;
    }
  }
  return overlap;
}

function isExplicitCorrection(text) {
  return /(?:不是|改成|改为|不再|取消|之前说错了|纠正|应为|rather than|instead|no longer|correction)/i.test(String(text || ""));
}

function looksContradictory(left, right) {
  const correction = /(?:不再|取消|改为|改成|不是|不要|never|no longer|instead|rather than)/i;
  return correction.test(left) !== correction.test(right);
}

function normalizeStringArray(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean))].slice(0, 12);
}

module.exports = {
  applyMemoryRelationship,
  mergeEvent,
  mergeTemporal,
  normalizeMemoryEvent,
  _test: {
    isSameEventInstance,
    looksContradictory
  }
};
