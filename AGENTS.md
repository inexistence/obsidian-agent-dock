# Agent Dock Development Guide

This repo is an Obsidian community plugin that opens an agent chat dock in the
right sidebar. It currently talks to the local Codex CLI, but the architecture
should stay ready for other agent CLIs such as Claude Code or Cursor.

## Runtime Shape

- Obsidian loads `main.js`.
- Do not edit `main.js` directly for feature work.
- Source files live under `src/`.
- After changing `src/`, rebuild the generated bundle:

  ```sh
  node scripts/build-main.js
  ```

- Keep `main.js` committed after every source change because Obsidian loads it
  directly.

## Important Files

- `src/plugin.js`: Obsidian plugin lifecycle, commands, settings, and view registration.
- `src/view/AgentDockView.js`: sidebar UI, message timeline rendering, copy buttons, Markdown rendering, loading indicator.
- `src/agents/AgentRegistry.js`: provider registry. Add future providers here.
- `src/agents/codex/CodexAgent.js`: Codex CLI process runner.
- `src/agents/codex/jsonEvents.js`: maps Codex JSONL events into the normalized UI event protocol.
- `src/modes.js`: sandbox/mode definitions.
- `src/settings.js`: defaults and settings migration.
- `src/settingsTab.js`: Obsidian settings UI.
- `src/prompt.js`: prompt construction, active note inclusion, and conversation transcript.
- `src/cli/*.js`: CLI argument/env/shell helpers.
- `styles.css`: Obsidian plugin styles.
- `scripts/build-main.js`: zero-dependency bundler for `main.js`.

## Build And Verify

Run these before handing off changes:

```sh
node scripts/build-main.js
node --check main.js
find src scripts -name '*.js' -print -exec node --check {} \;
```

If behavior changes are UI-only, these syntax checks are the current minimum.
There is no formal automated UI test suite yet.

## Codex CLI Integration

The sidebar chat uses:

```sh
codex exec --json --output-last-message <tmp-file> ...
```

The default user-configurable args are:

```sh
exec {{prompt}}
```

`{{prompt}}` is expanded by `src/cli/args.js`. Mode flags are appended by
`src/modes.js`.

Known Codex CLI constraints:

- `codex exec` does not support the old `--ask-for-approval` flag used earlier in this project.
- The plugin uses `--json` for event-level streaming.
- Public `codex exec --json` docs show complete `agent_message` items, not guaranteed token-level text deltas.
- `--output-last-message` is a fallback for final text if no agent message event was captured.
- A completed UI turn is currently detected when the `codex exec` child process closes successfully.

Default executable path:

```sh
/opt/homebrew/bin/codex
```

Users can change this in plugin settings.

## Context Budget And Compression

- `contextLimitChars` defaults to `258000`.
- This is a character budget, not a tokenizer-backed token budget.
- `src/prompt.js` applies the limit while building the prompt.
- Active note content is clipped separately by `activeNoteMaxChars`.
- If conversation history exceeds the remaining budget, older messages are
  compressed into a compact transcript summary.
- The newest message is preserved with highest priority.
- The composer displays an estimated context percentage using local character
  counts. It is intentionally approximate because active note and prompt wrapper
  text are only finalized at send time.
- When actual prompt construction triggers compression, the adapter emits a
  visible `notice` event so the user can see that compression happened.
- Keep this compression deterministic and local; do not call the agent recursively
  just to summarize history unless the project explicitly adds a summarization
  provider later.

## Normalized Agent Events

Agent adapters must emit these UI events:

- `content`: assistant answer text. This is the only event kind treated as answer content.
- `reasoning`: visible reasoning summary/progress, not hidden chain of thought.
- `tool`: command/tool/web/MCP/file-change activity.
- `error`: user-visible failure.
- `notice`: visible system notice such as context compression.
- `activity`: debug or low-level activity. Hidden unless debug activity is enabled.

Do not emit assistant answer text as `message`; `message` is only used for user
timeline entries. This distinction prevents reasoning from being mistaken for
answer content.

## Timeline Rendering Rules

The view stores multiple in-memory chat sessions in `AgentDockView.sessions`.
Each session owns its own `messages` array and context estimate. Session state is
not persisted across Obsidian reloads yet. Keep provider adapters unaware of this
UI session model.

While a turn is running:

- Render events in stream order.
- Consecutive `reasoning`, `tool`, or `error` events are grouped into collapsed sections.
- Content appears inline with those groups.
- The loading indicator stays at the bottom until the whole turn completes or fails.
- The loading indicator is only the animated dots; do not restore the `思考中...` text.

When a turn completes:

- Find the last `content` entry.
- Keep only that final content entry visible outside.
- Collapse everything before it into one `已处理` section, including:
  - previous `content` entries,
  - `reasoning`,
  - `tool`,
  - `error`,
  - debug-visible `activity`.
- Inside `已处理`, keep original order. Consecutive non-content entries of the same kind may be grouped.

Example final rendering:

```text
reasoning A -> tool B -> content C -> reasoning D -> tool E -> content F
```

becomes:

```text
已处理: reasoning A -> tool B -> content C -> reasoning D -> tool E
content F
```

## Content Rendering And Copying

- User and assistant content is rendered through Obsidian `MarkdownRenderer`.
- Copy buttons copy the original Markdown text, not rendered HTML.
- Users must still be able to drag-select partial text, so styles explicitly keep
  content selectable and keep the copy button from intercepting pointer events
  while hidden.
- Tool/debug details stay as plain text/preformatted output. Do not Markdown-render
  shell output by default.

## UI Preferences

- Debug activity is hidden by default.
- Non-debug mode still shows concise reasoning/tool/error status.
- Tool summaries should be useful without enabling debug. Include command names,
  exit codes, or compact outputs where available.
- Avoid noisy activity such as raw stderr in normal mode.
- Use compact controls. This plugin is an operational sidebar, not a landing page.
- Keep text from overlapping controls at narrow sidebar widths.

## Modes

Current modes:

- `readOnly`: inspect files, no writes.
- `workspaceWrite`: allow writes in the workspace/vault.
- `fullAccess`: broad local access.

The old `ask` mode was removed and is migrated to `readOnly` in `src/settings.js`.

## Future Agent Providers

To add a provider:

1. Add an adapter under `src/agents/<provider>/`.
2. Normalize provider events into the event protocol above.
3. Register it in `src/agents/AgentRegistry.js`.
4. Keep view code provider-agnostic.

Do not put provider-specific parsing logic in `AgentDockView.js`.

## TODO

- Add model-assisted context compression as an optional upgrade over the current
  deterministic truncation/summary strategy. It should produce structured session
  state such as user goal, decisions made, current status, constraints, and open
  tasks, then persist that summary separately from raw chat history.

## Local Development Notes

- This plugin is desktop-only because it spawns local CLI processes.
- It is symlinked during local development into an Obsidian vault plugin folder.
- `data.json` is local Obsidian plugin settings and should stay untracked.
- macOS Gatekeeper can block the Codex executable; users can fix this by installing
  Codex from its official source and configuring the executable path.

## Git Hygiene

- The user may have unrelated local changes. Do not revert them.
- Commit generated `main.js` together with source changes.
- Keep commits focused around the requested behavior.
