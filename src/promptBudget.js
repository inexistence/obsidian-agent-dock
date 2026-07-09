const DEFAULT_MIN_CONVERSATION_CHARS = 1000;

function planPromptSections(sections, contextLimit, options = {}) {
  const limit = normalizeLimit(contextLimit);
  const minConversationChars = normalizeMinChars(
    options.minConversationChars,
    DEFAULT_MIN_CONVERSATION_CHARS
  );
  const plannedSections = normalizeSections(sections);
  const originalSectionsLength = getSectionsLength(plannedSections);
  const droppedSections = [];
  const truncatedSections = [];
  let includedSections = plannedSections.slice();

  while (
    limit
    && getSectionsLength(includedSections) + minConversationChars > limit
  ) {
    const truncateIndex = findTruncateCandidateIndex(includedSections);
    if (truncateIndex === -1) {
      break;
    }

    const section = includedSections[truncateIndex];
    const overBy = getSectionsLength(includedSections) + minConversationChars - limit;
    const removableChars = section.text.length - section.minChars;
    const targetLength = section.text.length - Math.min(overBy, removableChars);

    includedSections[truncateIndex] = Object.assign({}, section, {
      text: truncateSectionText(section.text, targetLength)
    });
    truncatedSections.push(section.name);
  }

  while (
    limit
    && getSectionsLength(includedSections) + minConversationChars > limit
  ) {
    const dropIndex = findDropCandidateIndex(includedSections);
    if (dropIndex === -1) {
      break;
    }
    const [dropped] = includedSections.splice(dropIndex, 1);
    droppedSections.push(dropped.name);
  }

  const usedChars = getSectionsLength(includedSections);
  return {
    sections: includedSections,
    sectionText: includedSections.map((section) => section.text).filter(Boolean).join("\n"),
    conversationBudget: limit
      ? Math.max(minConversationChars, limit - usedChars)
      : 0,
    droppedSections,
    truncatedSections,
    removedChars: Math.max(0, originalSectionsLength - usedChars)
  };
}

function normalizeLimit(contextLimit) {
  return Number(contextLimit) || 0;
}

function normalizeMinChars(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeSections(sections) {
  return (Array.isArray(sections) ? sections : [])
    .filter((section) => section && section.text)
    .map((section, index) => ({
      name: String(section.name || `section-${index}`),
      text: String(section.text || ""),
      priority: Number.isFinite(Number(section.priority)) ? Number(section.priority) : 0,
      optional: section.optional === true,
      protected: section.protected === true,
      truncatable: section.truncatable === true,
      minChars: normalizeMinChars(section.minChars, 400),
      order: index
    }));
}

function findTruncateCandidateIndex(sections) {
  let candidateIndex = -1;
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (!section.truncatable || section.text.length <= section.minChars) {
      continue;
    }
    if (
      candidateIndex === -1
      || section.priority < sections[candidateIndex].priority
      || (
        section.priority === sections[candidateIndex].priority
        && section.order > sections[candidateIndex].order
      )
    ) {
      candidateIndex = index;
    }
  }
  return candidateIndex;
}

function findDropCandidateIndex(sections) {
  let candidateIndex = -1;
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (!section.optional || section.protected) {
      continue;
    }
    if (
      candidateIndex === -1
      || section.priority < sections[candidateIndex].priority
      || (
        section.priority === sections[candidateIndex].priority
        && section.order > sections[candidateIndex].order
      )
    ) {
      candidateIndex = index;
    }
  }
  return candidateIndex;
}

function getSectionsLength(sections) {
  return sections.reduce((sum, section, index) => (
    sum + section.text.length + (index > 0 ? 1 : 0)
  ), 0);
}

function truncateSectionText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  const marker = "\n[Section truncated to fit the configured context character limit.]";
  if (maxChars <= marker.length + 3) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - marker.length)}${marker}`;
}

module.exports = {
  planPromptSections
};
