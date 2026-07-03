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
- `src/storage/ChatStorage.js`: persisted chat session index/body storage.
- `src/storage/MemoryStore.js`: automatic local memory extraction, storage, and retrieval.
- `.agents/skills/code-review-expert/`: project-local reusable code review skill.
- `.agents/skills/commit-hygiene/`: reusable pre-commit review, docs, verification, and Conventional Commit workflow.
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

Install local Git hooks once per clone:

```sh
sh scripts/install-git-hooks.sh
```

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

## Memory

- `memoryEnabled` and `memoryAutoCapture` default to enabled.
- Automatic memories are stored under `memory/memory.json` in the plugin data folder.
- Memory extraction must stay local and deterministic unless a future setting
  explicitly adds a model-assisted memory provider.
- Do not store obvious secrets such as API keys, tokens, passwords, or private keys.
- Prompt injection must label memories as historical notes that may be outdated.
- Emit concise `notice` events when relevant memory is included or automatic
  memory is updated.

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
Each session owns its own `messages` array and context estimate. Provider
adapters must stay unaware of this UI session model.

When chat history persistence is enabled, `data.json` stores settings, the
active session id, and a lightweight session index. Full user and assistant
message bodies are stored separately under the plugin folder in
`sessions/<session-id>.json`. Persisted sessions restore as plain user/assistant
Markdown message content; tool, reasoning, notice, and activity timeline details
are runtime UI events and are not persisted by default.

While a turn is running:

- Render events in stream order.
- Consecutive `reasoning`, `tool`, `notice`, or `error` events are grouped into collapsed sections.
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
- `data.json` is local Obsidian plugin data and should stay untracked.
- `sessions/*.json` contains local persisted chat history and should stay untracked.
- `memory/*.json` contains local automatically extracted memories and should stay untracked.
- macOS Gatekeeper can block the Codex executable; users can fix this by installing
  Codex from its official source and configuring the executable path.

## Git Hygiene

- Use `.agents/skills/commit-hygiene/` for the reusable commit workflow when
  preparing commits; the rules below add project-specific details.
- The user may have unrelated local changes. Do not revert them.
- Commit generated `main.js` together with source changes.
- Keep commits focused around the requested behavior.
- Before committing code changes, review the staged diff for correctness,
  security/privacy risks, data loss risks, and missing verification. If you find
  a serious issue, stop and tell the user before committing.
- Before committing, check whether README, AGENTS.md, settings descriptions, or
  other project documentation need updates for the behavior change. Update docs
  in the same commit when they are part of the requested behavior.
- Install the versioned commit message hook with `sh scripts/install-git-hooks.sh`.
- Use Conventional Commits for commit messages:

  ```text
  <type>(optional-scope): <description>
  ```

- Use these common types:
  - `feat`: user-facing feature or capability.
  - `fix`: bug fix.
  - `docs`: documentation-only change.
  - `style`: formatting or whitespace only; no behavior change.
  - `refactor`: code change that is neither a feature nor a fix.
  - `perf`: performance improvement.
  - `test`: add or update tests.
  - `build`: build system, bundling, or dependency changes.
  - `ci`: CI configuration or workflow changes.
  - `chore`: maintenance that does not affect runtime behavior.
  - `revert`: revert a previous commit.

- Keep the description imperative, lowercase unless it names code, and under
  72 characters when practical, for example `fix(view): preserve final answer`.
- Use a scope when it adds useful context, such as `view`, `codex`, `prompt`,
  `settings`, `styles`, or `build`.
- For breaking changes, add `!` after the type or scope and explain the impact
  in the commit body:

  ```text
  feat(settings)!: remove legacy ask mode

  BREAKING CHANGE: existing ask mode settings are migrated to readOnly.
  ```
