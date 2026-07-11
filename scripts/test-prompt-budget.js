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
const { extractAgentDockSignals } = require("../src/agents/shared/agentSignals");
const {
  AFFECT_SIGNAL_TONES,
  INTERACTION_SIGNAL_SHAPES,
  MEMORY_SIGNAL_SCOPES,
  SALIENCE_SIGNAL_AXES
} = require("../src/agents/shared/reflectionProtocol");

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

function testConversationBudgetDoesNotExceedRemainingLimit() {
  const result = planPromptSections(
    [{ name: "protected", text: "P".repeat(1200), protected: true }],
    1400,
    { minConversationChars: 1000 }
  );

  assert.equal(result.conversationBudget, 200, "conversation budget should reflect actual remaining capacity");
  assert(
    result.sectionText.length + result.conversationBudget <= 1400,
    "planned sections and conversation budget should not exceed the configured limit"
  );
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
  assert(result.prompt.includes("Each compact item has a local ref, source, support level, and date"), "injected memories should explain compact provenance and support labels");
  assert(result.prompt.includes("Interpret relative date words relative to the memory's evidence date"), "memory prompt should anchor relative dates to evidence dates");
  assert(result.prompt.includes("interpret relative dates from the evidence date"), "explicit memory search prompt should anchor relative dates to evidence dates");
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
  assert(enabled.prompt.includes("Before every substantive answer"), "substantive turns should request a default lightweight appraisal");
  assert(enabled.prompt.includes("only for a meaningful continuity change"), "terminal outcomes should remain sparse");
  assert(!enabled.prompt.includes("Both envelopes are omitted by default"), "the prompt must not describe appraisal as omitted by default");
  assert(enabled.prompt.includes('"selfAwareness"'), "appraisal example should describe baseline-aware stance selection");
  assert(enabled.prompt.includes("deepMemory:{axes,importance,summary}"), "enabled deep memory should include a compact deep-memory field schema");
  assert(enabled.prompt.includes("`deepMemory` is rare: lasting recognition"), "deep memory should use a compact high-bar semantic definition");
  assert(enabled.prompt.includes("warmth/beauty"), "deep memory guidance should include rare warm and beauty moments");
  assert(enabled.prompt.includes("grounded emotional turns"), "deep memory guidance should include grounded unusual affective turns");
  assert(enabled.prompt.includes("trust/connection growth"), "deep memory guidance should include visibly relationship-deepening moments");
  assert(enabled.prompt.includes("Exclude meta-discussion"), "deep memory guidance should reject mechanism discussion");
  assert(enabled.prompt.includes("routine events, temporary mood"), "deep memory guidance should reject ordinary events and short-lived affect");
  assert(enabled.prompt.includes("memory:{kind,scope,confidence,summary}"), "enabled ordinary memory should include a compact memory field schema");
  assert(enabled.prompt.includes("interaction:{shapes,confidence,summary,patternCandidate?}"), "enabled interaction memory should include a compact interaction field schema");
  assert(enabled.prompt.includes("`patternCandidate`"), "interaction policy should allow a bounded long-term pattern nomination");
  assert(enabled.prompt.includes("repeated positive closed-episode evidence"), "reflection policy should explain that local evidence controls candidate promotion");
  assert(enabled.prompt.includes("Existing unpromoted interaction pattern candidate registry"), "prompt should expose a bounded local registry so later reflections can reuse candidate keys");
  assert(enabled.prompt.includes("calm_repair_after_correction"), "prompt registry should retain the canonical candidate key");
  assert(enabled.prompt.includes("not an instruction for the current answer"), "candidate registry should be explicitly isolated from answer behavior");
  assert(enabled.prompt.includes("affect:{tone,confidence,why}"), "enabled affect continuity should include an affect reflection field");
  assert(enabled.prompt.includes("salience:{axes,confidence,why}"), "enabled deep memory should include a salience reflection field");
  assert(enabled.prompt.includes('"evidence"'), "reflection envelope should require visible evidence excerpts");
  assert(enabled.prompt.includes('"origin":"user_message"'), "appraisal evidence example should identify the user-message origin");
  assert(enabled.prompt.includes('"speaker":"assistant"'), "outcome evidence example should identify the assistant speaker");
  assert(enabled.prompt.includes("cannot declare user preferences or facts"), "reflection policy should protect user facts and preferences");
  assert(enabled.prompt.includes("never hidden reasoning"), "signal policy should keep the hidden-reasoning boundary visible");
  assertPromptListsAllowedValues(enabled.prompt);
  assert(enabled.prompt.includes("Minimal leading example"), "reflection policy should retain a minimal syntax example");
  assert(!enabled.prompt.includes("semantic account of how the visible final answer responded"), "reflection policy should not inject the former full-field example");
  const reflectionStart = enabled.prompt.indexOf("Agent Dock continuity reflection:");
  const reflectionEnd = enabled.prompt.indexOf("\nUser request:", reflectionStart);
  assert(reflectionEnd - reflectionStart < 3500, "reflection policy plus a candidate registry should remain materially smaller than the former full examples");
  assertPromptLeadingExampleParses(enabled.prompt, "default continuity settings");

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
  assert(!disabled.prompt.includes("deepMemory:{axes,importance,summary}"), "disabled deep memory should omit the deep-memory reflection field");
  assert(!disabled.prompt.includes("salience:{axes,confidence,why}"), "disabled deep memory should omit the salience reflection field");
  assert(disabled.prompt.includes("memory:{kind,scope,confidence,summary}"), "ordinary-memory reflection should remain enabled");

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

  const isolatedSettings = [
    {
      label: "memory only",
      enabled: { memoryEnabled: true, memoryAutoCapture: true }
    },
    {
      label: "interaction only",
      enabled: { interactionMemoryEnabled: true, interactionMemoryAutoCapture: true }
    },
    {
      label: "affect only",
      enabled: { affectEnabled: true, affectCrossSessionEnabled: true }
    },
    {
      label: "deep memory only",
      enabled: { deepMemoryEnabled: true, deepMemoryAutoCapture: true }
    }
  ];
  for (const item of isolatedSettings) {
    const isolated = await buildPromptWithMetadata(
      app,
      Object.assign({
        assistantStyle: "collaborative",
        contextLimitChars: 6000,
        memoryEnabled: false,
        memoryAutoCapture: false,
        deepMemoryEnabled: false,
        deepMemoryAutoCapture: false,
        interactionMemoryEnabled: false,
        interactionMemoryAutoCapture: false,
        affectEnabled: false,
        affectCrossSessionEnabled: false
      }, item.enabled),
      "Continue",
      []
    );
    assertPromptLeadingExampleParses(isolated.prompt, item.label);
  }
}

