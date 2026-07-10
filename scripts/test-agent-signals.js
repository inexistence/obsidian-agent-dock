const assert = require("assert");

const {
  extractAgentDockSignals,
  formatInvalidAgentDockSignalActivity,
  formatAgentDockSignalNotice,
  formatAgentDockReflectionNotice
} = require("../src/agents/shared/agentSignals");
const { ReflectionContentFilter } = require("../src/agents/shared/ReflectionContentFilter");
const { hasGroundedAgentSignal } = require("../src/agents/shared/signalEvidence");

function translate(key, params) {
  const messages = {
    "codex.memoryCandidate.title": "Memory candidate",
    "codex.memoryCandidate.summary": "Captured 1 auditable ordinary-memory candidate.",
    "codex.interactionCandidate.title": "Interaction candidate",
    "codex.interactionCandidate.summary": "Captured interaction candidate.",
    "codex.affectCandidate.title": "Affect candidate",
    "codex.affectCandidate.summary": "Captured affect candidate.",
    "codex.salienceObservation.title": "Salience observation",
    "codex.salienceObservation.summary": "Captured salience observation.",
    "codex.reflectionCandidate.title": "Continuity reflection",
    "codex.reflectionCandidate.summary": `Captured ${params?.count || "?"} reflection candidates.`,
    "reflectionAudit.source": "AI reflection",
    "reflectionAudit.phase.appraisal": "Appraisal",
    "reflectionAudit.phase.outcome": "Outcome",
    "reflectionAudit.type.affect_candidate": "Affect",
    "reflectionAudit.type.salience_observation": "Salience",
    "reflectionAudit.field.phase": "Phase",
    "reflectionAudit.field.type": "Type",
    "reflectionAudit.field.signalDescription": "Signal description",
    "reflectionAudit.field.memoryContent": "Memory content",
    "reflectionAudit.field.memorySummary": "Memory summary",
    "reflectionAudit.field.responseStrategy": "Response strategy",
    "reflectionAudit.field.toneReason": "Tone rationale",
    "reflectionAudit.field.salienceReason": "Salience rationale",
    "reflectionAudit.field.evidence": "Evidence",
    "reflectionAudit.field.confidence": "Confidence",
    "reflectionAudit.field.importance": "Importance",
    "reflectionAudit.field.tone": "Tone",
    "reflectionAudit.field.axes": "Axes",
    "reflectionAudit.field.shapes": "Shapes",
    "reflectionAudit.field.kind": "Kind",
    "reflectionAudit.field.scope": "Scope",
    "reflectionAudit.field.sourceMessageType": "Host message",
    "reflectionAudit.field.filteredSource": "Filtered source text",
    "reflectionAudit.field.rawSource": "Complete pre-filter source",
    "reflectionAudit.sourceKind.commentary": "Commentary progress message",
    "reflectionAudit.sourceKind.content": "Content final answer",
    "reflectionAudit.field.speaker": "Speaker",
    "reflectionAudit.origin.user_message": "User message",
    "reflectionAudit.origin.assistant_message": "Assistant message",
    "reflectionAudit.origin.recalled_memory": "Recalled memory",
    "reflectionAudit.origin.active_note": "Active note",
    "reflectionAudit.origin.tool_result": "Tool result",
    "reflectionAudit.origin.unknown": "Unknown origin",
    "reflectionAudit.speaker.user": "User",
    "reflectionAudit.speaker.assistant": "Assistant",
    "reflectionAudit.speaker.none": "None",
    "codex.deepMemoryCandidate.title": "Deep memory candidate",
    "codex.deepMemoryCandidate.summary": "Captured 1 auditable continuity reflection."
  };
  return messages[key] || key;
}

function testExtractsTerminalDeepMemoryComment() {
  const result = extractAgentDockSignals([
    "Done.",
    "",
    "<!-- agent-dock:deep-memory axes=care,repair importance=0.76 | 用户希望记忆自然影响后续，而不是显眼展示。 -->"
  ].join("\n"));

  assert.equal(result.visibleText, "Done.");
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].type, "deep_memory");
  assert.deepEqual(result.signals[0].axes, ["care", "repair"]);
  assert.equal(result.signals[0].importance, 0.76);
  assert(result.signals[0].text.includes("自然影响后续"));
}

function testIgnoresNonTerminalComment() {
  const text = [
    "<!-- agent-dock:deep-memory | should stay visible because it is not terminal -->",
    "Done."
  ].join("\n");
  const result = extractAgentDockSignals(text);

  assert.equal(result.visibleText, text);
  assert.equal(result.signals.length, 0);
}

