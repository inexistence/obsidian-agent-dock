# Agent Dock Development Guide

Agent Dock is a desktop-only Obsidian community plugin that runs local Agent
CLIs in the right sidebar. It supports Codex and Cursor today and keeps provider
parsing behind adapters.

## Build and verify

- Obsidian loads `main.js`; do not edit it directly.
- Source lives under `src/`.
- Rebuild with `node scripts/build-main.js`.
- Run `node scripts/test-all.js` before handoff.
- Keep generated `main.js` with every source change.

## Main boundaries

- `src/plugin.js`: lifecycle, commands, settings, provider diagnostics, storage.
- `src/agents/AgentRegistry.js`: provider descriptors and CLI diagnostics.
- `src/agents/shared/TurnContextBuilder.js`: shared bounded prompt construction.
- `src/agents/codex/`: Codex process and JSONL event mapping.
- `src/agents/cursor/`: Cursor ACP client, modes, and event mapping.
- `src/view/AgentDockView.js`: provider-agnostic sidebar and sessions.
- `src/view/turn/TurnToneCapsule.js`: pure local current-turn capsule rules.
- `src/view/turn/TurnStatusController.js`: timing and transition policy.
- `src/storage/ChatStorage.js`: bounded local chat persistence.
- `src/prompt.js`: workspace boundary, references, conversation, request, budget.
- `styles.css`: compact Obsidian sidebar styling and reduced-motion behavior.

## Product invariants

- Default mode is `readOnly`; `workspaceWrite` requires first-use confirmation.
- Do not add Full access or an interactive Terminal launcher.
- Do not add memory, persona, affect continuity, reflection protocols, hidden
  profiling, cloud indexing, or telemetry.
- Tone capsules use only the current request and visible current-turn events.
  They never enter prompts or persistence and never read hidden reasoning,
  debug activity, or complete command output.
- Referenced paths are inspection targets; providers read actual contents with
  local tools. Do not build a plugin-level vault index.
- File changes normalize to `toolType: "file_change"` with bounded `paths`.
- Provider-specific parsing stays out of the view.

## Timeline contract

Adapters emit only `content`, `reasoning`, `tool`, `error`, `notice`, and
debug-only `activity`. Only `content` is answer text. Live events stay in one
processing group; after completion, the last content entry is the final answer
and earlier visible events collapse under the processed section.

## Git hygiene

- Preserve unrelated user changes.
- Keep commits focused and use Conventional Commits when asked to commit.
- Review staged changes for privacy, security, data loss, and missing docs/tests.
- Install hooks with `sh scripts/install-git-hooks.sh`.
