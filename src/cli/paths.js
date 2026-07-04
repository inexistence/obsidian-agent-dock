const os = require("os");
const path = require("path");

function expandHomePath(value) {
  const text = String(value || "").trim();
  if (!text) {
    return text;
  }
  if (text === "~") {
    return os.homedir();
  }
  if (text.startsWith("~/")) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text;
}

module.exports = {
  expandHomePath
};
