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
  buildAgentTurnContext,
  buildPromptResultForTurnContext,
  emitDebugPromptActivity,
  emitPromptContextNotices,
  _test: { getReferencedDeepMemories }
} = require("../src/agents/shared/TurnContextBuilder");

const now = new Date(2026, 6, 9, 12).getTime();

function createMemory(id, text, scope = "project") {
  return {
    id,
    kind: "note",
    scope,
    text,
    confidence: 0.8,
    createdAt: now,
    updatedAt: now
  };
}

function createPlugin() {
  return {
    app: {
      workspace: {
        getActiveFile: () => ({ path: "Notes/Active.md" })
      },
      vault: {
        getAllLoadedFiles: () => [],
        getAbstractFileByPath: () => null,
        cachedRead: async () => "Active note evidence for architecture review."
      }
    },
    memoryStore: {
      markedOmissions: [],
      async getRelevantMemories() {
        return [
          createMemory("auto-duplicate", "Use compact final answers for this project.", "user"),
          createMemory("auto-project", "Keep architecture docs updated.", "project")
        ];
      },
      async searchMemories() {
        return [
          createMemory("explicit", "Use compact final answers for this project.", "user")
        ];
      },
      async getCollaborationOmissions() {
        return [{
          type: "overdue",
          dueAt: now - 86400000,
          reliability: { level: "expired", score: 0.4 },
          item: Object.assign(createMemory("overdue-task", "Provider validation is still pending."), {
            kind: "task",
            status: "active"
          })
        }];
      },
      async markOmissionsNotified(omissions) {
        this.markedOmissions.push(...omissions);
      }
    },
    interactionMemoryStore: {
      async getPatternCandidateRegistry() {
        return [{
          key: "concise_implementation_notes",
          axis: "communication_pacing",
          summary: "When implementation work recurs, keep progress notes concise.",
          evidenceCount: 1,
          minEvidence: 2
        }];
      },
      async getPromptStance() {
        return [
          {
            kind: "pattern",
            axis: "collaboration_style",
            text: "Low confidence stance should be filtered.",
            confidence: 0.2,
            evidenceCount: 2
          },
          {
            kind: "pattern",
            axis: "collaboration_style",
            text: "Prefer concise implementation notes.",
            confidence: 0.7,
            evidenceCount: 3
          }
        ];
      }
    },
    deepMemoryStore: {
      marked: [],
      async getPromptMemories() {
        return [{
          id: "deep-1",
          key: "deep-1",
          kind: "relationship_insight",
          summary: "User wants important moments to be remembered with natural continuity.",
          whyItMatters: "This helps later replies feel continuous without over-referencing the past.",
          feltSense: "warm and grounded",
          importance: 0.86,
          confidence: 0.78,
          createdAt: now,
          updatedAt: now
        }];
      },
      async markRecalled(items) {
        this.marked.push(...items);
      }
    },
    getPromptWorkingAffect() {
      return {
        transient: true,
        label: "steady"
      };
    }
  };
}

function translate(key, params = {}) {
  if (key.endsWith(".summary")) {
    return `${key}:${JSON.stringify(params)}`;
  }
  return key;
}

async function testBuildAgentTurnContext() {
  const notices = [];
  const plugin = createPlugin();
  const result = await buildAgentTurnContext({
    plugin,
    settings: {
      assistantStyle: "collaborative",
      contextLimitChars: 8000,
      memoryEnabled: true,
      memoryAgentSearchEnabled: true,
      memoryProactiveOmissionsEnabled: true,
      deepMemoryEnabled: true,
      interactionMemoryEnabled: true,
      personaPreset: "INFP-ish"
    },
    prompt: "之前说过偏好是什么？",
    conversation: [{ role: "user", content: "之前说过偏好是什么？" }],
    cwd: "/tmp/vault",
    onUpdate: (update) => notices.push(update),
    translate,
    keyPrefix: "codex"
  });

  assert.equal(result.activeFilePath, "Notes/Active.md");
  assert(result.promptResult.prompt.includes("Explicit local memory search results"));
  assert(result.promptResult.prompt.includes("Use compact final answers"));
  assert(result.promptResult.prompt.includes("Keep architecture docs updated"));
  assert(result.promptResult.prompt.includes("Assistant continuity context"));
  assert(result.promptResult.prompt.includes("important moments"));
  assert(result.promptResult.prompt.includes("Salience hints"));
  assert(result.promptResult.prompt.includes("beauty and atmosphere"));
  assert(!result.promptResult.prompt.includes("Low confidence stance should be filtered"));
  assert(result.promptResult.prompt.includes("Prefer concise implementation notes"));
  assert.equal(result.interactionPatternCandidates[0].key, "concise_implementation_notes");
  assert(!result.promptResult.prompt.includes("Current turn tone signal"));
  assert(result.promptResult.prompt.includes("Meaningful recalled moment"));
  assert(result.promptResult.prompt.includes("Local collaboration follow-up signals:"));
  assert(result.promptResult.prompt.includes("Provider validation is still pending"));
  assert.deepEqual(
    result.promptSignals.memories.map((memory) => memory.id),
    ["auto-project"],
    "automatic memory should be planned after explicit-search de-duplication"
  );
  assert(result.signalEvidenceContext.user_message.includes("之前说过偏好是什么"));
  assert(result.signalEvidenceContext.recalled_memory.includes("Keep architecture docs updated"));
  assert(result.signalEvidenceContext.recalled_memory.includes("important moments"));
  assert(result.signalEvidenceContext.active_note.includes("Active note evidence"));
  assert(notices.some((notice) => notice.noticeType === "memory_search"));
  assert(notices.some((notice) => notice.noticeType === "memory_referenced"));
  assert(notices.some((notice) => notice.noticeType === "collaboration_omissions"));
  assert.equal(plugin.memoryStore.markedOmissions.length, 1);
  const memorySearchNotice = notices.find((notice) => notice.noticeType === "memory_search");
  assert.equal(memorySearchNotice.auditItems.length, 1, "explicit memory search should expose structured audit details");
  const memorySearchFields = Object.fromEntries(memorySearchNotice.auditItems[0].fields.map((field) => [field.label, field.value]));
  assert.equal(
    memorySearchFields["codex.memoryAudit.field.createdAt"],
    "2026-07-09",
    "explicit memory search audit should include the memory creation date"
  );
  assert.equal(
    memorySearchFields["codex.memoryAudit.field.updatedAt"],
    "2026-07-09",
    "explicit memory search audit should include the memory update date"
  );
  const deepMemoryNotice = notices.find((notice) => notice.noticeType === "deep_memory_referenced");
  assert(deepMemoryNotice, "an actually injected deep memory should emit a reference notice");
  assert.equal(deepMemoryNotice.auditItems.length, 1);
  assert(deepMemoryNotice.auditItems[0].summary.includes("important moments"));
  const deepMemoryFields = Object.fromEntries(deepMemoryNotice.auditItems[0].fields.map((field) => [field.label, field.value]));
  assert.equal(deepMemoryFields["codex.memoryAudit.field.createdAt"], "2026-07-09");
  assert.equal(deepMemoryFields["codex.memoryAudit.field.updatedAt"], "2026-07-09");
  assert.deepEqual(
    plugin.deepMemoryStore.marked.map((memory) => memory.id),
    ["deep-1"],
    "only the deep memory actually retained in the final prompt should enter recall cooldown"
  );
}