function testExtractsGroundedMemoryCandidateShape() {
  const result = extractAgentDockSignals([
    "Done.",
    "",
    "<!-- agent-dock:memory kind=decision scope=project confidence=0.68 | Adopt the normalized event protocol. -->"
  ].join("\n"));

  assert.equal(result.visibleText, "Done.");
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].type, "memory_candidate");
  assert.equal(result.signals[0].kind, "decision");
  assert.equal(result.signals[0].scope, "project");
  assert.equal(result.signals[0].confidence, 0.68);
}

function testRejectsUnsupportedMemoryCandidateShape() {
  const preference = extractAgentDockSignals(
    "Done.\n<!-- agent-dock:memory kind=preference scope=user confidence=0.9 | User prefers long answers. -->"
  );
  const mismatchedScope = extractAgentDockSignals(
    "Done.\n<!-- agent-dock:memory kind=decision scope=user | Adopt SQLite. -->"
  );

  assert.equal(preference.signals.length, 0);
  assert.equal(preference.invalidSignal, true);
  assert.equal(mismatchedScope.signals.length, 0);
  assert.equal(mismatchedScope.invalidSignal, true);
}

function testExtractsSupplementalContinuitySignals() {
  const interaction = extractAgentDockSignals(
    "Done.\n<!-- agent-dock:interaction shapes=became_concrete,softened_tone confidence=0.58 | The final answer became concrete and softened the correction. -->"
  );
  const affect = extractAgentDockSignals(
    "Done.\n<!-- agent-dock:affect tone=warm-focused confidence=0.55 | The answer stayed warm and focused. -->"
  );
  const salience = extractAgentDockSignals(
    "Done.\n<!-- agent-dock:salience axes=craft,achievement confidence=0.6 | The verified implementation made craft and achievement salient. -->"
  );

  assert.deepEqual(interaction.signals[0].shapes, ["became_concrete", "softened_tone"]);
  assert.equal(interaction.signals[0].type, "interaction_candidate");
  assert.equal(affect.signals[0].type, "affect_candidate");
  assert.equal(affect.signals[0].tone, "warm-focused");
  assert.equal(salience.signals[0].type, "salience_observation");
  assert.deepEqual(salience.signals[0].axes, ["craft", "achievement"]);
}

function testRejectsUnsupportedSupplementalSignals() {
  const interaction = extractAgentDockSignals(
    "Done.\n<!-- agent-dock:interaction shapes=invent_user_preference | Not allowed. -->"
  );
  const affect = extractAgentDockSignals(
    "Done.\n<!-- agent-dock:affect tone=omniscient | Not allowed. -->"
  );
  const salience = extractAgentDockSignals(
    "Done.\n<!-- agent-dock:salience axes=obedience | Not allowed. -->"
  );

  assert.equal(interaction.invalidSignal, true);
  assert.equal(affect.invalidSignal, true);
  assert.equal(salience.invalidSignal, true);
}

function testExtractsUnifiedReflectionEnvelope() {
  const envelope = {
    v: 1,
    evidence: [{
      origin: "assistant_message",
      speaker: "assistant",
      quote: "The final answer stayed focused and made the design concrete."
    }],
    memory: {
      kind: "decision",
      scope: "project",
      confidence: 0.66,
      summary: "Use a unified reflection envelope for continuity metadata."
    },
    deepMemory: {
      axes: ["care", "craft"],
      importance: 0.74,
      summary: "The user defined meaningful emotional continuity as a central project goal."
    },
    interaction: {
      shapes: ["became_concrete", "mechanism_explanation"],
      confidence: 0.61,
      summary: "The answer turned an abstract desire into a concrete mechanism."
    },
    affect: {
      tone: "warm-focused",
      confidence: 0.57,
      why: "The response was engaged and careful."
    },
    salience: {
      axes: ["care", "craft", "curiosity"],
      confidence: 0.63,
      why: "The turn centered relationship continuity and design craft."
    }
  };
  const result = extractAgentDockSignals(
    `Done.\n<!-- agent-dock:reflection | ${JSON.stringify(envelope)} -->`
  );

  assert.equal(result.visibleText, "Done.");
  assert.equal(result.signals.length, 5);
  assert.deepEqual(result.signals.map((signal) => signal.type), [
    "memory_candidate",
    "deep_memory",
    "interaction_candidate",
    "affect_candidate",
    "salience_observation"
  ]);
  assert(result.signals.every((signal) => signal.envelope === "reflection_v1"));
  assert(result.signals.every((signal) => signal.evidence[0].includes("stayed focused")));
  assert(result.signals.every((signal) => signal.evidenceRefs[0].origin === "assistant_message"));
  assert(result.signals.every((signal) => signal.evidenceRefs[0].speaker === "assistant"));
  const notice = formatAgentDockReflectionNotice(result.signals, {}, "codex", translate);
  const evidenceField = notice.auditItems[0].fields.find((field) => field.label === "Evidence");
  assert(evidenceField.value.includes("Assistant message; Speaker: Assistant"), "structured audit evidence should show origin and speaker");
}

