const MODE_OPTIONS = {
  readOnly: {
    label: "Read only",
    description: "Inspect vault files but do not write.",
    args: ["--sandbox", "read-only"]
  },
  workspaceWrite: {
    label: "Workspace write",
    description: "Allow edits inside the vault or configured working directory.",
    args: ["--sandbox", "workspace-write", "--skip-git-repo-check"]
  }
};

function applyModeArgs(args, mode, defaultMode) {
  const modeConfig = MODE_OPTIONS[mode] || MODE_OPTIONS[defaultMode] || MODE_OPTIONS.readOnly;
  const sanitizedArgs = stripUnsupportedAccessArgs(args);
  const execIndex = sanitizedArgs.indexOf("exec");
  if (execIndex < 0) {
    return ["exec", ...modeConfig.args, ...sanitizedArgs];
  }

  const additions = [];
  const hasSkipGitRepoCheck = sanitizedArgs.includes("--skip-git-repo-check");

  for (let index = 0; index < modeConfig.args.length; index += 1) {
    const flag = modeConfig.args[index];
    const value = modeConfig.args[index + 1];
    if (flag === "--sandbox") {
      additions.push(flag, value);
      index += 1;
    } else if (flag === "--skip-git-repo-check" && !hasSkipGitRepoCheck) {
      additions.push(flag);
    }
  }

  return [...sanitizedArgs.slice(0, execIndex + 1), ...additions, ...sanitizedArgs.slice(execIndex + 1)];
}

function stripUnsupportedAccessArgs(args) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (
      value === "--dangerously-bypass-approvals-and-sandbox"
      || String(value).startsWith("--dangerously-bypass-approvals-and-sandbox=")
      || value === "--yolo"
      || value === "--full-auto"
    ) {
      continue;
    }
    if (value === "--sandbox" || value === "-s") {
      index += 1;
      continue;
    }
    if (String(value).startsWith("--sandbox=") || String(value).startsWith("-s=")) {
      continue;
    }
    result.push(value);
  }
  return result;
}

function getModeLabel(mode, defaultMode, translate) {
  const resolved = MODE_OPTIONS[mode] ? mode : MODE_OPTIONS[defaultMode] ? defaultMode : "readOnly";
  return translate ? translate(`mode.${resolved}.label`) : MODE_OPTIONS[resolved].label;
}

function getModeDescription(mode, defaultMode, translate) {
  const resolved = MODE_OPTIONS[mode] ? mode : MODE_OPTIONS[defaultMode] ? defaultMode : "readOnly";
  return translate ? translate(`mode.${resolved}.description`) : MODE_OPTIONS[resolved].description;
}

module.exports = { MODE_OPTIONS, applyModeArgs, getModeDescription, getModeLabel, _test: { stripUnsupportedAccessArgs } };