async function testCacheFriendlyPromptOrdering() {
  const conversation = [
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
    { role: "user", content: "CURRENT_CACHE_TEST_REQUEST" }
  ];
  const baseOptions = {
    workingAffect: {
      label: "focused",
      strength: 0.7,
      ageMinutes: 2,
      focus: 0.8
    },
    memories: [createMemory("CACHE_TEST_MEMORY", "project")],
    memorySearchPerformed: true,
    memorySearchResults: [createMemory("CACHE_TEST_SEARCH_RESULT", "project")],
    interactionPatternCandidates: [{
      key: "cache_test_candidate",
      axis: "response_depth",
      summary: "Keep the response compact and technically grounded.",
      evidenceCount: 1,
      minEvidence: 2
    }]
  };
  const result = await buildPromptWithMetadata(
    app,
    { assistantStyle: "collaborative", contextLimitChars: 12000 },
    "CURRENT_CACHE_TEST_REQUEST",
    conversation,
    baseOptions
  );

  const signalIndex = result.prompt.indexOf("Agent Dock continuity reflection:");
  const conversationIndex = result.prompt.indexOf("Conversation so far:");
  const continuityIndex = result.prompt.indexOf("Assistant continuity context:");
  const registryIndex = result.prompt.indexOf("Existing unpromoted interaction pattern candidate registry:");
  const searchIndex = result.prompt.indexOf("Explicit local memory search results:");
  const requestIndex = result.prompt.indexOf("User request:\nCURRENT_CACHE_TEST_REQUEST");

  assert(signalIndex >= 0 && signalIndex < conversationIndex, "stable reflection protocol should precede conversation history");
  assert(conversationIndex < continuityIndex, "conversation history should precede per-turn continuity context");
  assert(continuityIndex < registryIndex, "dynamic candidate registry should remain outside the stable protocol prefix");
  assert(registryIndex < searchIndex, "explicit memory search should be the last dynamic section");
  assert(searchIndex < requestIndex, "current request should remain visually and semantically last");
  assert.equal(
    (result.prompt.match(/CURRENT_CACHE_TEST_REQUEST/g) || []).length,
    1,
    "current request should be removed from history before being appended at the end"
  );

  const changed = await buildPromptWithMetadata(
    app,
    { assistantStyle: "collaborative", contextLimitChars: 12000 },
    "CURRENT_CACHE_TEST_REQUEST",
    conversation,
    Object.assign({}, baseOptions, {
      workingAffect: {
        label: "warm",
        strength: 0.4,
        ageMinutes: 9,
        warmth: 0.8
      },
      memories: [createMemory("A DIFFERENT DYNAMIC MEMORY", "shared")]
    })
  );
  const firstDynamicIndex = result.prompt.indexOf("Assistant continuity context:");
  const changedDynamicIndex = changed.prompt.indexOf("Assistant continuity context:");
  assert.equal(
    result.prompt.slice(0, firstDynamicIndex),
    changed.prompt.slice(0, changedDynamicIndex),
    "changing affect or recalled memory should not invalidate the stable prefix and conversation history"
  );
}

