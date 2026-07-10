const DEFAULT_HALF_LIFE_DAYS = 30;
const DEFAULT_MIN_EVIDENCE = 2;
const MAX_EPISODES = 160;
const MAX_PATTERNS = 60;
const MAX_STABLE_IMPRESSIONS = 16;

const { formatInteractionStancePrompt } = require("./InteractionPromptFormatter");
const { PATTERN_RULES, TENSION_RULES, STABLE_PERSONA_RULES } = require("./InteractionRules");

function applyEpisodes(profile, newEpisodes, settings, now = Date.now()) {
  const next = normalizeInteractionMemory(profile);
  const episodes = Array.isArray(newEpisodes)
    ? newEpisodes.map(normalizeEpisode).filter(Boolean)
    : [];

  next.episodes = limitEpisodes(next.episodes.concat(episodes));
  next.patterns = reducePatterns(next.episodes, settings, now);
  next.tensions = reduceTensions(next.episodes, settings, now);
  next.stableImpressions = reduceStableImpressions(next.patterns, next.tensions, next.stableImpressions, settings, now);
  next.updatedAt = now;
  return next;
}

function getPromptStance(profile, settings, promptContext = {}, now = Date.now()) {
  if (!settings.interactionMemoryEnabled) {
    return [];
  }
  const normalized = normalizeInteractionMemory(profile);
  const minEvidence = Number(settings.interactionMemoryMinEvidence) || DEFAULT_MIN_EVIDENCE;
  const maxItems = positiveIntegerOrDefault(settings.interactionMemoryMaxPromptItems, 6);
  const personaLimit = Math.max(0, Math.min(
    maxItems,
    nonNegativeIntegerOrDefault(settings.interactionMemoryMaxPersonaItems, Math.min(2, maxItems))
  ));
  const stanceLimit = Math.max(0, Math.min(
    maxItems,
    nonNegativeIntegerOrDefault(settings.interactionMemoryMaxStanceItems, Math.max(1, maxItems - personaLimit))
  ));
  const currentSignals = Array.isArray(promptContext.signals) ? promptContext.signals : [];
  const currentContext = promptContext.context || "general";
  const currentConversationText = compactText(promptContext.conversationText);
  const personaItems = normalized.stableImpressions
    .map((impression) => decayStableImpression(impression, settings, now))
    .filter((impression) => (
      impression.reviewStatus !== "dismissed"
      && impression.evidenceCount >= Math.max(3, minEvidence)
      && impression.confidence >= stableConfidenceThreshold(impression)
      && impression.strength >= stableStrengthThreshold(impression)
      && !isRedundantWithConversation(impression.text, currentConversationText)
    ))
    .map((impression) => ({
      kind: "stable_persona",
      axis: impression.axis,
      text: impression.text,
      confidence: impression.confidence,
      evidenceCount: impression.evidenceCount,
      reviewStatus: impression.reviewStatus,
      createdAt: impression.createdAt,
      updatedAt: impression.updatedAt,
      score: impression.strength + impression.confidence + Math.min(0.6, impression.evidenceCount * 0.09) + reviewStatusBoost(impression.reviewStatus) + 0.35
    }));

  const patternItems = normalized.patterns
    .map((pattern) => decayPattern(pattern, settings, now))
    .filter((pattern) => (
      pattern.evidenceCount >= minEvidence
      && pattern.confidence >= 0.42
      && pattern.strength >= 0.24
      && isTurnRelevant(pattern, currentSignals, currentContext)
      && !isRedundantWithConversation(pattern.summary, currentConversationText)
    ))
    .map((pattern) => ({
      kind: "pattern",
      axis: pattern.axis,
      text: pattern.summary,
      confidence: pattern.confidence,
      evidenceCount: pattern.evidenceCount,
      createdAt: pattern.createdAt,
      updatedAt: pattern.updatedAt,
      score: scorePattern(pattern, currentSignals, currentContext)
    }));

  const tensionItems = normalized.tensions
    .map((tension) => decayTension(tension, settings, now))
    .filter((tension) => (
      tension.evidenceCount >= minEvidence
      && tension.confidence >= 0.42
      && isTurnRelevant(tension, currentSignals, currentContext)
      && !isRedundantWithConversation(tension.resolutionStyle, currentConversationText)
    ))
    .map((tension) => ({
      kind: "tension",
      axis: "interaction_tension",
      text: tension.resolutionStyle,
      confidence: tension.confidence,
      evidenceCount: tension.evidenceCount,
      createdAt: tension.createdAt,
      updatedAt: tension.updatedAt,
      score: scoreTension(tension, currentSignals)
    }));

  const selectedPersona = personaItems
    .sort((left, right) => right.score - left.score)
    .slice(0, personaLimit);
  const selectedStance = patternItems.concat(tensionItems)
    .sort((left, right) => right.score - left.score)
    .slice(0, stanceLimit);
  const selected = selectedPersona.concat(selectedStance);
  if (selected.length > 0) {
    return selected.slice(0, Math.max(1, maxItems));
  }
  return [];
}

