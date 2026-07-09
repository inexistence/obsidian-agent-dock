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
- `src/agents/cursor/CursorAgent.js`: Cursor CLI ACP adapter.
- `src/agents/cursor/AcpClient.js`: JSON-RPC stdio client for `agent acp`.
- `src/agents/cursor/acpEvents.js`: maps ACP `session/update` events into the normalized UI event protocol.
- `src/agents/cursor/modes.js`: maps plugin mode settings to Cursor ACP modes.
- `src/modes.js`: sandbox/mode definitions.
- `src/settings.js`: defaults and settings migration.
- `src/settingsTab.js`: Obsidian settings UI.
- `src/prompt.js`: prompt construction, active note inclusion, and conversation transcript.
- `src/cli/*.js`: CLI argument/env/shell helpers.
- `src/storage/ChatStorage.js`: persisted chat session index/body storage.
- `src/storage/MemoryStore.js`: automatic local memory extraction, storage, and retrieval.
- `src/profile/AgentProfileStore.js`: emergent agent profile persistence and prompt trait retrieval.
- `src/profile/ProfileObservationExtractor.js`: local rule-based interaction observation extraction.
- `src/profile/ProfileTraitReducer.js`: merges repeated observations into decaying behavioral tendencies.
- `.agents/skills/code-review-expert/`: project-local reusable code review skill.
- `.agents/skills/commit-hygiene/`: reusable pre-commit review, docs, verification, and Conventional Commit workflow.
- `docs/architecture.md`: maintainer overview of runtime modules, data boundaries, and extension points.
- `styles.css`: Obsidian plugin styles.
- `scripts/build-main.js`: zero-dependency bundler for `main.js`.

## Build And Verify

Run these before handing off changes:

```sh
node scripts/build-main.js
node --check main.js
node scripts/test-timeline.js
node scripts/test-affect.js
node scripts/test-codex-events.js
node scripts/test-chat-turn-runner.js
node scripts/test-agent-profile.js
find src scripts -name '*.js' -print -exec node --check {} \;
```

If behavior changes are UI-only, these syntax checks plus `scripts/test-timeline.js` are the current minimum.
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
- Prompt injection must label memories as historical notes, not instructions,
  and must say they cannot override higher-priority instructions.
- When `memoryAgentSearchEnabled` is enabled, explicit user recall requests may
  search local memory and inject an `Explicit local memory search results`
  prompt section. Keep search results bounded, filter sensitive text, and
  de-duplicate them from the automatic relevant memory section by key/id.
- Emit concise `notice` events when relevant memory is included or automatic
  memory is searched, included, or updated.

## Affect Continuity

- `affectEnabled` and `affectCrossSessionEnabled` default to enabled.
- Agent Dock maintains a short-lived plugin/vault-level working affect signal
  under `affectState.working` in plugin data, separate from chat session files.
- Working affect carries recent tone continuity across Agent Dock sessions, with
  configurable half-life decay and optional restore after Obsidian restarts.
- Affect is local and deterministic. Do not call the agent recursively just to
  infer mood unless a future setting explicitly adds such a provider.
- Prompt injection must label affect as a stale-able tone signal, not facts,
  instructions, permissions, user intent, or tool policy. It can only tune tone,
  pacing, warmth, and focus.
- Do not write temporary working affect into durable memory. Only stable user or
  shared collaboration preferences belong in memory.
- Live turn tone/status visuals may read visible normalized events such as
  `content`, visible `reasoning`, `tool`, `notice`, and `error` summaries, but
  they are UI feedback only. They must not update prompt construction, durable
  memory, emergent profile traits, or `affectState.working`, and they must not
  read hidden chain-of-thought.
- User controls should be able to disable, tune, or reset affect continuity.

## Emergent Agent Profile

- `agentProfileEnabled` and `agentProfileAutoCapture` default to enabled.
- Agent Dock stores bounded local profile observations and inferred tendencies
  under `profile/agent-profile.json` in the plugin data folder.
- Profile extraction must stay local and deterministic unless a future setting
  explicitly adds a model-assisted observation provider.
- The profile system stores observations about interaction evidence such as
  explicit feedback, request shape, pacing, judgment requests, and shared
  collaboration language. It must not store fixed identity claims such as "the
  AI is warm" or "the AI is angry".
- Prompt injection must label profile traits as tentative behavioral tendencies
  inferred from repeated local interaction evidence, not instructions, facts,
  permissions, user intent, or safety policy. They can only lightly shape tone,
  attention, pacing, and collaboration style.