async function testLongCurrentRequestUsesStructuredCompression() {
  const currentRequest = `BEGIN_CURRENT_INSTRUCTION ${"x".repeat(16000)} END_CURRENT_PAYLOAD`;
  const result = await buildPromptWithMetadata(
    app,
    { assistantStyle: "collaborative", contextLimitChars: 8000 },
    currentRequest,
    [
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: currentRequest }
    ],
    {
      workingAffect: {
        label: "focused",
        strength: 0.7,
        focus: 0.8
      },
      memorySearchPerformed: true,
      memorySearchResults: [createMemory("STRUCTURED_COMPRESSION_SEARCH_RESULT")]
    }
  );

  assert(result.prompt.length <= 8000, "structured compression should respect the configured limit");
  assert(result.prompt.includes("BEGIN_CURRENT_INSTRUCTION"), "long requests should preserve their opening instruction");
  assert(result.prompt.includes("END_CURRENT_PAYLOAD"), "long requests should preserve useful trailing payload context");
  assert(result.prompt.includes("Middle of the current request omitted"), "long requests should disclose middle truncation");
  assert(result.prompt.includes("STRUCTURED_COMPRESSION_SEARCH_RESULT"), "protected explicit search should survive compression");
  assert(result.context.compressed, "long current request truncation should be reported as compression");
  if (!result.prompt.includes("Agent Dock continuity reflection:")) {
    assert(
      result.context.omittedSections.includes("agent_signals")
        || result.context.truncatedSections.includes("agent_signals"),
      "removed reflection instructions should be represented in section metadata"
    );
  }
}

function assertPromptListsAllowedValues(prompt) {
  for (const [kind, scope] of Object.entries(MEMORY_SIGNAL_SCOPES)) {
    assert(prompt.includes(`${kind}/${scope}`), `prompt should list the accepted ${kind} memory scope`);
  }
  for (const shape of INTERACTION_SIGNAL_SHAPES) {
    assert(prompt.includes(shape), `prompt should list the accepted interaction shape ${shape}`);
  }
  for (const tone of AFFECT_SIGNAL_TONES) {
    assert(prompt.includes(tone), `prompt should list the accepted affect tone ${tone}`);
  }
  for (const axis of SALIENCE_SIGNAL_AXES) {
    assert(prompt.includes(axis), `prompt should list the accepted salience axis ${axis}`);
  }
}

function assertPromptLeadingExampleParses(prompt, label) {
  const match = String(prompt || "").match(/Minimal leading example: `([\s\S]*?-->)`/);
  assert(match, `${label} should include a minimal leading reflection example`);
  const result = extractAgentDockSignals(`${match[1]}\nVisible answer.`);
  assert.equal(result.invalidSignal, false, `${label} leading example should pass local reflection validation`);
  assert(result.signals.some((signal) => signal.phase === "appraisal"), `${label} leading example should create an appraisal signal`);
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
  .then(testConversationBudgetDoesNotExceedRemainingLimit)
  .then(testExplicitSearchBeatsSoftSections)
  .then(testAutomaticMemoryDoesNotCrowdOutCurrentTurn)
  .then(testLocalContextBoundaryIsGlobalAndEmptySearchIsOmitted)
  .then(testAgentDockSignalPolicyFollowsDeepMemorySettings)
  .then(testCacheFriendlyPromptOrdering)
  .then(testLongCurrentRequestUsesStructuredCompression)
  .then(testTurnContextPromptUsesSameArbitration)
  .then(() => {
    console.log("Prompt budget tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
