const MEMORY_SIGNAL_SCOPES = Object.freeze({
  decision: "project",
  task: "project",
  identity: "agent",
  shared: "shared"
});

const INTERACTION_SIGNAL_SHAPES = new Set([
  "implementation_plan",
  "mechanism_explanation",
  "independent_judgment",
  "repair_response",
  "restated_intent",
  "became_concrete",
  "became_shorter",
  "became_deeper",
  "softened_tone",
  "warm_presence"
]);

const AFFECT_SIGNAL_TONES = new Set([
  "serious",
  "reassuring",
  "celebratory",
  "playful",
  "confident",
  "patient",
  "restrained",
  "composed",
  "tense-focused",
  "warm-focused",
  "focused",
  "calm"
]);

const SALIENCE_SIGNAL_AXES = new Set([
  "beauty",
  "care",
  "justice",
  "curiosity",
  "craft",
  "achievement",
  "repair"
]);

module.exports = {
  AFFECT_SIGNAL_TONES,
  INTERACTION_SIGNAL_SHAPES,
  MEMORY_SIGNAL_SCOPES,
  SALIENCE_SIGNAL_AXES
};
