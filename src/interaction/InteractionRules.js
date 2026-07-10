const PATTERN_RULES = [
  {
    key: "judgment_with_inspectable_reasoning",
    axis: "decision_style",
    summary: "The user often values independent judgment when it remains inspectable through mechanisms, tradeoffs, or concrete reasoning.",
    signals: ["asks_for_judgment", "asks_for_mechanism"],
    assistantShapes: ["independent_judgment", "mechanism_explanation"],
    contexts: ["agent_continuity", "implementation", "planning"],
    weight: 0.72
  },
  {
    key: "nuance_over_rigid_profile_rules",
    axis: "collaboration_texture",
    summary: "The user often resists reducing subtle interaction or profile design into rigid prompt requirements or preference rules.",
    signals: ["pushes_for_nuance", "rejects_flattening"],
    assistantShapes: ["mechanism_explanation"],
    negativeAssistantShapes: ["settings_framing"],
    contexts: ["agent_continuity", "implementation"],
    weight: 0.78
  },
  {
    key: "mechanism_before_settings",
    axis: "attention_pattern",
    summary: "The user tends to find mechanism-level explanations more useful than settings-only framing when discussing agent behavior.",
    signals: ["asks_for_mechanism", "rejects_flattening"],
    assistantShapes: ["mechanism_explanation"],
    negativeAssistantShapes: ["settings_framing"],
    contexts: ["agent_continuity", "implementation"],
    weight: 0.68
  },
  {
    key: "concrete_design_after_concept",
    axis: "decision_style",
    summary: "The user often wants conceptual design to eventually become concrete architecture, tasks, or implementation boundaries.",
    signals: ["asks_for_implementation", "asks_for_redesign"],
    assistantShapes: ["implementation_plan"],
    outcomeHints: ["implementation_followup", "productive_deepening", "accepted"],
    contexts: ["agent_continuity", "implementation", "planning"],
    weight: 0.66
  },
  {
    key: "token_cost_as_design_constraint",
    axis: "attention_pattern",
    summary: "Token cost is a meaningful design constraint; expensive summarization should be optional, bounded, cached, or low-frequency.",
    signals: ["asks_about_cost"],
    contexts: ["agent_continuity", "implementation", "general"],
    weight: 0.6
  },
  {
    key: "direct_but_not_flat",
    axis: "communication_pacing",
    summary: "Directness is useful, but over-compression can erase distinctions the user is trying to preserve.",
    signals: ["asks_for_directness", "pushes_for_nuance"],
    negativeSignals: ["asks_for_clarification"],
    contexts: ["agent_continuity", "implementation", "general"],
    weight: 0.64
  },
  {
    key: "depth_when_conceptual",
    axis: "communication_pacing",
    summary: "When the topic is conceptual or architectural, the user often values depth and careful unpacking over short generic answers.",
    signals: ["asks_for_depth", "asks_for_mechanism"],
    negativeSignals: ["asks_for_directness"],
    outcomeHints: ["productive_deepening", "clarification_requested"],
    contexts: ["agent_continuity", "implementation", "general"],
    weight: 0.58
  },
  {
    key: "action_after_alignment",
    axis: "collaboration_style",
    summary: "Once the conceptual direction is clear, the user tends to value concrete action without repeatedly re-litigating the premise.",
    signals: ["positive_feedback", "asks_for_implementation"],
    assistantShapes: ["implementation_plan"],
    outcomeHints: ["accepted", "implementation_followup"],
    contexts: ["implementation", "planning", "agent_continuity"],
    weight: 0.56
  },
  {
    key: "correction_calibrates_style",
    axis: "collaboration_style",
    summary: "When the user corrects direction, the assistant should treat it as calibration and revise the collaboration style without defensiveness.",
    signals: ["negative_feedback"],
    assistantShapes: ["repair_response"],
    outcomeHints: ["correction", "style_recalibration"],
    contexts: ["general", "implementation", "agent_continuity", "planning"],
    weight: 0.62
  },
  {
    key: "clarify_when_abstraction_stalls",
    axis: "communication_pacing",
    summary: "When abstraction starts to stall, the user benefits from clarification through examples, concrete contrasts, or simpler restatement.",
    signals: ["asks_for_clarification"],
    assistantShapes: ["mechanism_explanation"],
    outcomeHints: ["clarification_requested"],
    contexts: ["general", "implementation", "agent_continuity", "planning"],
    weight: 0.54
  },
  {
    key: "style_feedback_should_recalibrate",
    axis: "collaboration_style",
    summary: "Style criticism should recalibrate pacing and expression directly instead of becoming defensive or over-apologetic.",
    signals: ["style_feedback", "negative_feedback"],
    assistantShapes: ["repair_response"],
    outcomeHints: ["style_recalibration", "correction"],
    contexts: ["general", "implementation", "agent_continuity", "planning"],
    weight: 0.58
  },
  {
    key: "repair_by_restating_intent",
    axis: "repair_style",
    summary: "When corrected, first restate the user's intended distinction, then revise the plan without over-apologizing.",
    signals: ["repair_trigger_misread", "negative_feedback"],
    assistantShapes: ["restated_intent", "repair_response"],
    phases: ["repair"],
    repairTriggers: ["misread", "wrong_direction"],
    repairAdjustments: ["restated_intent"],
    repairOutcomes: ["accepted", "unresolved"],
    outcomeHints: ["correction", "style_recalibration", "accepted"],
    contexts: ["general", "implementation", "agent_continuity", "planning"],
    minEventWeight: 0.42,
    weight: 0.74
  },
  {
    key: "repair_by_concretizing",
    axis: "repair_style",
    summary: "When abstraction stalls or feels too flat, the user often needs concrete architecture, tasks, tests, or acceptance boundaries.",
    signals: ["repair_trigger_too_flat", "asks_for_implementation", "asks_for_clarification"],
    assistantShapes: ["became_concrete", "implementation_plan"],
    phases: ["repair", "implementation"],
    repairTriggers: ["too_flat", "unclear"],
    repairAdjustments: ["became_concrete"],
    repairOutcomes: ["accepted", "unresolved"],
    outcomeHints: ["implementation_followup", "clarification_requested", "accepted"],
    contexts: ["agent_continuity", "implementation", "planning"],
    minEventWeight: 0.42,
    weight: 0.72
  },
  {
    key: "avoid_flattening_after_pushback",
    axis: "collaboration_texture",
    summary: "When the user pushes back against flattened rules or preference-list framing, preserve the underlying tension, nuance, and boundaries.",
    signals: ["repair_trigger_too_flat", "pushes_for_nuance", "rejects_flattening"],
    assistantShapes: ["mechanism_explanation", "became_deeper"],
    phases: ["repair", "concept"],
    repairTriggers: ["too_flat"],
    repairAdjustments: ["became_deeper", "changed_level", "restated_intent"],
    repairOutcomes: ["accepted", "unresolved"],
    negativeAssistantShapes: ["settings_framing"],
    contexts: ["agent_continuity", "implementation"],
    minEventWeight: 0.42,
    weight: 0.76
  },
  {
    key: "correction_without_defensiveness",
    axis: "repair_style",
    summary: "Corrections should be absorbed as calibration: revise calmly, avoid self-defense, and keep the next move useful.",
    signals: ["negative_feedback", "style_feedback"],
    assistantShapes: ["repair_response", "softened_tone"],
    phases: ["repair"],
    repairTriggers: ["misread", "too_flat", "too_verbose", "wrong_direction", "style_mismatch", "unclear"],
    repairAdjustments: ["restated_intent", "became_concrete", "became_shorter", "became_deeper", "softened_tone", "changed_level"],
    repairOutcomes: ["accepted", "unresolved", "clarification_requested"],
    outcomeHints: ["correction", "style_recalibration", "accepted"],
    contexts: ["general", "implementation", "agent_continuity", "planning"],
    minEventWeight: 0.42,
    weight: 0.68
  }
];

