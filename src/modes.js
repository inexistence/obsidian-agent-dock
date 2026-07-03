const MODE_OPTIONS = {
  readOnly: {
    label: "Read only",
    description: "Inspect vault files but do not write.",
    args: ["--sandbox", "read-only"]
  },
  workspaceWrite: {
    label: "Workspace write",
    description: "Allow edits inside the vault or working directory.",
    args: ["--sandbox", "workspace-write", "--skip-git-repo-check"]
  },
  fullAccess: {
    label: "Full access",
    description: "Allow broad local access. Use carefully.",
    args: ["--sandbox", "danger-full-access", "--skip-git-repo-check"]
  }
};

function applyModeArgs(args, mode, defaultMode) {
  const modeConfig = MODE_OPTIONS[mode] || MODE_OPTIONS[defaultMode];
  const execIndex = args.indexOf("exec");
  if (execIndex < 0) {
    return args;
  }

  const additions = [];
  const hasSandbox = args.includes("--sandbox") || args.includes("-s");
  const hasDangerBypass = args.includes("--dangerously-bypass-approvals-and-sandbox");
  const hasSkipGitRepoCheck = args.includes("--skip-git-repo-check");

  for (let index = 0; index < modeConfig.args.length; index += 1) {
    const flag = modeConfig.args[index];
    const value = modeConfig.args[index + 1];

    if (flag === "--sandbox") {
      if (!hasSandbox && !hasDangerBypass) {
        additions.push(flag, value);
      }
      index += 1;
      continue;
    }

    if (flag === "--skip-git-repo-check" && !hasSkipGitRepoCheck) {
      additions.push(flag);
    }
  }

  return [
    ...args.slice(0, execIndex + 1),
    ...additions,
    ...args.slice(execIndex + 1)
  ];
}

function getModeLabel(mode, defaultMode, translate) {
  const resolvedMode = MODE_OPTIONS[mode] ? mode : defaultMode;
  const option = MODE_OPTIONS[resolvedMode] || MODE_OPTIONS.readOnly;
  return translate ? translate(`mode.${resolvedMode}.label`) : option.label;
}

function getModeDescription(mode, defaultMode, translate) {
  const resolvedMode = MODE_OPTIONS[mode] ? mode : defaultMode;
  const option = MODE_OPTIONS[resolvedMode] || MODE_OPTIONS.readOnly;
  return translate ? translate(`mode.${resolvedMode}.description`) : option.description;
}

module.exports = {
  MODE_OPTIONS,
  applyModeArgs,
  getModeLabel,
  getModeDescription
};
