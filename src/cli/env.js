function buildCliPath(existingPath) {
  const pathParts = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ];

  for (const part of (existingPath || "").split(":")) {
    if (part && !pathParts.includes(part)) {
      pathParts.push(part);
    }
  }

  return pathParts.join(":");
}

module.exports = {
  buildCliPath
};
