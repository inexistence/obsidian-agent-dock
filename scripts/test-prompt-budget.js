const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      normalizePath: (path) => String(path || "").replace(/\\/g, "/")
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  buildPromptWithMetadata,
  buildTurnContextPrompt
} = require("../src/prompt");
const { planPromptSections } = require("../src/promptBudget");

const app = {
  vault: {
    getAllLoadedFiles: () => [],
    getAbstractFileByPath: () => null
  }
};

const settings = {
  assistantStyle: "collaborative",
  contextLimitChars: 1600
};

const now = Date.UTC(2026, 6, 9);

function createMemory(text, scope = "project") {
  return {
    kind: "note",
    scope,
    text,
    confidence: 0.8,
    createdAt: now,
    updatedAt: now
  };
}

function testTruncatableSectionsShrinkBeforeDropping() {
  const result = planPromptSections(
    [
      { name: "assistant_style", text: "S".repeat(200), protected: true },
      {
        name: "referenced_paths",
        text: "REFERENCED_PATH ".repeat(60),
        optional: true,
        priority: 70,
        truncatable: true,
        minChars: 400
      },
      {
        name: "memory",
        text: "MEMORY ".repeat(130),
        optional: true,
        priority: 30,
        truncatable: true,
        minChars: 700
      }
    ],
    1900
  );

  assert(result.truncatedSections.includes("memory"), "lower priority truncatable section should shrink first");
  assert(!result.droppedSections.includes("referenced_paths"), "high priority referenced paths should not be dropped while truncation can fit");
  assert(result.sectionText.includes("REFERENCED_PATH"), "referenced path context should remain in the planned sections");
  assert(result.conversationBudget >= 1000, "reserved conversation budget should be preserved");
}

async function testExplicitSearchBeatsSoftSections() {
  const result = await buildPromptWithMetadata(
    app,
    settings,
    "LATEST_REQUEST must remain visible",
    [
      { role: "user", content: "older request ".repeat(120) },
      { role: "assistant", content: "older response ".repeat(120) },
      { role: "user", content: "LATEST_REQUEST must remain visible" }
    ],
    {
      workingAffect: {
        label: "warm-focused",
        strength: 0.9,
        ageMinutes: 3,
        warmth: 0.8,
        focus: 0.7,
        tension: 0.1,
        arousal: 0.4
      },
      interactionStance: [{
        kind: "pattern",
        text: "The assistant should preserve nuanced collaboration stance.",
        confidence: 0.8,
        strength: 0.8,
        evidenceCount: 4
      }],
      memories: [
        createMemory("Automatic memory should be droppable before explicit search. ".repeat(30), "user")
      ],
      memorySearchPerformed: true,
      memorySearchResults: [
        createMemory("EXPLICIT_SEARCH_RESULT must survive section arbitration.")
      ]
    }
  );

  assert(result.prompt.includes("EXPLICIT_SEARCH_RESULT"), "explicit search result should be retained");
  assert(result.prompt.includes("LATEST_REQUEST"), "latest user request should be retained");
  assert(result.context.omittedSections.includes("affect"), "low priority affect should be droppable");
  assert(result.context.omittedSections.includes("interaction_stance"), "interaction stance should be droppable before explicit search");
  assert(result.context.compressed, "section arbitration should mark the context compressed");
}

async function testAutomaticMemoryDoesNotCrowdOutCurrentTurn() {
  const result = await buildPromptWithMetadata(
    app,
    {
      assistantStyle: "collaborative",
      contextLimitChars: 1200
    },
    "CURRENT_TURN_TARGET",
    [],
    {
      memories: [
        createMemory("Very long automatic memory. ".repeat(120), "project")
      ]
    }
  );

  assert(result.prompt.includes("CURRENT_TURN_TARGET"), "current turn should survive large automatic memory");
  assert(
    result.context.omittedSections.includes("memory")
      || result.context.truncatedSections.includes("memory")
      || !result.prompt.includes("Very long automatic memory"),
    "automatic memory should be bounded when budget is tight"
  );
}

async function testTurnContextPromptUsesSameArbitration() {
  const result = await buildTurnContextPrompt(
    app,
    {
      assistantStyle: "collaborative",
      contextLimitChars: 1200
    },
    "TURN_CONTEXT_REQUEST",
    {
      memories: [
        createMemory("Turn context automatic memory. ".repeat(80), "shared")
      ],
      memorySearchPerformed: true,
      memorySearchResults: [
        createMemory("TURN_CONTEXT_EXPLICIT_SEARCH")
      ]
    }
  );

  assert(result.prompt.includes("TURN_CONTEXT_REQUEST"), "turn context prompt should keep the request");
  assert(result.prompt.includes("TURN_CONTEXT_EXPLICIT_SEARCH"), "turn context prompt should keep explicit search");
}

Promise.resolve()
  .then(testTruncatableSectionsShrinkBeforeDropping)
  .then(testExplicitSearchBeatsSoftSections)
  .then(testAutomaticMemoryDoesNotCrowdOutCurrentTurn)
  .then(testTurnContextPromptUsesSameArbitration)
  .then(() => {
    console.log("Prompt budget tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
