const { extractAgentDockSignals } = require("./agentSignals");

const REFLECTION_PREFIX = "<!-- agent-dock:reflection";
const COMPACT_REFLECTION_PREFIX = "<!--agent-dock:reflection";
const REFLECTION_CANDIDATE_PATTERN = /<!--\s*agent-dock:reflection/i;
const DEFAULT_MAX_PREFIX_CHARS = 4096;
const DEFAULT_VISIBLE_TAIL_CHARS = 64;

class ReflectionContentFilter {
  constructor(options = {}) {
    this.onAppraisal = options.onAppraisal || (() => {});
    this.onOutcome = options.onOutcome || (() => {});
    this.onSourceComplete = options.onSourceComplete || (() => {});
    this.maxPrefixChars = Number(options.maxPrefixChars) || DEFAULT_MAX_PREFIX_CHARS;
    this.visibleTailChars = Number(options.visibleTailChars) || DEFAULT_VISIBLE_TAIL_CHARS;
    this.buffer = "";
    this.state = "leading_appraisal";
    this.candidateOffset = -1;
    this.emittedSignalKeys = new Set();
    this.sourceKind = "content";
    this.sourceRawText = "";
    this.sourceSnapshot = { kind: "content", rawText: "", visibleText: "" };
    this.sourceSignals = [];
  }

  beginSource(kind = "content") {
    this.buffer = "";
    this.state = "leading_appraisal";
    this.candidateOffset = -1;
    this.sourceKind = kind === "commentary" ? "commentary" : "content";
    this.sourceRawText = "";
    this.sourceSnapshot = { kind: this.sourceKind, rawText: "", visibleText: "" };
    this.sourceSignals = [];
  }

  endSource() {
    this.refreshSourceSnapshot(true);
    if (this.sourceSignals.length > 0) {
      this.onSourceComplete(this.sourceSignals);
    }
    this.sourceKind = "content";
    this.sourceRawText = "";
    this.sourceSnapshot = { kind: "content", rawText: "", visibleText: "" };
    this.sourceSignals = [];
  }

  push(text) {
    const chunk = String(text || "");
    if (!chunk) {
      return [];
    }

    this.sourceRawText += chunk;
    this.refreshSourceSnapshot(false);
    this.buffer += chunk;
    if (this.state === "leading_appraisal") {
      return this.processLeadingAppraisal();
    }
    if (this.state === "terminal_outcome") {
      return this.processTerminalCandidate();
    }
    return this.processVisibleBody();
  }

  flush() {
    if (!this.buffer) {
      return [];
    }

    if (this.state === "leading_appraisal") {
      const leadingChunks = this.processLeadingAppraisal(true);
      if (this.state === "terminal_outcome") {
        return leadingChunks.concat(this.finishTerminalCandidate());
      }
      if (this.state === "visible_body") {
        return leadingChunks.concat(this.releaseBuffer());
      }
      return leadingChunks;
    }
    if (this.state === "terminal_outcome") {
      return this.finishTerminalCandidate();
    }
    return this.releaseBuffer();
  }

  processLeadingAppraisal(force = false) {
    const trimmed = this.buffer.trimStart();
    if (!couldBeLeadingReflection(trimmed)) {
      this.state = "visible_body";
      return this.processVisibleBody();
    }

    const closeIndex = this.buffer.indexOf("-->");
    if (closeIndex === -1) {
      if (!force && this.buffer.length <= this.maxPrefixChars) {
        return [];
      }
      this.state = "visible_body";
      return this.processVisibleBody();
    }

    const prefixEnd = closeIndex + 3;
    const prefixText = this.buffer.slice(0, prefixEnd);
    const parsed = extractAgentDockSignals(prefixText);
    if (!parsed.rawSignalText || parsed.visibleText.trim()) {
      this.state = "visible_body";
      return this.processVisibleBody();
    }

    const appraisalSignals = parsed.signals.filter((signal) => signal.phase === "appraisal");
    if (appraisalSignals.length > 0) {
      this.attachSource(appraisalSignals);
      this.markEmitted(appraisalSignals);
      this.onAppraisal(appraisalSignals);
    }
    this.buffer = this.buffer.slice(prefixEnd);
    this.state = "visible_body";
    return this.processVisibleBody();
  }