function testRejectsReflectionWithoutEvidenceOrValidSections() {
  const missingEvidence = extractAgentDockSignals(
    `Done.\n<!-- agent-dock:reflection | ${JSON.stringify({ affect: { tone: "focused", why: "Focused." } })} -->`
  );
  const invalidSections = extractAgentDockSignals(
    `Done.\n<!-- agent-dock:reflection | ${JSON.stringify({ evidence: ["Done."], affect: { tone: "omniscient", why: "Invalid." } })} -->`
  );

  assert.equal(missingEvidence.invalidSignal, true);
  assert.equal(invalidSections.invalidSignal, true);
}

function testEvidenceSpeakerIsNormalizedAgainstOrigin() {
  const result = extractAgentDockSignals(
    `Done.\n<!-- agent-dock:reflection | ${JSON.stringify({
      evidence: [
        { origin: "user_message", speaker: "assistant", quote: "Current user quote" },
        { origin: "recalled_memory", speaker: "user", quote: "Historical user quote" }
      ],
      affect: { tone: "focused", why: "Keep provenance clear." }
    })} -->`
  );
  assert.equal(result.signals[0].evidenceRefs[0].speaker, "user", "current user-message evidence must not be relabeled as assistant speech");
  assert.equal(result.signals[0].evidenceRefs[1].speaker, "user", "recalled memory should preserve its allowlisted historical speaker");
}

function testExtractsLeadingAppraisalAndTerminalOutcome() {
  const appraisal = {
    evidence: [{
      origin: "user_message",
      speaker: "user",
      quote: "This request recalls an important repair."
    }],
    affect: {
      tone: "serious",
      confidence: 0.58,
      why: "The recalled repair makes the current stance more careful."
    },
    salience: {
      axes: ["repair", "care"],
      confidence: 0.6,
      why: "Repair and care matter before answering."
    }
  };
  const outcome = {
    evidence: [{
      origin: "assistant_message",
      speaker: "assistant",
      quote: "The answer responded carefully."
    }],
    interaction: {
      shapes: ["softened_tone"],
      confidence: 0.62,
      summary: "The answer handled the repair carefully."
    },
    affect: {
      tone: "reassuring",
      confidence: 0.64,
      why: "The completed answer was more reassuring than the initial stance."
    }
  };
  const result = extractAgentDockSignals([
    `<!-- agent-dock:reflection phase=appraisal | ${JSON.stringify(appraisal)} -->`,
    "The answer responded carefully.",
    `<!-- agent-dock:reflection phase=outcome | ${JSON.stringify(outcome)} -->`
  ].join("\n"));

  assert.equal(result.visibleText, "The answer responded carefully.");
  assert.deepEqual(result.signals.map((signal) => signal.phase), [
    "appraisal",
    "appraisal",
    "outcome",
    "outcome"
  ]);
  assert.deepEqual(result.signals.map((signal) => signal.type), [
    "affect_candidate",
    "salience_observation",
    "interaction_candidate",
    "affect_candidate"
  ]);
}

function testInvalidTypeIsStrippedWithoutSignal() {
  const result = extractAgentDockSignals("Done.\n<!-- agent-dock:unknown | ignore me -->");

  assert.equal(result.visibleText, "Done.");
  assert.equal(result.signals.length, 0);
  assert.equal(result.invalidSignal, true);
}

function testMalformedTerminalSignalIsStripped() {
  const result = extractAgentDockSignals("Done.\n<!-- agent-dock:deep-memory axes=care | missing close");
  const activity = formatInvalidAgentDockSignalActivity(result);

  assert.equal(result.visibleText, "Done.");
  assert.equal(result.signals.length, 0);
  assert.equal(result.invalidSignal, true);
  assert.equal(activity.kind, "activity");
  assert(activity.detail.includes("missing close"));
}

