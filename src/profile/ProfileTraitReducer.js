const PROFILE_AXES = new Set([
  "collaboration_style",
  "communication_pacing",
  "attention_pattern",
  "decision_style",
  "relational_tone"
]);

const DEFAULT_PROFILE_HALF_LIFE_DAYS = 30;
const DEFAULT_MIN_EVIDENCE = 2;
const MAX_TRAITS = 60;
const MAX_OBSERVATIONS = 120;

function applyProfileObservations(profile, observations, settings, now = Date.now()) {
  const next = normalizeProfile(profile);
  const durable = observations
    .map(normalizeObservation)
    .filter((observation) => observation && shouldPersistObservation(observation));

  if (durable.length === 0) {
    next.observations = limitObservations(next.observations, now);
    next.traits = decayTraits(next.traits, settings, now);
    next.updatedAt = now;
    return {
      profile: next,
      observations: [],
      traits: []
    };
  }

  next.observations = limitObservations(next.observations.concat(durable), now);
  next.traits = decayTraits(next.traits, settings, now);

  const changedTraits = [];
  for (const observation of durable) {
    const key = createTraitKey(observation);
    let trait = next.traits.find((candidate) => candidate.key === key);
    if (!trait) {
      trait = createTraitFromObservation(observation, key, now);
      next.traits.push(trait);
    } else {
      updateTraitFromObservation(trait, observation, now);
    }
    changedTraits.push(trait);
  }

  next.traits = limitTraits(next.traits);
  next.updatedAt = now;
  return {
    profile: next,
    observations: durable,
    traits: changedTraits
  };
}

function getPromptTraits(profile, settings, now = Date.now()) {
  const normalized = normalizeProfile(profile);
  const minEvidence = Number(settings?.agentProfileMinEvidence) || DEFAULT_MIN_EVIDENCE;
  const maxTraits = Number(settings?.agentProfileMaxPromptTraits) || 6;

  return decayTraits(normalized.traits, settings, now)
    .filter((trait) => (
      trait.evidenceCount >= minEvidence
      && trait.confidence >= 0.45
      && trait.strength >= 0.28
    ))
    .sort(comparePromptTraits)
    .slice(0, Math.max(1, maxTraits));
}

function formatProfileTraitLine(trait) {
  const confidence = trait.confidence >= 0.72 ? "high" : trait.confidence >= 0.5 ? "medium" : "low";
  const context = trait.context && trait.context !== "general" ? `, context ${trait.context}` : "";
  return `- [${trait.axis}, confidence ${confidence}${context}] ${trait.text}`;
}

function shouldPersistObservation(observation) {
  if (observation.durable === false) {
    return false;
  }
  if (observation.kind === "hostility" || observation.kind === "thanks") {
    return false;
  }
  if (!observation.behavior || observation.confidence < 0.45) {
    return false;
  }
  return true;
}

function createTraitFromObservation(observation, key, now) {
  return {
    id: createProfileId("trait"),
    key,
    axis: observation.axis,
    context: observation.context || "general",
    text: traitTextFromObservation(observation),
    strength: clampUnit(0.35 + Math.abs(observation.signal) * 0.18),
    polarity: observation.signal < 0 ? "avoid" : "prefer",
    confidence: clampUnit(observation.confidence * 0.72),
    evidenceCount: 1,
    positiveSignals: observation.signal > 0 ? 1 : 0,
    negativeSignals: observation.signal < 0 ? 1 : 0,
    sourceSessionIds: observation.sourceSessionId ? [observation.sourceSessionId] : [],
    createdAt: now,
    updatedAt: now
  };
}

function updateTraitFromObservation(trait, observation, now) {
  const delta = Math.abs(observation.signal) * 0.16;
  trait.strength = clampUnit(Number(trait.strength) + delta);
  trait.polarity = observation.signal < 0 ? "avoid" : "prefer";
  trait.confidence = combineConfidence(trait.confidence, observation.confidence, trait.evidenceCount);
  trait.evidenceCount += 1;
  if (observation.signal > 0) {
    trait.positiveSignals += 1;
  }
  if (observation.signal < 0) {
    trait.negativeSignals += 1;
  }
  if (observation.sourceSessionId && !trait.sourceSessionIds.includes(observation.sourceSessionId)) {
    trait.sourceSessionIds.push(observation.sourceSessionId);
  }
  trait.text = traitTextFromObservation(observation);
  trait.updatedAt = now;
}

function traitTextFromObservation(observation) {
  if (observation.signal < 0) {
    return `In ${formatContext(observation.context)} conversations, the assistant should avoid or revise when ${observation.behavior}.`;
  }
  return `In ${formatContext(observation.context)} conversations, the assistant tends to be more useful when ${observation.behavior}.`;
}

function createTraitKey(observation) {
  return [
    observation.axis,
    observation.context || "general",
    normalizeKeyText(observation.behavior)
  ].join(":");
}