  processVisibleBody() {
    const candidateIndex = findReflectionCandidate(this.buffer);
    if (candidateIndex !== -1) {
      const holdStart = Math.max(0, candidateIndex - this.visibleTailChars);
      const visible = this.buffer.slice(0, holdStart);
      this.buffer = this.buffer.slice(holdStart);
      this.candidateOffset = candidateIndex - holdStart;
      this.state = "terminal_outcome";
      const chunks = visible ? [visible] : [];
      return chunks.concat(this.processTerminalCandidate());
    }

    const holdChars = Math.max(this.visibleTailChars, REFLECTION_PREFIX.length - 1);
    if (this.buffer.length <= holdChars) {
      return [];
    }
    const releaseLength = this.buffer.length - holdChars;
    const visible = this.buffer.slice(0, releaseLength);
    this.buffer = this.buffer.slice(releaseLength);
    return visible ? [visible] : [];
  }

  processTerminalCandidate() {
    const closeIndex = this.buffer.indexOf("-->", this.candidateOffset);
    if (closeIndex === -1) {
      if (this.buffer.length - this.candidateOffset <= this.maxPrefixChars) {
        return [];
      }
      return this.rejectTerminalCandidate();
    }

    const remainder = this.buffer.slice(closeIndex + 3);
    if (remainder.trim()) {
      return this.rejectTerminalCandidate();
    }
    return [];
  }

  finishTerminalCandidate() {
    const parsed = extractAgentDockSignals(this.buffer);
    const outcomeSignals = parsed.signals.filter((signal) => signal.phase === "outcome");
    if (outcomeSignals.length > 0) {
      this.attachSource(outcomeSignals);
      this.markEmitted(outcomeSignals);
      this.onOutcome(outcomeSignals);
    }
    const visible = parsed.rawSignalText
      ? parsed.visibleText
      : this.buffer;
    this.buffer = "";
    this.candidateOffset = -1;
    this.state = "visible_body";
    return visible ? [visible] : [];
  }

  rejectTerminalCandidate() {
    const releaseEnd = this.candidateOffset + 1;
    const visible = this.buffer.slice(0, releaseEnd);
    this.buffer = this.buffer.slice(releaseEnd);
    this.candidateOffset = -1;
    this.state = "visible_body";
    return (visible ? [visible] : []).concat(this.processVisibleBody());
  }

  releaseBuffer() {
    const text = this.buffer;
    this.buffer = "";
    return text ? [text] : [];
  }

  markEmitted(signals) {
    for (const signal of signals) {
      this.emittedSignalKeys.add(getSignalKey(signal));
    }
  }

  hasEmitted(signal) {
    return this.emittedSignalKeys.has(getSignalKey(signal));
  }

  attachSource(signals) {
    this.refreshSourceSnapshot(true);
    for (const signal of signals) {
      signal.reflectionSource = this.sourceSnapshot;
      this.sourceSignals.push(signal);
    }
  }

  refreshSourceSnapshot(includeVisibleText) {
    this.sourceSnapshot.kind = this.sourceKind;
    this.sourceSnapshot.rawText = this.sourceRawText;
    if (includeVisibleText) {
      this.sourceSnapshot.visibleText = extractAgentDockSignals(this.sourceRawText).visibleText;
    }
  }
}

function couldBeLeadingReflection(text) {
  if (!text) {
    return true;
  }
  const normalized = String(text)
    .toLowerCase()
    .replace(/^<!--\s*/, "<!--");
  return COMPACT_REFLECTION_PREFIX.startsWith(normalized)
    || normalized.startsWith(COMPACT_REFLECTION_PREFIX);
}

function findReflectionCandidate(text) {
  const match = String(text || "").match(REFLECTION_CANDIDATE_PATTERN);
  return match ? match.index : -1;
}

function getSignalKey(signal) {
  return `${signal?.phase || ""}\u0000${signal?.raw || ""}`;
}

module.exports = {
  ReflectionContentFilter,
  _test: {
    couldBeLeadingReflection,
    findReflectionCandidate
  }
};