function testFormatsNotice() {
  const result = extractAgentDockSignals("Done.\n<!-- agent-dock:deep-memory | Keep this subtle. -->");
  const notice = formatAgentDockSignalNotice(result.signals[0], {}, "codex", translate);

  assert.equal(notice.kind, "notice");
  assert.equal(notice.noticeType, "deep_memory_candidate");
  assert.equal(notice.title, "Deep memory candidate");
  assert.equal(notice.detail, "Keep this subtle.");
}

function testFormatsMemoryCandidateNotice() {
  const result = extractAgentDockSignals(
    "Done.\n<!-- agent-dock:memory kind=task scope=project | Verified the complete test suite. -->"
  );
  const notice = formatAgentDockSignalNotice(result.signals[0], {}, "codex", translate);

  assert.equal(notice.kind, "notice");
  assert.equal(notice.noticeType, "memory_candidate");
  assert.equal(notice.title, "Memory candidate");
  assert.equal(notice.detail, "Verified the complete test suite.");
}

function testFormatsSupplementalSignalNotice() {
  const result = extractAgentDockSignals(
    "Done.\n<!-- agent-dock:affect tone=focused | The final answer stayed focused. -->"
  );
  const notice = formatAgentDockSignalNotice(result.signals[0], {}, "codex", translate);

  assert.equal(notice.noticeType, "affect_candidate");
  assert.equal(notice.title, "Affect candidate");
  assert.strictEqual(notice.agentDockSignal, result.signals[0]);
}

function testFormatsOneUnifiedReflectionNotice() {
  const result = extractAgentDockSignals(
    `Done.\n<!-- agent-dock:reflection | ${JSON.stringify({
      evidence: ["Done."],
      affect: { tone: "focused", confidence: 0.5, why: "The answer was focused." },
      salience: { axes: ["craft"], confidence: 0.5, why: "Craft mattered." }
    })} -->`
  );
  const notice = formatAgentDockReflectionNotice(result.signals, {}, "codex", translate);

  assert.equal(notice.noticeType, "reflection_candidate");
  assert.equal(notice.kind, "activity");
  assert.equal(notice.noticeGroupId, "agent_dock_reflection");
  assert.equal(notice.noticeItemCount, 2);
  assert.equal(notice.insertBeforeLastContent, true);
  assert.equal(notice.title, "Continuity reflection");
  assert.equal(notice.agentDockSignals.length, 2);
  assert.equal(notice.auditItems.length, 2);
  assert.equal(notice.auditItems[0].title, "Outcome · Affect");
  assert(notice.auditItems[0].fields.some((field) => field.label === "Tone rationale"));
  assert(notice.auditItems[1].fields.some((field) => field.label === "Salience rationale"));
  assert(notice.auditItems[0].fields.some((field) => field.label === "Evidence" && field.value.includes("Done.")));
  assert(notice.auditItems[0].fields.some((field) => field.label === "Evidence" && field.value.includes("Unknown origin")), "legacy string evidence should remain auditable as unknown origin");
  assert(notice.auditItems[0].fields.some((field) => field.label === "Confidence" && field.value === "0.5"));
}

function testReflectionAuditRedactsSensitiveLiveFields() {
  const notice = formatAgentDockReflectionNotice([{
    envelope: "reflection_v1",
    phase: "outcome",
    type: "affect_candidate",
    text: "The answer remained focused.",
    tone: "focused",
    evidenceRefs: [{
      origin: "assistant_message",
      speaker: "assistant",
      quote: "api_key=sk-live-secret"
    }],
    reflectionSource: {
      kind: "content",
      visibleText: "The result included api_key=sk-live-secret.",
      rawText: "The result included api_key=sk-live-secret.<!-- agent-dock:reflection -->"
    }
  }], {}, "codex", translate);

  const fields = notice.auditItems[0].fields;
  for (const label of ["Evidence", "Filtered source text", "Complete pre-filter source"]) {
    const field = fields.find((item) => item.label === label);
    assert.equal(field.value, "[Sensitive content omitted]", `${label} should be redacted before live rendering`);
  }
}

