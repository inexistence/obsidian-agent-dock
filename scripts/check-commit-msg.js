#!/usr/bin/env node

const fs = require("fs");

const messageFile = process.argv[2];

const allowedTypes = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

function fail(lines) {
  console.error(["Invalid commit message.", "", ...lines].join("\n"));
  process.exit(1);
}

if (!messageFile) {
  fail(["Usage: node scripts/check-commit-msg.js <commit-msg-file>"]);
}

let rawMessage;
try {
  rawMessage = fs.readFileSync(messageFile, "utf8");
} catch (error) {
  fail([`Could not read commit message file: ${error.message}`]);
}

const firstLine = rawMessage
  .split(/\r?\n/)
  .find((line) => line.trim() && !line.trim().startsWith("#"));

if (!firstLine) {
  fail(["Commit message cannot be empty."]);
}

const trimmed = firstLine.trim();
const allowedPrefixes = [
  /^Merge\b/,
  /^Revert\b/,
  /^fixup! /,
  /^squash! /,
];

if (allowedPrefixes.some((pattern) => pattern.test(trimmed))) {
  process.exit(0);
}

const typePattern = allowedTypes.join("|");
const conventionalPattern = new RegExp(
  `^(${typePattern})(\\([a-z0-9-]+\\))?!?: .+$`,
);

if (!conventionalPattern.test(trimmed)) {
  fail([
    "Use Conventional Commits:",
    "",
    "  <type>(optional-scope): <description>",
    "",
    `Allowed types: ${allowedTypes.join(", ")}`,
    "",
    "Examples:",
    "  feat(view): add copy button",
    "  fix(codex): handle empty json events",
    "  docs: document commit rules",
    "  feat(settings)!: remove legacy ask mode",
  ]);
}

if (trimmed.length > 100) {
  fail([
    "Keep the first line at 100 characters or fewer.",
    `Current length: ${trimmed.length}`,
  ]);
}

process.exit(0);