function reducePatterns(episodes, settings, now) {
  const previousByKey = new Map();
  const reduced = [];

  for (const rule of PATTERN_RULES) {
    const matching = episodes.filter((episode) => episodeMatchesRule(episode, rule));
    if (matching.length === 0) {
      continue;
    }
    const negativeMatching = episodes.filter((episode) => episodeMatchesNegativeRule(episode, rule));
    const latest = matching[matching.length - 1];
    const contexts = countBy(matching.map((episode) => episode.context));
    const evidenceCount = matching.length;
    const negativeEvidenceCount = negativeMatching.length;
    const weightedEvidence = matching.reduce((total, episode) => total + getEpisodeEvidenceWeight(episode, rule), 0);
    const netEvidence = Math.max(0, weightedEvidence - negativeEvidenceCount * 0.75);
    if (netEvidence <= 0) {
      continue;
    }
    const assistantEvidenceCount = matching.filter((episode) => assistantMatchesRule(episode, rule)).length;
    const outcomeEvidenceCount = matching.filter((episode) => outcomeMatchesRule(episode, rule)).length;
    const strength = clampUnit(0.24 + netEvidence * 0.14 + rule.weight * 0.18 + assistantEvidenceCount * 0.03 + outcomeEvidenceCount * 0.03);
    const confidence = clampUnit(0.3 + netEvidence * 0.12 + rule.weight * 0.16 + assistantEvidenceCount * 0.025 + outcomeEvidenceCount * 0.025);
    reduced.push({
      id: `pattern_${normalizeKeyText(rule.key)}`,
      key: rule.key,
      axis: rule.axis,
      summary: rule.summary,
      contexts,
      signals: rule.signals,
      assistantShapes: rule.assistantShapes || [],
      outcomeHints: rule.outcomeHints || [],
      phases: rule.phases || [],
      repairTriggers: rule.repairTriggers || [],
      repairAdjustments: rule.repairAdjustments || [],
      repairOutcomes: rule.repairOutcomes || [],
      negativeEvidenceCount,
      evidenceEpisodeIds: matching.map((episode) => episode.id),
      evidenceCount,
      strength,
      confidence,
      createdAt: matching[0].createdAt,
      updatedAt: latest.updatedAt || latest.createdAt || now
    });
  }

  return reduced
    .map((pattern) => {
      previousByKey.set(pattern.key, pattern);
      return decayPattern(pattern, settings, now);
    })
    .filter((pattern) => pattern.strength >= 0.08 && pattern.confidence >= 0.2)
    .sort(comparePromptItems)
    .slice(0, MAX_PATTERNS);
}