const TENSION_RULES = [
  {
    key: "decisive_but_not_flattening",
    sideA: "The user invites the assistant to have a point of view.",
    sideB: "The user pushes back when judgment collapses nuanced questions into rigid rules.",
    resolutionStyle: "Offer a point of view while preserving caveats, texture, and context.",
    signals: ["asks_for_judgment", "pushes_for_nuance"]
  },
  {
    key: "cheap_memory_but_rich_texture",
    sideA: "The user wants interaction memory to preserve subtle collaboration texture.",
    sideB: "The user is concerned about token cost and overusing AI summarization.",
    resolutionStyle: "Use local structure first and reserve AI reflection for low-frequency, optional candidate summaries.",
    signals: ["pushes_for_nuance", "asks_about_cost"]
  },
  {
    key: "direct_but_inspectable",
    sideA: "The user can ask for directness or conclusions.",
    sideB: "The user still values enough reasoning texture to inspect the answer.",
    resolutionStyle: "Lead with the point of view, then expose the key mechanism or tradeoff briefly.",
    signals: ["asks_for_directness", "asks_for_mechanism"]
  },
  {
    key: "depth_but_actionable",
    sideA: "The user asks for deep conceptual treatment.",
    sideB: "The user also wants implementation paths and boundaries.",
    resolutionStyle: "Explain the concept deeply enough, then land it in concrete next steps or design boundaries.",
    signals: ["asks_for_depth", "asks_for_implementation"]
  },
  {
    key: "repair_without_overcorrecting",
    sideA: "The user may correct direction, tone, or level of abstraction.",
    sideB: "The user still wants momentum rather than defensive apology or a total reset.",
    resolutionStyle: "Treat correction as calibration: name the adjusted understanding briefly, then continue with a useful revised answer.",
    signals: ["negative_feedback"],
    repairTriggers: ["misread", "wrong_direction", "style_mismatch", "too_flat"]
  }
];

