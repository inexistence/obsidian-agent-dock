function applyVisibleEventPolicy(update, mode, translate = (key) => key) {
  if (mode !== "readOnly" || update?.kind !== "tool" || update.toolType !== "file_change") {
    return update;
  }
  return {
    kind: "error",
    title: translate("notice.readOnlyFileChange.title"),
    summary: translate("notice.readOnlyFileChange.summary")
  };
}

module.exports = { applyVisibleEventPolicy };