function reduceTensions(episodes, settings, now) {
  return TENSION_RULES.map((rule) => {
    const matching = episodes.filter((episode) => (
      !["topic_shift", "new_request"].includes(episode.outcomeHint)
      && ruleMatchesEpisode(rule, episode)
    ));
    if (matching.length === 0) {
      return null;
    }
    const latest = matching[matching.length - 1];
    return decayTension({
      id: `tension_${normalizeKeyText(rule.key)}`,
      key: rule.key,
      sideA: rule.sideA,
      sideB: rule.sideB,
      resolutionStyle: rule.resolutionStyle,
      signals: rule.signals,
      outcomeHints: rule.outcomeHints || [],
      evidenceEpisodeIds: matching.map((episode) => episode.id),
      evidenceCount: matching.length,
      confidence: clampUnit(0.32 + matching.length * 0.14),
      createdAt: matching[0].createdAt,
      updatedAt: latest.updatedAt || latest.createdAt || now
    }, settings, now);
  })
    .filter(Boolean)
    .filter((tension) => tension.confidence >= 0.2)
    .sort(comparePromptItems);
}

function reduceStableImpressions(patterns, tensions, previous, settings, now) {
  const sourceItems = patterns.concat(tensions.map((tension) => ({
    key: tension.key,
    evidenceCount: tension.evidenceCount,
    confidence: tension.confidence,
    strength: tension.confidence,
    evidenceEpisodeIds: tension.evidenceEpisodeIds,
    updatedAt: tension.updatedAt
  })));
  const byKey = new Map(sourceItems.map((item) => [item.key, item]));
  const previousByKey = new Map((Array.isArray(previous) ? previous : [])
    .map(normalizeStableImpression)
    .filter(Boolean)
    .map((item) => [item.key, item]));
  const stableMinEvidence = Math.max(3, Number(settings.interactionMemoryMinEvidence) || DEFAULT_MIN_EVIDENCE);

  return STABLE_PERSONA_RULES.map((rule) => {
    const matched = rule.patternKeys
      .map((key) => byKey.get(key))
      .filter(Boolean);
    const evidenceEpisodeIds = uniqueStrings(matched.flatMap((item) => item.evidenceEpisodeIds || []));
    const evidenceCount = evidenceEpisodeIds.length || matched.reduce((total, item) => total + item.evidenceCount, 0);
    if (matched.length === 0 || evidenceCount < stableMinEvidence) {
      return previousByKey.get(rule.key) || null;
    }
    const previousItem = previousByKey.get(rule.key);
    const confidence = clampUnit(0.36 + matched.reduce((total, item) => total + item.confidence, 0) / Math.max(1, matched.length) * 0.52);
    const strength = clampUnit(0.28 + evidenceCount * 0.08 + confidence * 0.22);
    const latest = matched.reduce((timestamp, item) => Math.max(timestamp, normalizeTimestamp(item.updatedAt, now)), 0);
    const sourcePatternKeys = matched.map((item) => item.key);
    const sourceHash = createSourceHash(rule.key, matched);
    return {
      id: previousItem?.id || `stable_${normalizeKeyText(rule.key)}`,
      key: rule.key,
      axis: rule.axis,
      text: rule.text,
      sourcePatternKeys,
      evidenceEpisodeIds,
      sourceHash,
      generatedBy: previousItem?.sourceHash === sourceHash ? previousItem.generatedBy : "local",
      reviewStatus: previousItem?.sourceHash === sourceHash ? previousItem.reviewStatus : "auto",
      evidenceCount,
      strength,
      confidence,
      createdAt: previousItem?.createdAt || now,
      updatedAt: latest || now
    };
  })
    .filter(Boolean)
    .map((item) => decayStableImpression(item, settings, now))
    .filter((item) => item.strength >= 0.12 && item.confidence >= 0.28)
    .sort(comparePromptItems)
    .slice(0, MAX_STABLE_IMPRESSIONS);
}

