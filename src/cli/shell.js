function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function escapeAppleScriptString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
}

module.exports = {
  escapeAppleScriptString,
  shellQuote
};
