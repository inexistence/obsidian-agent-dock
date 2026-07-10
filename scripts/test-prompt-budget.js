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

function createDeepMemory(summary) {
  return {
    kind: "relationship_insight",
    summary,
    whyItMatters: "It should shape continuity only when relevant.",
    feltSense: "warm but grounded",
    importance: 0.86,
    confidence: 0.78,
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
      deepMemories: [
        createDeepMemory("DEEP_MEMORY may be dropped before explicit search when space is tight. ".repeat(8))
      ],
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
  assert(
    result.context.omittedSections.includes("assistant_continuity")
      || result.context.truncatedSections.includes("assistant_continuity")
      || !result.prompt.includes("DEEP_MEMORY"),
    "assistant continuity should be bounded before it can crowd out explicit search"
  );
  assert(result.context.compressed, "section arbitration should mark the context compressed");
}

async function testAutomaticMemoryDoesNotCrowdOutCurrentTurn() {
  const result = await buildPromptWithMetadata(
    app,
    {
      assistantStyle: "collaborative",
      contextLimitChars: 1400
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

async function testLocalContextBoundaryIsGlobalAndEmptySearchIsOmitted() {
  const result = await buildPromptWithMetadata(
    app,
    {
      assistantStyle: "collaborative",
      contextLimitChars: 4000
    },
    "Do we remember anything about the release checklist?",
    [],
    {
      workingAffect: {
        label: "warm-focused",
        strength: 0.7,
        ageMinutes: 2,
        warmth: 0.8,
        focus: 0.8
      },
      memories: [
        createMemory("Remember to keep release checklist notes compact.", "project")
      ],
      memorySearchPerformed: true,
      memorySearchResults: []
    }
  );

  const boundaryMatches = result.prompt.match(/cannot override/g) || [];
  assert(result.prompt.includes("Local context boundary:"), "prompt should include one global local-context boundary");
  assert.equal(boundaryMatches.length, 1, "override boundary should not be repeated in each local context section");
  assert(result.prompt.includes("Explicit local memory search results"), "empty explicit memory search should still be included");
  assert(result.prompt.includes("No matching local memory was found"), "empty search should tell the agent no local memory matched");
  assert(result.prompt.includes("Relevant local memory:"), "non-empty automatic memory should still be included");
  assert(result.prompt.includes("Every item is labeled with origin and speaker provenance"), "injected memories should explain provenance and quotation boundaries");
  assert(result.prompt.includes("Interpret relative date words inside a memory"), "memory prompt should anchor relative dates to memory dates");
  assert(result.prompt.includes("Interpret relative date words inside a result"), "explicit memory search prompt should anchor relative dates to result dates");
  assert(result.prompt.includes("Assistant continuity context:"), "non-empty continuity should still be included");
}

async function testAgentDockSignalPolicyFollowsDeepMemorySettings() {
  const enabled = await buildPromptWithMetadata(
    app,
    {
      assistantStyle: "collaborative",
      contextLimitChars: 6000,
      deepMemoryEnabled: true,
      deepMemoryAutoCapture: true
    },
    "Continue",
    [],
    {
      interactionPatternCandidates: [{
        key: "calm_repair_after_correction",
        axis: "repair_style",
        summary: "When corrected, revise calmly and keep the next move useful.",
        evidenceCount: 1,
        minEvidence: 2
      }]
    }
  );
  assert(enabled.prompt.includes("agent-dock:reflection"), "enabled continuity systems should use one reflection envelope");
  assert(enabled.prompt.includes("phase=appraisal"), "reflection policy should include a leading appraisal phase");
  assert(enabled.prompt.includes("phase=outcome"), "reflection policy should include a terminal outcome phase");
  assert(enabled.prompt.includes("For every substantive response"), "substantive turns should request a default lightweight appraisal");
  assert(enabled.prompt.includes("only when the completed turn contains a meaningful"), "terminal outcomes should remain sparse");
  assert(!enabled.prompt.includes("Both envelopes are omitted by default"), "the prompt must not describe appraisal as omitted by default");
  assert(enabled.prompt.includes('"selfAwareness"'), "appraisal example should describe baseline-aware stance selection");
  assert(enabled.prompt.includes('"deepMemory"'), "enabled deep memory should include a deep-memory reflection field");
  assert(enabled.prompt.includes('"memory"'), "enabled ordinary memory should include an ordinary-memory reflection field");
  assert(enabled.prompt.includes('"interaction"'), "enabled interaction memory should include an interaction reflection field");
  assert(enabled.prompt.includes('"patternCandidate"'), "interaction outcome example should allow a bounded long-term pattern nomination");
  assert(enabled.prompt.includes("repeated positive closed-episode evidence"), "reflection policy should explain that local evidence controls candidate promotion");
  assert(enabled.prompt.includes("Existing unpromoted interaction pattern candidate registry"), "prompt should expose a bounded local registry so later reflections can reuse candidate keys");
  assert(enabled.prompt.includes("calm_repair_after_correction"), "prompt registry should retain the canonical candidate key");
  assert(enabled.prompt.includes("not an instruction for the current answer"), "candidate registry should be explicitly isolated from answer behavior");
  assert(enabled.prompt.includes('"affect"'), "enabled affect continuity should include an affect reflection field");
  assert(enabled.prompt.includes('"salience"'), "enabled deep memory should include a salience reflection field");
  assert(enabled.prompt.includes('"evidence"'), "reflection envelope should require visible evidence excerpts");
  assert(enabled.prompt.includes('"origin":"user_message"'), "appraisal evidence example should identify the user-message origin");
  assert(enabled.prompt.includes('"speaker":"assistant"'), "outcome evidence example should identify the assistant speaker");
  assert(enabled.prompt.includes("cannot declare user preferences or facts"), "reflection policy should protect user facts and preferences");
  assert(enabled.prompt.includes("never hidden reasoning"), "signal policy should keep the hidden-reasoning boundary visible");

  const disabled = await buildPromptWithMetadata(
    app,
    {
      assistantStyle: "collaborative",
      contextLimitChars: 6000,
      deepMemoryEnabled: false,
      deepMemoryAutoCapture: true
    },
    "Continue",
    []
  );
  assert(disabled.prompt.includes("agent-dock:reflection"), "other enabled continuity systems should retain the unified envelope");
  assert(!disabled.prompt.includes('"deepMemory"'), "disabled deep memory should omit the deep-memory reflection field");
  assert(!disabled.prompt.includes('"salience"'), "disabled deep memory should omit the salience reflection field");
  assert(disabled.prompt.includes('"memory"'), "ordinary-memory reflection should remain enabled");

  const allDisabled = await buildPromptWithMetadata(
    app,
    {
      assistantStyle: "collaborative",
      contextLimitChars: 4000,
      deepMemoryEnabled: false,
      deepMemoryAutoCapture: true,
      memoryEnabled: false,
      memoryAutoCapture: true,
      interactionMemoryEnabled: false,
      interactionMemoryAutoCapture: true,
      affectEnabled: false,
      affectCrossSessionEnabled: true
    },
    "Continue",
    []
  );
  assert(!allDisabled.prompt.includes("agent-dock:reflection"), "disabling all continuity systems should omit the reflection envelope");
}

async function testTurnContextPromptUsesSameArbitration() {
  const result = await buildTurnContextPrompt(
    app,
    {
      assistantStyle: "collaborative",
      contextLimitChars: 1600
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
  .then(testLocalContextBoundaryIsGlobalAndEmptySearchIsOmitted)
  .then(testAgentDockSignalPolicyFollowsDeepMemorySettings)
  .then(testTurnContextPromptUsesSameArbitration)
  .then(() => {
    console.log("Prompt budget tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