function decayTraits(traits, settings, now) {
  const halfLifeDays = Number(settings?.agentProfileHalfLifeDays) || DEFAULT_PROFILE_HALF_LIFE_DAYS;
  return traits
    .map((trait) => {
      const ageDays = Math.max(0, (now - normalizeTimestamp(trait.updatedAt, now)) / 86400000);
      const strengthFactor = Math.pow(0.5, ageDays / halfLifeDays);
      return Object.assign({}, trait, {
        strength: clampUnit(Number(trait.strength) * strengthFactor),
        confidence: clampUnit(Number(trait.confidence) * Math.max(0.65, strengthFactor))
      });
    })
    .filter((trait) => trait.strength >= 0.08 && trait.confidence >= 0.2);
}

function comparePromptTraits(left, right) {
  const leftScore = left.strength + left.confidence + Math.min(0.5, left.evidenceCount * 0.08);
  const rightScore = right.strength + right.confidence + Math.min(0.5, right.evidenceCount * 0.08);
  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }
  return normalizeTimestamp(right.updatedAt, 0) - normalizeTimestamp(left.updatedAt, 0);
}

function limitTraits(traits) {
  return [...traits]
    .sort(comparePromptTraits)
    .slice(0, MAX_TRAITS)
    .sort((left, right) => normalizeTimestamp(left.createdAt, 0) - normalizeTimestamp(right.createdAt, 0));
}

function limitObservations(observations, now) {
  return observations
    .map(normalizeObservation)
    .filter(Boolean)
    .sort((left, right) => normalizeTimestamp(right.createdAt, now) - normalizeTimestamp(left.createdAt, now))
    .slice(0, MAX_OBSERVATIONS)
    .sort((left, right) => normalizeTimestamp(left.createdAt, now) - normalizeTimestamp(right.createdAt, now));
}

function normalizeProfile(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    version: 1,
    traits: Array.isArray(source.traits) ? source.traits.map(normalizeTrait).filter(Boolean) : [],
    observations: Array.isArray(source.observations) ? source.observations.map(normalizeObservation).filter(Boolean) : [],
    updatedAt: normalizeTimestamp(source.updatedAt, Date.now())
  };
}

function normalizeTrait(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const axis = PROFILE_AXES.has(item.axis) ? item.axis : "";
  const text = compactText(item.text);
  if (!axis || !text) {
    return null;
  }
  return {
    id: typeof item.id === "string" && item.id ? item.id : createProfileId("trait"),
    key: typeof item.key === "string" && item.key ? item.key : [axis, item.context || "general", normalizeKeyText(text)].join(":"),
    axis,
    context: compactText(item.context) || "general",
    text,
    strength: clampUnit(Number(item.strength) || 0),
    polarity: item.polarity === "avoid" ? "avoid" : "prefer",
    confidence: clampUnit(Number(item.confidence) || 0),
    evidenceCount: Math.max(0, Number.parseInt(item.evidenceCount, 10) || 0),
    positiveSignals: Math.max(0, Number.parseInt(item.positiveSignals, 10) || 0),
    negativeSignals: Math.max(0, Number.parseInt(item.negativeSignals, 10) || 0),
    sourceSessionIds: Array.isArray(item.sourceSessionIds) ? item.sourceSessionIds.filter((value) => typeof value === "string") : [],
    createdAt: normalizeTimestamp(item.createdAt, Date.now()),
    updatedAt: normalizeTimestamp(item.updatedAt, Date.now())
  };
}

function normalizeObservation(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const axis = PROFILE_AXES.has(item.axis) ? item.axis : "";
  const behavior = compactText(item.behavior);
  if (!axis || !behavior) {
    return null;
  }
  return {
    id: typeof item.id === "string" && item.id ? item.id : createProfileId("obs"),
    kind: compactText(item.kind) || "observation",
    axis,
    context: compactText(item.context) || "general",
    behavior,
    signal: clamp(Number(item.signal) || 0, -1, 1),
    confidence: clampUnit(Number(item.confidence) || 0),
    evidenceText: compactText(item.evidenceText),
    sourceSessionId: typeof item.sourceSessionId === "string" ? item.sourceSessionId : "",
    durable: item.durable !== false,
    createdAt: normalizeTimestamp(item.createdAt, Date.now())
  };
}

function combineConfidence(current, incoming, evidenceCount) {
  const currentWeight = Math.max(1, evidenceCount);
  return clampUnit((Number(current) * currentWeight + Number(incoming)) / (currentWeight + 1) + 0.04);
}

function formatContext(context) {
  return context && context !== "general" ? context.replace(/_/g, " ") : "similar";
}

function normalizeKeyText(text) {
  return compactText(text).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").slice(0, 80);
}

function createProfileId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTimestamp(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampUnit(value) {
  return clamp(value, 0, 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = {
  applyProfileObservations,
  formatProfileTraitLine,
  getPromptTraits,
  normalizeProfile,
  shouldPersistObservation,
  _test: {
    createTraitKey,
    decayTraits,
    normalizeObservation
  }
};