function testReflectionAuditUsesSignalSpecificTextLabels() {
  const notice = formatAgentDockReflectionNotice([
    { envelope: "reflection_v1", phase: "outcome", type: "memory_candidate", text: "Remember this." },
    { envelope: "reflection_v1", phase: "outcome", type: "deep_memory", text: "This mattered." },
    { envelope: "reflection_v1", phase: "appraisal", type: "interaction_candidate", text: "Respond directly." },
    { envelope: "reflection_v1", phase: "appraisal", type: "affect_candidate", text: "Confidence is warranted." },
    { envelope: "reflection_v1", phase: "appraisal", type: "salience_observation", text: "Craft matters." },
    { envelope: "reflection_v1", phase: "outcome", type: "future_signal", text: "Explain the signal." }
  ], {}, "codex", translate);

  const labels = notice.auditItems.map((item) => item.fields[2].label);
  assert.deepEqual(labels, [
    "Memory content",
    "Memory summary",
    "Response strategy",
    "Tone rationale",
    "Salience rationale",
    "Signal description"
  ]);
}

function testLeadingReflectionIsParsedBeforeVisibleContentRelease() {
  const actions = [];
  let capturedSignals = [];
  let completedSignals = [];
  const appraisal = {
    evidence: ["The answer should be careful."],
    affect: {
      tone: "serious",
      confidence: 0.55,
      why: "The request calls for care."
    }
  };
  const filter = new ReflectionContentFilter({
    onAppraisal: (signals) => {
      capturedSignals = signals;
      actions.push(`notice:${signals[0].phase}`);
    },
    onSourceComplete: (signals) => {
      completedSignals = signals;
    }
  });

  filter.beginSource("commentary");
  assert.deepEqual(filter.push("<!-- agent-dock:reflection phase=appraisal | "), []);
  const visibleChunks = filter.push(`${JSON.stringify(appraisal)} -->\nVisible`);
  const laterChunks = filter.push(" answer.");
  for (const chunk of visibleChunks.concat(laterChunks, filter.flush())) {
    actions.push(`content:${chunk.trim()}`);
  }
  filter.endSource();

  assert.deepEqual(actions, ["notice:appraisal", "content:Visible answer."]);
  assert.equal(capturedSignals[0].reflectionSource.kind, "commentary");
  assert.equal(capturedSignals[0].reflectionSource.visibleText.trim(), "Visible answer.");
  assert(capturedSignals[0].reflectionSource.rawText.includes("agent-dock:reflection"));
  assert.strictEqual(completedSignals[0], capturedSignals[0], "source completion should refresh the existing reflection signal");
  const notice = formatAgentDockReflectionNotice(capturedSignals, {}, "codex", translate);
  const fields = notice.auditItems[0].fields;
  assert(fields.some((field) => field.label === "Host message" && field.value === "Commentary progress message"));
  assert(fields.some((field) => field.label === "Filtered source text" && field.value === "Visible answer."));
  assert(fields.some((field) => field.label === "Complete pre-filter source" && field.debugOnly === true));
}

function testOrdinaryContentIsReleasedWithoutReflectionDelay() {
  const filter = new ReflectionContentFilter({ visibleTailChars: 8 });
  const raw = "Ordinary answer with enough text to release most content immediately.";
  const streamed = filter.push(raw);
  assert(streamed.join("").length > 0, "ordinary long content should continue streaming");
  assert.equal(streamed.concat(filter.flush()).join(""), raw);
}

function testTerminalOutcomeIsHiddenAndNoticedBeforeFinalContent() {
  const actions = [];
  const outcome = {
    evidence: ["The implementation is complete."],
    affect: {
      tone: "celebratory",
      confidence: 0.6,
      why: "A meaningful implementation finished."
    }
  };
  const filter = new ReflectionContentFilter({
    visibleTailChars: 12,
    onOutcome: (signals) => actions.push(`notice:${signals[0].phase}`)
  });
  const raw = [
    "The implementation is complete and verified.\n",
    `<!-- agent-dock:reflection phase=outcome | ${JSON.stringify(outcome)} -->`
  ].join("");

  for (const chunk of [raw.slice(0, 31), raw.slice(31, 73), raw.slice(73)]) {
    for (const visibleText of filter.push(chunk)) {
      actions.push(`content:${visibleText}`);
    }
  }
  for (const visibleText of filter.flush()) {
    actions.push(`content:${visibleText}`);
  }

  const visible = actions
    .filter((action) => action.startsWith("content:"))
    .map((action) => action.slice("content:".length))
    .join("");
  assert.equal(visible, "The implementation is complete and verified.");
  assert(!visible.includes("agent-dock:reflection"), "terminal protocol text must not enter visible content");
  assert.equal(actions.at(-2), "notice:outcome", "outcome notice should precede the held final content chunk");
  assert(actions.at(-1).startsWith("content:"), "final visible content should remain the last streamed item");
  assert(filter.hasEmitted(extractAgentDockSignals(raw).signals[0]), "streamed outcome should be marked for completion-time de-duplication");
}