function episodeMatchesRule(episode, rule) {
  const ruleSignals = Array.isArray(rule.signals) ? rule.signals : [];
  const hasSignal = ruleSignals.some((signal) => episode.userSignals.includes(signal) || episode.reaction?.signals?.includes(signal));
  const hasOutcome = outcomeMatchesRule(episode, rule);
  const hasRepair = repairMatchesRule(episode, rule);
  const hasAssistant = assistantMatchesRule(episode, rule);
  const phaseCompatible = !Array.isArray(rule.phases) || rule.phases.length === 0 || rule.phases.includes(episode.phase);
  const inContext = !rule.contexts || rule.contexts.includes(episode.context);
  const usefulOutcome = isUsefulPositiveOutcome(episode.outcomeHint, rule);
  const enoughWeight = !Number.isFinite(Number(rule.minEventWeight)) || Number(episode.eventWeight) >= Number(rule.minEventWeight);
  const outcomeHasSpecificEvidence = hasOutcome && episode.outcomeHint !== "accepted";
  const acceptedHasSupportingEvidence = hasOutcome && episode.outcomeHint === "accepted" && (hasSignal || hasRepair || hasAssistant);
  return (
    (hasSignal || hasRepair || outcomeHasSpecificEvidence || acceptedHasSupportingEvidence)
    && phaseCompatible
    && inContext
    && usefulOutcome
    && enoughWeight
  );
}

function ruleMatchesEpisode(rule, episode) {
  const signals = Array.isArray(rule.signals) ? rule.signals : [];
  const signalMatch = signals.every((signal) => episode.userSignals.includes(signal) || episode.reaction?.signals?.includes(signal));
  return signalMatch || repairMatchesRule(episode, rule);
}

function repairMatchesRule(episode, rule) {
  const repairPath = episode.repairPath;
  if (!repairPath) {
    return false;
  }
  const triggers = Array.isArray(rule.repairTriggers) ? rule.repairTriggers : [];
  const adjustments = Array.isArray(rule.repairAdjustments) ? rule.repairAdjustments : [];
  const outcomes = Array.isArray(rule.repairOutcomes) ? rule.repairOutcomes : [];
  return (
    (triggers.length === 0 || triggers.includes(repairPath.trigger))
    && (adjustments.length === 0 || adjustments.includes(repairPath.assistantAdjustment))
    && (outcomes.length === 0 || outcomes.includes(repairPath.outcome))
    && (triggers.length > 0 || adjustments.length > 0 || outcomes.length > 0)
  );
}

function getEpisodeEvidenceWeight(episode, rule) {
  let weight = Math.max(0.2, Number(episode.eventWeight) || 0.2);
  if (episode.userSignals?.length > 0 || episode.assistantShape?.length > 0 || episode.reaction?.signals?.length > 0) {
    weight = Math.max(weight, 0.55);
  }
  if (repairMatchesRule(episode, rule)) {
    weight += 0.35;
  }
  if (episode.memoryRole === "pattern_evidence") {
    weight += 0.12;
  }
  if (episode.repairPath?.outcome === "accepted") {
    weight += 0.12;
  }
  if (episode.repairPath?.outcome === "continued_correction") {
    weight -= 0.08;
  }
  return Math.max(0.1, weight);
}

function isUsefulPositiveOutcome(outcomeHint, rule) {
  if (!outcomeHint) {
    return true;
  }
  if (["topic_shift", "new_request"].includes(outcomeHint)) {
    return false;
  }
  if (["correction", "style_recalibration"].includes(outcomeHint)) {
    return Array.isArray(rule.outcomeHints) && rule.outcomeHints.includes(outcomeHint);
  }
  return true;
}

function episodeMatchesNegativeRule(episode, rule) {
  const negativeSignals = Array.isArray(rule.negativeSignals) ? rule.negativeSignals : [];
  const negativeAssistantShapes = Array.isArray(rule.negativeAssistantShapes) ? rule.negativeAssistantShapes : [];
  const negativeOutcomeHints = Array.isArray(rule.negativeOutcomeHints) ? rule.negativeOutcomeHints : ["style_recalibration", "correction"];
  return negativeSignals.some((signal) => episode.userSignals.includes(signal) || episode.reaction?.signals?.includes(signal))
    || negativeAssistantShapes.some((shape) => episode.assistantShape.includes(shape))
    || negativeOutcomeHints.some((hint) => episode.outcomeHint === hint);
}

function assistantMatchesRule(episode, rule) {
  return Array.isArray(rule.assistantShapes)
    && rule.assistantShapes.some((shape) => episode.assistantShape.includes(shape));
}