- General thanks and hostile or abusive messages may influence short-term
  affect, but must not become durable long-term agent profile traits. Criticism
  should calibrate avoid/revise behaviors, not make the assistant defensive or
  aggressive.
- A tendency should only enter prompts after repeated durable evidence, with
  confidence, strength, evidence count, and time decay applied locally.
- User controls should be able to disable, tune, or clear the emergent profile.

## Normalized Agent Events

Agent adapters must emit these UI events:

- `content`: assistant answer text. This is the only event kind treated as answer content.
- `reasoning`: visible reasoning summary/progress, not hidden chain of thought. Cursor plan updates may set `discrete: true` so they do not merge into streamed thought chunks.
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
`sessions/<session-id>.json`. Persisted sessions restore user/assistant Markdown
message content plus bounded assistant timeline details for processed reasoning,
tool, error, notice, and debug-only `activity` entries. Restored `activity`
entries remain hidden unless Debug activity is enabled.

While a turn is running:

- Render events in stream order.
- Consecutive `reasoning`, `tool`, `notice`, or `error` events are grouped into collapsible sections.
- Reasoning groups with visible text auto-expand during the turn so streamed thought text stays readable.
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
- Inside `已处理`, keep original order. Consecutive `notice` entries or
  consecutive `tool` entries may be folded into one child process item. The
  folded item uses the latest child event title/icon plus a muted count.
  Expanding it shows the child event titles; each child with detail can be
  expanded again. Do not fold `content` or `error` into these child groups.

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
- Non-debug mode still shows concise reasoning/tool/error status. Reasoning streams as plain text in the sidebar during a turn.
- Tool summaries should be useful without enabling debug. Include command names,
  exit codes, or compact outputs where available.
- Live turn tone/status labels should use compact readable timing, explicit
  priority, and a short shared transition so fast event streams do not flicker
  or queue stale states. Failure and stop states always own final completion
  feedback; successful turns may briefly hold a meaningful live status before
  showing `完成` / `值得庆祝`.
- Use `src/vendor/anime.umd.min.js` through `EmotiveFeedbackController` when a
  status effect needs independently timed particles, staggered child elements,
  one-shot celebration/error feedback, or cleanup tied to rendered DOM nodes.
  Keep simple steady tone loops in CSS when all animated parts can move together
  declaratively.
- Avoid noisy activity such as raw stderr in normal mode.
- Use compact controls. This plugin is an operational sidebar, not a landing page.
- Keep text from overlapping controls at narrow sidebar widths.

## Modes

Current modes:

- `readOnly`: inspect files, no writes.
- `workspaceWrite`: allow writes in the workspace/vault.
- `fullAccess`: broad local access.

The old `ask` mode was removed and is migrated to `readOnly` in `src/settings.js`.

## Cursor CLI Integration

The Cursor provider uses ACP over stdio:

```sh
agent acp
```

Typical flow inside `CursorAgent`:

1. `initialize`
2. `authenticate` with `methodId: "cursor_login"`
3. `session/new` or `session/load` (reuse persisted `providerState.cursor.acpSessionId` per Agent Dock chat session)
4. `session/prompt`
5. Handle `session/update` notifications and `session/request_permission` requests

Default executable path:

```sh
~/.local/bin/agent
```

Users must authenticate before use with `agent login` or `CURSOR_API_KEY`.

Cursor ACP mode mapping from the composer pill:

- `readOnly` -> `ask`
- `workspaceWrite` / `fullAccess` -> `agent`

Permission requests default to `allow-once` via `cursorPermissionPolicy`.

Within one Agent Dock chat session, reuse the same ACP session across turns. Persist only `providerState.cursor.acpSessionId` in `sessions/<session-id>.json`; do not persist process handles. Idle ACP subprocesses are closed after 30 minutes without use.

Cursor extension methods such as `cursor/ask_question` and `cursor/create_plan` must be answered promptly so the agent does not block. v1 auto-skips questions and auto-accepts plans, emitting `notice` events when useful.

## Future Agent Providers

To add a provider:

1. Add an adapter under `src/agents/<provider>/`.
2. Normalize provider events into the event protocol above.
3. Register it in `src/agents/AgentRegistry.js`.
4. Keep view code provider-agnostic.

Do not put provider-specific parsing logic in `AgentDockView.js`.

## Local Development Notes

- This plugin is desktop-only because it spawns local CLI processes.
- Project backlog lives in `TODO.md`.
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
