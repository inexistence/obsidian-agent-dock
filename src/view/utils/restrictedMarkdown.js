function toRestrictedMarkdown(value) {
  const protectedSegments = [];
  const source = String(value || "");
  const protectedText = protectCodeSegments(source, protectedSegments);
  const restrictedText = neutralizeMediaEmbeds(protectedText)
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return restoreCodeSegments(restrictedText, protectedSegments);
}

function neutralizeMediaEmbeds(text) {
  return text.replace(/(^|[^\\])((?:\\\\)*)!\[/g, (match, prefix, slashes) => (
    `${prefix}${slashes}\\![`
  ));
}

function protectCodeSegments(text, segments) {
  return text
    .replace(/(```[^\n]*\n[\s\S]*?\n```|~~~[^\n]*\n[\s\S]*?\n~~~)/g, (match) => createPlaceholder(match, segments))
    .replace(/(`+)([^\n]*?)\1/g, (match) => createPlaceholder(match, segments));
}

function createPlaceholder(value, segments) {
  const index = segments.push(value) - 1;
  return `\u0000agent-dock-code-${index}\u0000`;
}

function restoreCodeSegments(text, segments) {
  return text.replace(/\u0000agent-dock-code-(\d+)\u0000/g, (match, index) => (
    segments[Number(index)] === undefined ? match : segments[Number(index)]
  ));
}

module.exports = {
  toRestrictedMarkdown
};
