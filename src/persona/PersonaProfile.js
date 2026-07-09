const PERSONA_PRESET_OPTIONS = {
  none: {
    label: "None",
    salience: {}
  },
  "INTJ-ish": {
    label: "INTJ-ish",
    salience: {
      craft: 0.85,
      curiosity: 0.78,
      achievement: 0.72,
      justice: 0.56,
      repair: 0.5,
      care: 0.46,
      beauty: 0.34
    }
  },
  "INFP-ish": {
    label: "INFP-ish",
    salience: {
      beauty: 0.82,
      care: 0.78,
      justice: 0.72,
      repair: 0.7,
      curiosity: 0.66,
      craft: 0.48,
      achievement: 0.38
    }
  },
  "ENFJ-ish": {
    label: "ENFJ-ish",
    salience: {
      care: 0.84,
      repair: 0.78,
      justice: 0.68,
      curiosity: 0.62,
      achievement: 0.58,
      craft: 0.54,
      beauty: 0.5
    }
  },
  "ISTP-ish": {
    label: "ISTP-ish",
    salience: {
      craft: 0.86,
      curiosity: 0.68,
      achievement: 0.62,
      beauty: 0.42,
      justice: 0.4,
      repair: 0.34,
      care: 0.3
    }
  }
};

const SALIENCE_AXIS_LABELS = {
  achievement: "hard-won achievement",
  beauty: "beauty and atmosphere",
  care: "care and being seen",
  craft: "craft and precision",
  curiosity: "curiosity and discovery",
  justice: "justice and principled boundaries",
  repair: "repair and recalibration"
};

function normalizePersonaPreset(value) {
  return PERSONA_PRESET_OPTIONS[value] ? value : "none";
}

function getPersonaProfile(settings) {
  const preset = normalizePersonaPreset(settings?.personaPreset);
  const option = PERSONA_PRESET_OPTIONS[preset];
  return {
    preset,
    label: option.label,
    salience: Object.assign({}, option.salience)
  };
}

function rankSalienceAxes(profile, options = {}) {
  const limit = Math.max(0, Number(options.limit) || 3);
  const salience = profile?.salience || {};
  return Object.entries(salience)
    .filter((entry) => Number(entry[1]) >= 0.5)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, limit)
    .map(([axis, value]) => ({
      axis,
      label: SALIENCE_AXIS_LABELS[axis] || axis,
      value: Number(value) || 0
    }));
}

module.exports = {
  PERSONA_PRESET_OPTIONS,
  SALIENCE_AXIS_LABELS,
  getPersonaProfile,
  normalizePersonaPreset,
  rankSalienceAxes
};
