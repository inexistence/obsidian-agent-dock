const { hasExactVisibleSignalEvidence } = require("./signalEvidence");

function getClaimedMemoryRefs(signals, manifest) {
  const claimed = new Set();
  for (const signal of Array.isArray(signals) ? signals : []) {
    for (const evidence of Array.isArray(signal?.evidenceRefs) ? signal.evidenceRefs : []) {
      if (evidence?.origin !== "recalled_memory" || !evidence.ref) {
        continue;
      }
      const memory = manifest?.[evidence.ref];
      if (!memory || !isEvidenceGroundedInManifest(evidence, memory)) {
        continue;
      }
      claimed.add(evidence.ref);
    }
  }
  return Array.from(claimed).slice(0, 12);
}

function isEvidenceGroundedInManifest(evidence, memory) {
  const visible = [
    memory?.text,
    ...(Array.isArray(memory?.evidenceRefs) ? memory.evidenceRefs.map((item) => item?.quote) : [])
  ].filter(Boolean);
  return hasExactVisibleSignalEvidence(evidence?.quote, ...visible);
}

function emitClaimedMemoryProvenance(onUpdate, signals, manifest) {
  const claimedUsedRefs = getClaimedMemoryRefs(signals, manifest);
  if (claimedUsedRefs.length === 0 || typeof onUpdate !== "function") {
    return;
  }
  onUpdate({
    internalOnly: true,
    memoryProvenance: {
      available: Object.entries(manifest || {}).map(([ref, item]) => ({
        ref,
        memoryId: item.memoryId
      })),
      claimedUsedRefs
    }
  });
}

module.exports = {
  emitClaimedMemoryProvenance,
  getClaimedMemoryRefs,
  _test: {
    isEvidenceGroundedInManifest
  }
};