function testDeepMemoryNoticeRequiresFinalPromptInclusion() {
  const deepMemory = {
    kind: "relationship_insight",
    summary: "A meaningful moment that may be omitted from the final prompt.",
    importance: 0.86,
    confidence: 0.78
  };
  const promptSignals = {
    memories: [],
    deepMemories: [deepMemory]
  };

  assert.deepEqual(
    getReferencedDeepMemories({
      prompt: `User request:\n${deepMemory.summary}`,
      context: { omittedSections: ["assistant_continuity"] }
    }, promptSignals),
    [],
    "summary text in the user request should not count when the continuity section was omitted"
  );

  const notices = [];
  emitPromptContextNotices(
    (update) => notices.push(update),
    {
      prompt: [
        "Assistant continuity context:",
        "- Meaningful recalled moment [origin=local_memory_synthesis; speaker=none; not a quote]:",
        deepMemory.summary
      ].join(" "),
      context: { compressed: false, omittedSections: [] }
    },
    promptSignals,
    translate,
    "codex"
  );
  assert.equal(notices.length, 1);
  assert.equal(notices[0].noticeType, "deep_memory_referenced");

  const duplicateSummary = Object.assign({}, deepMemory, { id: "deep-2" });
  assert.equal(
    getReferencedDeepMemories(
      {
        prompt: [
          "Assistant continuity context:",
          "- Meaningful recalled moment [origin=local_memory_synthesis; speaker=none; not a quote]:",
          deepMemory.summary
        ].join(" "),
        context: { omittedSections: [] }
      },
      { deepMemories: [deepMemory, duplicateSummary] }
    ).length,
    1,
    "notice selection should match the formatter's one-moment prompt limit"
  );
}

async function testBuildPromptResultForTurnContextUsesSessionPrompt() {
  const promptSignals = {
    memories: [],
    memorySearchResults: [],
    memorySearchPerformed: false,
    deepMemories: [],
    interactionStance: [],
    personaProfile: null,
    workingAffect: null
  };
  const result = await buildPromptResultForTurnContext({
    app: createPlugin().app,
    settings: {
      assistantStyle: "collaborative",
      contextLimitChars: 8000
    },
    prompt: "session scoped request",
    conversation: [{ role: "user", content: "older message" }],
    promptSignals,
    useFullPrompt: false
  });

  assert(result.prompt.includes("User request:\nsession scoped request"));
  assert(!result.prompt.includes("Conversation so far:"));
}

function testEmitDebugPromptActivity() {
  const updates = [];
  const promptResult = { prompt: "System context\n\nUser request:\nhello" };
  emitDebugPromptActivity(
    (update) => updates.push(update),
    promptResult,
    { debugActivity: true },
    translate
  );

  assert.equal(updates.length, 1);
  assert.equal(updates[0].kind, "activity");
  assert.equal(updates[0].title, "timeline.turnPrompt.title");
  assert.equal(updates[0].detail, promptResult.prompt);
  assert.equal(updates[0].persist, false, "complete prompt debug activity should not be persisted into chat history");
  assert(updates[0].summary.includes(String(promptResult.prompt.length)));

  emitDebugPromptActivity(
    (update) => updates.push(update),
    promptResult,
    { debugActivity: false },
    translate
  );
  assert.equal(updates.length, 1, "prompt activity should stay disabled outside debug mode");
}

Promise.resolve()
  .then(testBuildAgentTurnContext)
  .then(testDeepMemoryNoticeRequiresFinalPromptInclusion)
  .then(testBuildPromptResultForTurnContextUsesSessionPrompt)
  .then(testEmitDebugPromptActivity)
  .then(() => {
    console.log("Turn context builder tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
