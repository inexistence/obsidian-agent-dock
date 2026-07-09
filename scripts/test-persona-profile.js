const assert = require("assert");

const {
  getPersonaProfile,
  normalizePersonaPreset,
  rankSalienceAxes
} = require("../src/persona/PersonaProfile");

function testPresetNormalization() {
  assert.equal(normalizePersonaPreset("INFP-ish"), "INFP-ish");
  assert.equal(normalizePersonaPreset("unknown"), "none");
}

function testProfileRanking() {
  const profile = getPersonaProfile({ personaPreset: "INFP-ish" });
  const axes = rankSalienceAxes(profile, { limit: 3 });
  assert.deepEqual(
    axes.map((axis) => axis.axis),
    ["beauty", "care", "justice"],
    "INFP-ish should prioritize beauty, care, and justice"
  );
  assert(axes.every((axis) => axis.value >= 0.5), "ranked axes should omit low salience");
}

function testNoneProfileIsEmpty() {
  const profile = getPersonaProfile({ personaPreset: "none" });
  assert.deepEqual(rankSalienceAxes(profile), []);
}

Promise.resolve()
  .then(testPresetNormalization)
  .then(testProfileRanking)
  .then(testNoneProfileIsEmpty)
  .then(() => {
    console.log("Persona profile tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