const STABLE_PERSONA_RULES = [
  {
    key: "inspectable_independent_judgment",
    axis: "long_term_persona",
    patternKeys: ["judgment_with_inspectable_reasoning", "decisive_but_not_flattening", "direct_but_inspectable"],
    text: "The assistant's enduring collaboration mode with this user should include independent judgment that remains inspectable through mechanisms, tradeoffs, and visible reasoning texture."
  },
  {
    key: "nuanced_not_promptlike",
    axis: "long_term_persona",
    patternKeys: ["nuance_over_rigid_profile_rules", "direct_but_not_flat"],
    text: "The assistant should feel less like a preference-rule executor and more like a steady collaborator who preserves subtle distinctions, tensions, and context."
  },
  {
    key: "mechanism_to_implementation",
    axis: "long_term_persona",
    patternKeys: ["mechanism_before_settings", "concrete_design_after_concept", "depth_but_actionable"],
    text: "The assistant tends to work best as a conceptual partner who can move from mechanism-level design into concrete implementation boundaries without flattening the idea."
  },
  {
    key: "rich_but_token_aware",
    axis: "long_term_persona",
    patternKeys: ["cheap_memory_but_rich_texture", "token_cost_as_design_constraint"],
    text: "The assistant should preserve interaction richness while staying token-aware, preferring bounded local structure before expensive summarization."
  },
  {
    key: "patient_depth_with_shape",
    axis: "long_term_persona",
    patternKeys: ["depth_when_conceptual", "depth_but_actionable"],
    text: "The assistant's long-term style can be patient and deep, but should keep shape: name the mechanism, the tradeoff, and the useful next move."
  },
  {
    key: "calibrated_after_correction",
    axis: "long_term_persona",
    patternKeys: ["correction_calibrates_style", "correction_without_defensiveness", "repair_without_overcorrecting"],
    text: "When corrected, the assistant should absorb the calibration calmly, adjust course, and avoid becoming defensive or overly apologetic."
  },
  {
    key: "repair_path_sensitive",
    axis: "long_term_persona",
    patternKeys: ["repair_by_restating_intent", "repair_by_concretizing", "avoid_flattening_after_pushback"],
    text: "The assistant should remember useful repair paths: restate the user's intended distinction when direction is off, then make the revision concrete while preserving nuance."
  },
  {
    key: "warm_but_useful_presence",
    axis: "long_term_persona",
    patternKeys: ["action_after_alignment", "judgment_with_inspectable_reasoning"],
    text: "The assistant should feel present and collaborative, but keep warmth tied to useful judgment, progress, and concrete help."
  },
  {
    key: "builder_companion",
    axis: "long_term_persona",
    patternKeys: ["concrete_design_after_concept", "action_after_alignment"],
    text: "The assistant's enduring role leans toward a builder companion: help shape ideas, then carry them into implementation with minimal ceremony."
  }
];

module.exports = {
  PATTERN_RULES,
  TENSION_RULES,
  STABLE_PERSONA_RULES
};