function testNonTerminalReflectionTextIsReleased() {
  const filter = new ReflectionContentFilter({ visibleTailChars: 8 });
  const raw = "Before <!-- agent-dock:reflection phase=outcome | {} --> after";
  const visible = filter.push(raw).concat(filter.flush()).join("");
  assert.equal(visible, raw, "a non-terminal reflection-like comment should remain ordinary content");
}

function testInvalidAndVariantLeadingReflectionsStayOutOfMarkdown() {
  for (const raw of [
    "<!-- agent-dock:reflection phase=appraisal | {} -->\nVisible answer.",
    "<!-- agent-dock:reflection phase=appraisal | {bad json} -->\nVisible answer.",
    `<!--  AGENT-DOCK:REFLECTION phase=appraisal | ${JSON.stringify({
      evidence: ["Visible request"],
      affect: { tone: "focused", why: "Stay focused." }
    })} -->\nVisible answer.`
  ]) {
    const filter = new ReflectionContentFilter({ visibleTailChars: 8 });
    const visible = filter.push(raw).concat(filter.flush()).join("");
    assert.equal(visible.trim(), "Visible answer.");
    assert(!visible.includes("agent-dock:reflection"));
    assert(!visible.includes("AGENT-DOCK:REFLECTION"));
  }
}

function testNewSourceRecognizesLeadingAppraisalAfterCommentary() {
  const appraisals = [];
  const filter = new ReflectionContentFilter({
    visibleTailChars: 8,
    onAppraisal: (signals) => appraisals.push(...signals)
  });
  filter.beginSource("commentary");
  const commentary = filter.push("Visible progress.").concat(filter.flush()).join("");
  filter.endSource();

  const envelope = {
    evidence: [{ origin: "user_message", speaker: "user", quote: "Visible request" }],
    affect: { tone: "focused", why: "Stay focused." }
  };
  filter.beginSource("content");
  const content = filter.push(
    `<!-- agent-dock:reflection phase=appraisal | ${JSON.stringify(envelope)} -->\nVisible answer.`
  ).concat(filter.flush()).join("");
  filter.endSource();

  assert.equal(commentary, "Visible progress.");
  assert.equal(content.trim(), "Visible answer.");
  assert.equal(appraisals.length, 1);
  assert.equal(appraisals[0].reflectionSource.kind, "content");
}

function testEvidenceOriginsUseTheirOwnContext() {
  const signal = {
    text: "Remember the architecture decision.",
    evidenceRefs: [{
      origin: "recalled_memory",
      speaker: "none",
      quote: "Keep architecture docs updated."
    }]
  };
  assert.equal(hasGroundedAgentSignal(signal, {
    user_message: "Please continue.",
    recalled_memory: "Keep architecture docs updated."
  }), true);
  assert.equal(hasGroundedAgentSignal(signal, {
    user_message: "Keep architecture docs updated.",
    recalled_memory: "Different memory."
  }), false, "a recalled-memory quote must not be grounded by the user message");
}

testExtractsTerminalDeepMemoryComment();
testIgnoresNonTerminalComment();
testExtractsGroundedMemoryCandidateShape();
testRejectsUnsupportedMemoryCandidateShape();
testExtractsSupplementalContinuitySignals();
testRejectsUnsupportedSupplementalSignals();
testExtractsUnifiedReflectionEnvelope();
testRejectsReflectionWithoutEvidenceOrValidSections();
testEvidenceSpeakerIsNormalizedAgainstOrigin();
testExtractsLeadingAppraisalAndTerminalOutcome();
testInvalidTypeIsStrippedWithoutSignal();
testMalformedTerminalSignalIsStripped();
testFormatsNotice();
testFormatsMemoryCandidateNotice();
testFormatsSupplementalSignalNotice();
testFormatsOneUnifiedReflectionNotice();
testReflectionAuditRedactsSensitiveLiveFields();
testReflectionAuditUsesSignalSpecificTextLabels();
testLeadingReflectionIsParsedBeforeVisibleContentRelease();
testOrdinaryContentIsReleasedWithoutReflectionDelay();
testTerminalOutcomeIsHiddenAndNoticedBeforeFinalContent();
testNonTerminalReflectionTextIsReleased();
testInvalidAndVariantLeadingReflectionsStayOutOfMarkdown();
testNewSourceRecognizesLeadingAppraisalAfterCommentary();
testEvidenceOriginsUseTheirOwnContext();

console.log("Agent signal tests passed.");
