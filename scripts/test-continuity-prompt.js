const assert = require("assert");

const {
  formatAssistantContinuityPrompt
} = require("../src/continuity/ContinuityPromptFormatter");

function testEmptyContinuityIsOmitted() {
  assert.equal(formatAssistantContinuityPrompt({}), "");
}

function testContinuityMergesSignalsIntoOneSection() {
  const prompt = formatAssistantContinuityPrompt({
    workingAffect: {
      label: "warm-focused",
      strength: 0.82,
      ageMinutes: 8,
      warmth: 0.8,
      focus: 0.78,
      tension: 0.1
    },
    deepMemories: [
      {
        summary: "User wants important moments remembered with natural continuity.",
        whyItMatters: "It makes continuity feel meaningful.",
        feltSense: "warm and grounded",
        userExcerpt: "I want important moments to shape later conversations.",
        assistantExcerpt: "I will preserve bounded emotional residue.",
        importance: 0.86,
        confidence: 0.78,
        createdAt: Date.UTC(2026, 6, 8),
        updatedAt: Date.UTC(2026, 6, 9)
      },
      {
        summary: "This second memory should not be included by default.",
        importance: 0.8,
        confidence: 0.7
      }
    ],
    interactionStance: [
      {
        axis: "collaboration_style",
        text: "Prefer warm, concrete engineering judgment.",
        confidence: 0.8,
        evidenceCount: 3
      },
      {
        axis: "pace",
        text: "Keep explanations compact unless the user asks to go deeper.",
        confidence: 0.7,
        evidenceCount: 2
      },
      {
        axis: "extra",
        text: "This third stance should not be included by default.",
        confidence: 0.7,
        evidenceCount: 2
      }
    ],
    personaProfile: {
      preset: "INFP-ish",
      label: "INFP-ish",
      salience: {
        beauty: 0.82,
        care: 0.78,
        justice: 0.72,
        achievement: 0.38
      }
    }
  });

  assert(prompt.includes("Assistant continuity context"));
  assert(prompt.includes("These are soft local continuity notes"));
  assert(prompt.includes("Current tone: warm-focused"));
  assert(prompt.includes("origin=locally_computed_affect; speaker=none"));
  assert(prompt.includes("important moments remembered"));
  assert(prompt.includes("origin=local_memory_synthesis; speaker=none; not a quote"));
  assert(prompt.includes("origin=user_message; speaker=user; quote"));
  assert(prompt.includes("origin=assistant_message; speaker=assistant; quote"));
  assert(prompt.includes("date anchor: recorded 2026-07-08, updated 2026-07-09"));
  assert(prompt.includes("interpret relative words like tomorrow/yesterday relative to that recorded date"));
  assert(prompt.includes("Prefer warm, concrete engineering judgment"));
  assert(prompt.includes("origin=local_episode_inference; speaker=none; not quote"));
  assert(prompt.includes("Keep explanations compact"));
  assert(prompt.includes("Salience hints: beauty and atmosphere high, care and being seen high, justice and principled boundaries high"));
  assert(prompt.includes("not an identity claim"));
  assert(prompt.includes("origin=configured_persona_preset; speaker=none"));
  assert(!prompt.includes("second memory should not"));
  assert(!prompt.includes("third stance should not"));
}

function testDeepMemoryEvidenceStaysCompact() {
  const longUserExcerpt = `第一句保留关键要求。${"无关的后续说明".repeat(40)}`;
  const longAssistantExcerpt = `已完成关键修复。${"冗长的验证过程".repeat(40)}`;
  const prompt = formatAssistantContinuityPrompt({
    deepMemories: [{
      summary: "A prior repair matters for continuity.",
      userExcerpt: longUserExcerpt,
      assistantExcerpt: longAssistantExcerpt,
      importance: 0.9,
      confidence: 0.8
    }]
  });

  assert(prompt.includes("第一句保留关键要求。"));
  assert(prompt.includes("已完成关键修复。"));
  assert(!prompt.includes("无关的后续说明无关的后续说明无关的后续说明"));
  assert(!prompt.includes("冗长的验证过程冗长的验证过程冗长的验证过程"));
  assert.equal(
    (prompt.match(/evidence \[origin=/g) || []).length,
    2,
    "a recalled moment should include at most two compact evidence excerpts"
  );

  const shortManySentencesPrompt = formatAssistantContinuityPrompt({
    deepMemories: [{
      summary: "Short evidence can still contain too many sentences.",
      userExcerpt: "One. Two. Three. Four.",
      importance: 0.9,
      confidence: 0.8
    }]
  });
  assert(shortManySentencesPrompt.includes("“One. Two.”"));
  assert(!shortManySentencesPrompt.includes("Three."));

  const quotedPrompt = formatAssistantContinuityPrompt({
    deepMemories: [{
      summary: "Quoted English evidence should keep sentence boundaries.",
      userExcerpt: '"First quoted sentence." Second sentence. Third sentence. '.repeat(5),
      importance: 0.9,
      confidence: 0.8
    }]
  });
  assert(quotedPrompt.includes('“"First quoted sentence." Second sentence.”'));
  assert(!quotedPrompt.includes("Third sentence."));
}

Promise.resolve()
  .then(testEmptyContinuityIsOmitted)
  .then(testContinuityMergesSignalsIntoOneSection)
  .then(testDeepMemoryEvidenceStaysCompact)
  .then(() => {
    console.log("Continuity prompt tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
