const assert = require("assert");

const { planPromptSignals, _test } = require("../src/promptSignals");

function memory(id, text, extras = {}) {
  return Object.assign({
    id,
    key: "",
    text,
    scope: "project"
  }, extras);
}

function stance(text, confidence, extras = {}) {
  return Object.assign({
    kind: "pattern",
    axis: "collaboration_style",
    text,
    confidence,
    evidenceCount: 2
  }, extras);
}

function deepMemory(id, summary, extras = {}) {
  return Object.assign({
    id,
    key: id,
    summary,
    userExcerpt: "",
    importance: 0.8,
    confidence: 0.7
  }, extras);
}

{
  const result = planPromptSignals({
    memories: [
      memory("auto-1", "Use compact final answers for this project."),
      memory("auto-2", "Use compact final answers for this project."),
      memory("auto-3", "Keep architecture docs updated.")
    ],
    memorySearchResults: [
      memory("explicit-1", "Use compact final answers for this project.")
    ],
    memorySearchPerformed: true
  });

  assert.deepEqual(
    result.memories.map((item) => item.id),
    ["auto-3"],
    "explicit memory search should suppress automatic duplicate memory by text"
  );
  assert.equal(result.memorySearchPerformed, true, "explicit search performed flag should pass through");
  assert.equal(result.metadata.removedMemoryCount, 2, "removed memory metadata should count filtered memories");
}

{
  const result = planPromptSignals({
    interactionStance: [
      stance("Low confidence should stay out.", 0.3),
      stance("Medium confidence should stay in.", 0.5),
      stance("Medium confidence should stay in.", 0.7)
    ]
  });

  assert.deepEqual(
    result.interactionStance.map((item) => item.text),
    ["Medium confidence should stay in."],
    "interaction stance should filter low confidence and duplicate items"
  );
  assert.equal(result.metadata.removedInteractionStanceCount, 2);
}

{
  const result = planPromptSignals({
    deepMemories: [
      deepMemory("deep-1", "User wants important moments remembered."),
      deepMemory("deep-1", "User wants important moments remembered."),
      deepMemory("deep-2", "Low confidence deep memory should stay out.", { confidence: 0.2 })
    ]
  });

  assert.deepEqual(
    result.deepMemories.map((item) => item.id),
    ["deep-1"],
    "deep memories should filter weak and duplicate items"
  );
  assert.equal(result.metadata.removedDeepMemoryCount, 2);
}

{
  const steady = planPromptSignals({
    workingAffect: {
      transient: true,
      label: "steady"
    }
  });
  assert.equal(steady.workingAffect, null, "neutral transient affect should not be injected");

  const focused = planPromptSignals({
    workingAffect: {
      transient: true,
      label: "focused"
    }
  });
  assert.equal(focused.workingAffect.label, "focused", "non-neutral transient affect should be kept");
}

assert.equal(
  _test.areSimilarTexts("Use compact final answers.", "use compact final answers"),
  true,
  "similar text helper should normalize punctuation and case"
);

assert.equal(
  _test.areSimilarTexts(
    "Use compact final answers.",
    "Use compact final answers, but include verification details for reviews."
  ),
  false,
  "short explicit matches should not suppress richer memories with extra qualifiers"
);

assert.equal(
  _test.areSimilarTexts("Use compact final answers please", "Use compact final answers."),
  true,
  "near-length substring matches should still count as duplicates"
);

console.log("Prompt signal tests passed.");