function outcomeMatchesRule(episode, rule) {
  return Array.isArray(rule.outcomeHints)
    && rule.outcomeHints.includes(episode.outcomeHint);
}

function isTurnRelevant(item, currentSignals, currentContext) {
  if (item.contexts?.[currentContext]) {
    return true;
  }
  if (item.signals?.some((signal) => currentSignals.includes(signal))) {
    return true;
  }
  if (item.outcomeHints?.some((hint) => currentSignals.includes(hint))) {
    return true;
  }
  return false;
}

function stableConfidenceThreshold(impression) {
  return impression.reviewStatus === "candidate" ? 0.62 : 0.5;
}

function stableStrengthThreshold(impression) {
  return impression.reviewStatus === "candidate" ? 0.4 : 0.28;
}

function reviewStatusBoost(status) {
  if (status === "confirmed") {
    return 0.35;
  }
  if (status === "candidate") {
    return -0.12;
  }
  return 0;
}

function scorePattern(pattern, currentSignals, currentContext) {
  let score = pattern.strength + pattern.confidence + Math.min(0.5, pattern.evidenceCount * 0.08);
  if (pattern.contexts?.[currentContext]) {
    score += 0.35;
  }
  if (pattern.signals?.some((signal) => currentSignals.includes(signal))) {
    score += 0.45;
  }
  return score;
}

function scoreTension(tension, currentSignals) {
  let score = tension.confidence + Math.min(0.5, tension.evidenceCount * 0.08);
  if (tension.signals?.some((signal) => currentSignals.includes(signal))) {
    score += 0.2;
  }
  return score;
}

function decayPattern(pattern, settings, now) {
  const factor = getDecayFactor(pattern.updatedAt, settings, now);
  return Object.assign({}, pattern, {
    strength: clampUnit(Number(pattern.strength) * factor),
    confidence: clampUnit(Number(pattern.confidence) * Math.max(0.65, factor))
  });
}

function decayTension(tension, settings, now) {
  const factor = getDecayFactor(tension.updatedAt, settings, now);
  return Object.assign({}, tension, {
    confidence: clampUnit(Number(tension.confidence) * Math.max(0.65, factor))
  });
}

function decayStableImpression(impression, settings, now) {
  const factor = getDecayFactor(impression.updatedAt, Object.assign({}, settings, {
    interactionMemoryHalfLifeDays: (Number(settings.interactionMemoryHalfLifeDays) || DEFAULT_HALF_LIFE_DAYS) * 4
  }), now);
  return Object.assign({}, impression, {
    strength: clampUnit(Number(impression.strength) * factor),
    confidence: clampUnit(Number(impression.confidence) * Math.max(0.78, factor))
  });
}

