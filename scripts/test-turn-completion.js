const assert = require("assert");

const { captureTurnContinuity } = require("../src/agents/shared/TurnCompletion");

async function testSharedContinuityCapturePreservesOrderAndTranslations() {
  const calls = [];
  const updates = [];
  const plugin = {
    memoryStore: {
      async captureTurn() {
        calls.push("memory");
        return [{ text: "saved", scope: "project", kind: "decision", evidenceRefs: [] }];
      }
    },
    interactionMemoryStore: {
      async captureTurn() {
        calls.push("interaction");
        return { closedEpisodes: [], updatedPatterns: [], updatedTensions: [], updatedStableImpressions: [] };
      }
    },
    deepMemoryStore: {
      async captureTurn() {
        calls.push("deep");
        return [];
      }
    }
  };
  const translate = (_settings, key, params = {}) => `${key}:${params.count || ""}`;

  await captureTurnContinuity(plugin, { prompt: "p", response: "r" }, {}, (update) => {
    updates.push(update);
  }, { keyPrefix: "codex", translate });

  assert.deepEqual(calls, ["memory", "interaction", "deep"]);
  assert.equal(updates[0].title, "codex.memoryUpdated.title:");
  assert.equal(updates[0].summary, "codex.memoryUpdated.summary:1");
}

testSharedContinuityCapturePreservesOrderAndTranslations()
  .then(() => console.log("Turn completion tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