function getDecayFactor(updatedAt, settings, now) {
  const halfLifeDays = Number(settings.interactionMemoryHalfLifeDays) || DEFAULT_HALF_LIFE_DAYS;
  const ageDays = Math.max(0, (now - normalizeTimestamp(updatedAt, now)) / 86400000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function normalizeInteractionMemory(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    version: 1,
    pendingEpisodes: Array.isArray(source.pendingEpisodes) ? source.pendingEpisodes.map(normalizeEpisode).filter(Boolean) : [],
    episodes: Array.isArray(source.episodes) ? source.episodes.map(normalizeEpisode).filter(Boolean) : [],
    patterns: Array.isArray(source.patterns) ? source.patterns.map(normalizePattern).filter(Boolean) : [],
    tensions: Array.isArray(source.tensions) ? source.tensions.map(normalizeTension).filter(Boolean) : [],
    stableImpressions: Array.isArray(source.stableImpressions) ? source.stableImpressions.map(normalizeStableImpression).filter(Boolean) : [],
    updatedAt: normalizeTimestamp(source.updatedAt, Date.now())
  };
}

function normalizeEpisode(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const id = compactText(item.id) || createInteractionId("episode");
  return {
    id,
    status: item.status === "pending" ? "pending" : "closed",
    context: compactText(item.context) || "general",
    phase: normalizePhase(item.phase),
    userExcerpt: compactText(item.userExcerpt),
    assistantExcerpt: compactText(item.assistantExcerpt),
    userSignals: normalizeStringArray(item.userSignals),
    assistantShape: normalizeStringArray(item.assistantShape),
    repairPath: normalizeRepairPath(item.repairPath),
    eventWeight: clampUnit(Number.isFinite(Number(item.eventWeight)) ? Number(item.eventWeight) : 0.2),
    memoryRole: normalizeMemoryRole(item.memoryRole),
    reaction: normalizeReaction(item.reaction),
    outcomeHint: compactText(item.outcomeHint),
    sourceSessionId: compactText(item.sourceSessionId),
    createdAt: normalizeTimestamp(item.createdAt, Date.now()),
    updatedAt: normalizeTimestamp(item.updatedAt, item.createdAt || Date.now())
  };
}

function normalizePhase(value) {
  const phase = compactText(value);
  return ["concept", "implementation", "repair", "validation", "general"].includes(phase) ? phase : "general";
}

function normalizeRepairPath(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const trigger = compactText(item.trigger);
  const assistantAdjustment = compactText(item.assistantAdjustment);
  const outcome = compactText(item.outcome);
  return {
    trigger: ["misread", "too_flat", "too_verbose", "wrong_direction", "style_mismatch", "unclear"].includes(trigger) ? trigger : "wrong_direction",
    assistantAdjustment: ["restated_intent", "changed_level", "became_concrete", "became_shorter", "became_deeper", "softened_tone"].includes(assistantAdjustment) ? assistantAdjustment : "changed_level",
    outcome: ["accepted", "continued_correction", "clarification_requested", "unresolved"].includes(outcome) ? outcome : "unresolved"
  };
}

function normalizeMemoryRole(value) {
  const role = compactText(value);
  return ["short_term_episode", "pattern_evidence", "deep_candidate"].includes(role) ? role : "short_term_episode";
}

function normalizeReaction(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  return {
    kind: compactText(item.kind),
    outcomeHint: compactText(item.outcomeHint),
    excerpt: compactText(item.excerpt),
    signals: normalizeStringArray(item.signals)
  };
}

function normalizePattern(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const key = compactText(item.key);
  const summary = compactText(item.summary);
  if (!key || !summary) {
    return null;
  }
  return {
    id: compactText(item.id) || `pattern_${normalizeKeyText(key)}`,
    key,
    axis: compactText(item.axis) || "collaboration_texture",
    summary,
    contexts: item.contexts && typeof item.contexts === "object" ? item.contexts : {},
    signals: normalizeStringArray(item.signals),
    assistantShapes: normalizeStringArray(item.assistantShapes),
    outcomeHints: normalizeStringArray(item.outcomeHints),
    phases: normalizeStringArray(item.phases),
    repairTriggers: normalizeStringArray(item.repairTriggers),
    repairAdjustments: normalizeStringArray(item.repairAdjustments),
    repairOutcomes: normalizeStringArray(item.repairOutcomes),
    negativeEvidenceCount: Math.max(0, Number.parseInt(item.negativeEvidenceCount, 10) || 0),
    evidenceEpisodeIds: normalizeStringArray(item.evidenceEpisodeIds),
    evidenceCount: Math.max(0, Number.parseInt(item.evidenceCount, 10) || 0),
    strength: clampUnit(Number(item.strength) || 0),
    confidence: clampUnit(Number(item.confidence) || 0),
    createdAt: normalizeTimestamp(item.createdAt, Date.now()),
    updatedAt: normalizeTimestamp(item.updatedAt, Date.now())
  };
}

function normalizeTension(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const key = compactText(item.key);
  const resolutionStyle = compactText(item.resolutionStyle);
  if (!key || !resolutionStyle) {
    return null;
  }
  return {
    id: compactText(item.id) || `tension_${normalizeKeyText(key)}`,
    key,
    sideA: compactText(item.sideA),
    sideB: compactText(item.sideB),
    resolutionStyle,
    signals: normalizeStringArray(item.signals),
    outcomeHints: normalizeStringArray(item.outcomeHints),
    evidenceEpisodeIds: normalizeStringArray(item.evidenceEpisodeIds),
    evidenceCount: Math.max(0, Number.parseInt(item.evidenceCount, 10) || 0),
    confidence: clampUnit(Number(item.confidence) || 0),
    createdAt: normalizeTimestamp(item.createdAt, Date.now()),
    updatedAt: normalizeTimestamp(item.updatedAt, Date.now())
  };
}

function normalizeStableImpression(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const key = compactText(item.key);
  const text = compactText(item.text);
  if (!key || !text) {
    return null;
  }
  return {
    id: compactText(item.id) || `stable_${normalizeKeyText(key)}`,
    key,
    axis: compactText(item.axis) || "long_term_persona",
    text,
    sourcePatternKeys: normalizeStringArray(item.sourcePatternKeys),
    evidenceEpisodeIds: normalizeStringArray(item.evidenceEpisodeIds),
    sourceHash: compactText(item.sourceHash),
    generatedBy: normalizeGeneratedBy(item.generatedBy),
    reviewStatus: normalizeReviewStatus(item.reviewStatus),
    evidenceCount: Math.max(0, Number.parseInt(item.evidenceCount, 10) || 0),
    strength: clampUnit(Number(item.strength) || 0),
    confidence: clampUnit(Number(item.confidence) || 0),
    createdAt: normalizeTimestamp(item.createdAt, Date.now()),
    updatedAt: normalizeTimestamp(item.updatedAt, Date.now())
  };
}

function createSourceHash(ruleKey, matched) {
  return [ruleKey]
    .concat(matched.map((item) => [
      item.key,
      item.evidenceCount,
      Math.round((Number(item.confidence) || 0) * 1000),
      normalizeTimestamp(item.updatedAt, 0)
    ].join(":")))
    .join("|");
}

function normalizeGeneratedBy(value) {
  return ["local", "ai", "user"].includes(value) ? value : "local";
}

function normalizeReviewStatus(value) {
  return ["auto", "candidate", "confirmed", "dismissed"].includes(value) ? value : "auto";
}

function limitEpisodes(episodes) {
  return episodes
    .map(normalizeEpisode)
    .filter(Boolean)
    .sort((left, right) => normalizeTimestamp(right.createdAt, 0) - normalizeTimestamp(left.createdAt, 0))
    .slice(0, MAX_EPISODES)
    .sort((left, right) => normalizeTimestamp(left.createdAt, 0) - normalizeTimestamp(right.createdAt, 0));
}

function comparePromptItems(left, right) {
  const leftScore = (left.strength || 0) + left.confidence + Math.min(0.5, left.evidenceCount * 0.08);
  const rightScore = (right.strength || 0) + right.confidence + Math.min(0.5, right.evidenceCount * 0.08);
  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }
  return normalizeTimestamp(right.updatedAt, 0) - normalizeTimestamp(left.updatedAt, 0);
}

function isRedundantWithConversation(text, conversationText) {
  if (!conversationText) {
    return false;
  }
  const keyTerms = compactText(text)
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .filter((term) => term.length >= 4)
    .slice(0, 8);
  if (keyTerms.length < 4) {
    return false;
  }
  const matches = keyTerms.filter((term) => conversationText.toLowerCase().includes(term)).length;
  return matches >= Math.min(5, keyTerms.length);
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    const key = compactText(value) || "general";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function normalizeStringArray(values) {
  return Array.isArray(values)
    ? values.map(compactText).filter(Boolean)
    : [];
}

function uniqueStrings(values) {
  return [...new Set(normalizeStringArray(values))];
}

function normalizeTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function positiveIntegerOrDefault(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeIntegerOrDefault(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeKeyText(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || Math.random().toString(36).slice(2);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampUnit(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function createInteractionId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  applyEpisodes,
  getPromptStance,
  formatInteractionStancePrompt,
  normalizeInteractionMemory,
  normalizeEpisode,
  scoreTension,
  PATTERN_RULES,
  TENSION_RULES,
  STABLE_PERSONA_RULES
};
