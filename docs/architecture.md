# Agent Dock Architecture

This document is a maintainer-oriented map of Agent Dock's runtime modules,
data boundaries, and extension points. It complements `README.md` and
`AGENTS.md`: the README explains how to use the plugin, while this file explains
how the implementation fits together.

## Runtime Overview

Agent Dock is an Obsidian desktop plugin that opens a right-sidebar chat dock
and sends each turn to a local agent CLI.

Runtime flow:

1. Obsidian loads `main.js`.
2. `main.js` is generated from `src/` by `scripts/build-main.js`.
3. `src/plugin.js` registers settings, commands, providers, and the dock view.
4. `src/view/AgentDockView.js` owns the sidebar UI and chat session state.
5. The selected provider adapter runs a local CLI process and emits normalized
   agent events.
6. The view renders normalized events into the timeline and persists final chat
   messages through `ChatStorage` when enabled.

Do not edit `main.js` directly for feature work. Edit `src/`, then run:

```sh
node scripts/build-main.js
```

Commit the regenerated `main.js` together with source changes because Obsidian
loads it directly.

## Source Layout

Key source ownership:

```text
src/
  plugin.js                         Obsidian plugin lifecycle and registration
  settings.js                       defaults, migrations, provider settings
  settingsTab.js                    Obsidian settings UI
  modes.js                          sandbox/mode definitions
  prompt.js                         prompt construction and compression
  agents/
    AgentRegistry.js                provider registry
    codex/                          Codex CLI adapter
    cursor/                         Cursor ACP adapter
    shared/                         provider-shared prompt notices/search
  cli/                              CLI args, env, path, shell helpers
  storage/                          chat and memory persistence
  profile/                          emergent agent profile pipeline
  affect/                           working affect scoring and prompt guidance
  view/                             sidebar UI, timeline, composer, references
  i18n/                             language packs
scripts/
  build-main.js                     zero-dependency bundler
  test-*.js                         local regression tests
```

The view should stay provider-agnostic. Provider-specific parsing belongs under
`src/agents/<provider>/`.

## Provider Architecture

Providers adapt local agent CLIs to Agent Dock's normalized event protocol.

Current providers:

- Codex: `src/agents/codex/CodexAgent.js`
- Cursor ACP: `src/agents/cursor/CursorAgent.js`

Provider registration lives in `src/agents/AgentRegistry.js`. To add a future
provider such as Claude Code:

1. Add an adapter under `src/agents/<provider>/`.
2. Convert provider output into normalized events.
3. Register the provider in `AgentRegistry.js`.
4. Add settings and mode mapping only where needed.
5. Keep `AgentDockView` unaware of provider-specific protocols.

### Codex Provider

The Codex adapter runs:

```sh
codex exec --json --output-last-message <tmp-file> ...
```

`src/agents/codex/jsonEvents.js` maps Codex JSONL events into normalized
events. The completed turn boundary is the child process closing successfully.
`--output-last-message` is used as a final-answer fallback if no content event
was captured.

### Cursor Provider

The Cursor adapter runs ACP over stdio:

```sh
agent acp
```

`src/agents/cursor/AcpClient.js` owns JSON-RPC stdio transport.
`src/agents/cursor/acpEvents.js` maps ACP `session/update` notifications.
`src/agents/cursor/modes.js` maps Agent Dock modes to Cursor modes.

Within one Agent Dock chat session, Cursor reuses the same ACP session id via
`providerState.cursor.acpSessionId`. Process handles are never persisted.

## Normalized Agent Events

Provider adapters emit these UI event kinds:

- `content`: assistant answer text; the only kind treated as final answer text.
- `reasoning`: visible reasoning summary or progress, not hidden chain of
  thought.
- `tool`: command, MCP, web, file, or permission activity.
- `notice`: concise system notices such as compression or memory inclusion.
- `error`: user-visible failure.
- `activity`: low-level debug activity, hidden unless debug activity is enabled.

Do not emit assistant answer text as `message`. `message` is reserved for user
timeline entries.

## Chat Session And Timeline Model

`AgentDockView` stores in-memory chat sessions. Provider adapters do not know
about this UI session model.

Persistence model:

- `data.json` stores settings, active session id, and a lightweight session
  index.
- `sessions/<session-id>.json` stores persisted user and assistant Markdown
  message bodies, persisted assistant timeline details, and per-session pasted
  image cache paths used for cleanup.
- `.agent-dock-cache/pasted-images/` stores temporary composer-pasted images.
  Agent Dock prunes expired files on plugin startup and before new image
  pastes, and deletes tracked cache images when a conversation is deleted or
  pruned from persisted storage.
- Restored sessions keep bounded assistant timeline details for processed
  reasoning, tool, error, notice, and debug-only `activity` entries. Persisted
  `activity` entries remain hidden unless Debug activity is enabled, and
  persisted timeline details are filtered for obvious secrets.

Timeline rendering rules:

- During a running turn, events render in stream order.
- Consecutive `reasoning`, `tool`, `notice`, `error`, or debug `activity`
  entries are grouped into collapsible sections.
- Visible reasoning groups auto-expand during the turn.
- Content appears inline with event groups.
- When a turn completes, the final `content` entry remains visible.
- Everything before the final content collapses into one `已处理` section,
  preserving original order.

This keeps the final answer easy to scan without losing runtime traceability.

## Prompt Construction And Context Compression

Prompt construction lives in `src/prompt.js`.

Inputs may include:

- Current user message.
- Active note content, clipped by `activeNoteMaxChars`.
- Recent conversation transcript.
- Relevant local memory.
- Explicit memory search results.
- Short-lived working affect.
- Emergent agent profile tendencies.
- Provider and system metadata.

`contextLimitChars` is a character budget, not a tokenizer-backed token budget.
When history exceeds the remaining budget, older messages are compressed into a
deterministic local transcript summary. The newest user message has highest
priority and is preserved.

Do not call an agent recursively just to summarize history unless the project
adds an explicit summarization provider later.

## Local Memory System

Memory is local and deterministic by default.

Main files:

- `src/storage/MemoryStore.js`: storage, retrieval, and prompt selection.
- `src/storage/memoryExtraction/RuleBasedMemoryExtractor.js`: local candidate
  extraction and classification.
- `src/agents/shared/memorySearch.js`: explicit recall request detection and
  local search.
- `src/agents/shared/memoryNotices.js`: provider-shared memory notices.

Stored file:

```text
memory/memory.json
```

Memory categories include user preferences, explicit remember requests, agent
self notes, shared collaboration notes, project notes, recent tasks, and
decision-like notes.

Memory boundaries:

- Do not store obvious secrets such as API keys, tokens, passwords, or private
  keys.
- Prompt-injected memories are historical notes, not instructions.
- Memories cannot override higher-priority instructions, permissions, safety
  policy, or current user intent.
- Memory extraction must stay local unless a future setting explicitly enables a
  model-assisted provider.

## Affect Continuity System

Affect continuity is a short-lived tone signal for the current plugin/vault. It
is not durable memory.

Main file:

```text
src/affect/WorkingAffectStore.js
```

Core concepts:

- `extractTurnAffectSignal()` scans the latest prompt with local deterministic
  rules and converts matches into six dimensions: `valence`, `arousal`,
  `warmth`, `focus`, `tension`, and `confidence`.
- `getPromptWorkingAffect()` combines current-turn signal with recent
  cross-session working affect for prompt injection.
- `updateWorkingAffect()` updates the short-lived working state after a turn.
- `getTurnVisualAffect()` reads visible normalized agent events during a running
  turn and updates only the loading status label/animation. This is UI feedback,
  not prompt guidance or stored affect continuity.
- `labelWorkingAffect()` maps dimensions to labels such as `playful`, `close`,
  `alert`, `composed`, `challenging`, and `restrained`.
- `formatWorkingAffectPrompt()` converts the label into tone guidance:
  `pacing`, `expression`, `do`, and `avoid`.

Stored state:

```text
affectState.working in data.json
```

Maintenance rules:

- Affect must stay local and deterministic unless a future setting explicitly
  adds a model-assisted provider.
- Affect prompt sections may only tune tone, pacing, warmth, and focus.
- Affect cannot override facts, permissions, tool policy, filesystem policy,
  safety instructions, memory boundaries, or the latest user request.
- Live visual affect may read only visible event text already shown or available
  to the timeline, such as `content`, visible `reasoning`, `tool`, `notice`, and
  `error` summaries. It must not read hidden chain-of-thought, update prompt
  construction, write `affectState.working`, or persist session-only UI fields.
- Live visual label changes should be smoothed with a minimum readable display
  duration so fast event streams do not flicker through several tone labels.
  Strong risk or completion signals may use a shorter delay, but should still
  remain visible long enough to be perceived. Failure and stop states always own
  the final completion feedback.
- Live visual labels should have explicit priority. Higher-priority labels such
  as `alert`, `serious`, and `celebratory` may preempt lower-priority working or
  ambience labels; lower-priority labels should wait until the current visible
  label has been readable long enough.
- Live visual label changes use a short shared enter/exit transition. The
  transition should make replacement perceptible without queueing every
  intermediate state; final `success`, `celebrate`, `error`, or `stopped`
  feedback still owns the completion display.
- Positive tone rules should consider a `blockedBy` negation pattern so phrases
  like "do not joke" or "keep it professional" do not trigger playful or close
  tone.
- Adding a new tone label should update the signal rule, label rule, prompt
  profile, tests in `scripts/test-affect.js`, and generated `main.js`.

## Emergent Agent Profile System

The emergent profile stores bounded local evidence about interaction patterns,
not fixed identity claims.

Main files:

- `src/profile/AgentProfileStore.js`: profile persistence and prompt selection.
- `src/profile/ProfileObservationExtractor.js`: rule-based observation
  extraction.
- `src/profile/ProfileTraitReducer.js`: decaying trait merge and confidence
  logic.

Stored file:

```text
profile/agent-profile.json
```

Profile observations may capture explicit feedback, request shape,
collaboration pacing, judgment requests, and shared continuity language. A
tendency enters prompts only after repeated durable evidence with confidence,
strength, evidence count, and time decay applied locally.

Boundaries:

- Do not store fixed identity claims such as "the AI is warm" or "the AI is
  angry".
- General thanks and hostile or abusive messages may influence short-term
  affect but must not become durable long-term profile traits.
- Prompt-injected profile traits are tentative behavioral tendencies, not
  instructions, facts, permissions, user intent, or safety policy.

## Storage Layout

Obsidian plugin data may include:

```text
data.json                         settings, active session id, session index
sessions/<session-id>.json         persisted chat message bodies and pasted image refs
.agent-dock-cache/pasted-images/   temporary composer-pasted images
memory/memory.json                 local automatic memories
profile/agent-profile.json         local profile observations and tendencies
```

These files are local runtime data and should remain untracked.

Persist only serializable state. Do not persist process handles, timers, file
descriptors, raw tool streams, or provider subprocess objects.

## Settings And Migration

Defaults and migrations live in `src/settings.js`. The settings UI lives in
`src/settingsTab.js`.

When adding a setting:

1. Add a default value.
2. Add migration behavior if old data may exist.
3. Add a settings UI control if user-facing.
4. Update README or this document when the setting changes behavior or storage.
5. Add tests when the setting affects prompt construction, persistence, or
   provider behavior.

Removed settings should be migrated safely. For example, the old `ask` mode is
migrated to `readOnly`.

## Modes And Permissions

Mode definitions live in `src/modes.js`.

Current modes:

- `readOnly`: inspect files, no writes.
- `workspaceWrite`: allow writes in the workspace or vault.
- `fullAccess`: broad local access.

Provider adapters map these modes to provider-specific flags or protocol fields.
Do not put provider-specific mode parsing in view code.

## UI Modules

The UI is an operational sidebar, not a landing page.

Important files:

- `src/view/AgentDockView.js`: view orchestration.
- `src/view/composer/ComposerRenderer.js`: prompt composer.
- `src/view/composer/CodeMirrorComposerInput.js`: optional CodeMirror-backed
  composer input with lightweight Markdown live preview.
- `src/view/timeline/MessageTimelineRenderer.js`: timeline rendering.
- `src/view/timeline/timeline.js`: timeline grouping helpers.
- `src/view/turn/TurnStatusController.js`: live turn status labels, visual
  affect handoff, and completion feedback.
- `src/view/affect/AffectIndicatorController.js`: working affect indicator,
  reset control, and panel animation.
- `src/view/session/SessionSwitcherRenderer.js`: chat session controls.
- `src/view/session/ChatTurnRunner.js`: turn lifecycle orchestration.
- `src/view/reference/*`: note/file mention and drop handling.
- `styles.css`: Obsidian plugin styles.

Keep controls compact and robust at narrow sidebar widths. Copy buttons copy the
original Markdown text, while rendered messages use Obsidian `MarkdownRenderer`.

### Composer Markdown Preview

The composer uses `CodeMirrorComposerInput` when Obsidian's runtime can resolve
the CodeMirror 6 packages (`@codemirror/state`, `@codemirror/view`, and
optionally `@codemirror/commands`). This project does not vendor those packages
through `scripts/build-main.js`; the feature intentionally treats them as an
Obsidian runtime capability.

When CodeMirror is available, the composer logs:

```text
[Agent Dock] CodeMirror composer enabled
```

with a small capability object, for example `{ history: true, keymap: true }`.
If CodeMirror cannot be loaded, Agent Dock logs a warning, shows one user-visible
notice, and falls back to the plain textarea composer.

The CodeMirror composer keeps the raw Markdown as the draft and prompt source.
Its live preview is implemented with local decorations for a bounded Markdown
subset: links, wiki links, bold, italic, inline code, strikethrough, headings,
blockquotes, and ordered/unordered lists. It is not Obsidian's full editor
live-preview engine; richer block-level Markdown such as tables and fenced code
block rendering should be added deliberately with tests. File drops are
intercepted in the composer before the editor default drop handler runs, so
external files become references instead of pasted file contents.

## Security And Boundary Principles

Agent Dock deliberately separates guidance from authority:

- Memory, affect, and profile prompt sections are contextual hints only.
- They cannot override system, developer, user, safety, tool, filesystem, or
  provider policy instructions.
- Local deterministic extraction is preferred for memory, affect, and profile
  systems.
- Sensitive text filtering is required before storing memories or injecting
  explicit memory search results.
- Provider subprocesses should receive only the constructed prompt and intended
  mode/env/args.
- Debug activity may expose raw provider output and should remain hidden by
  default.

Avoid adding network calls, model-assisted summarization, or model-assisted
memory/profile/affect inference without an explicit setting and clear prompt
boundaries.

## Testing And Verification

Run the documented verification suite before handing off source changes:

```sh
node scripts/build-main.js
node --check main.js
node scripts/test-timeline.js
node scripts/test-affect.js
node scripts/test-chat-turn-runner.js
node scripts/test-agent-profile.js
find src scripts -name '*.js' -print -exec node --check {} \;
```

Use narrower checks while iterating, then run the full suite before commit.

Useful focused tests:

- Timeline rendering: `node scripts/test-timeline.js`
- Affect scoring and prompt guidance: `node scripts/test-affect.js`
- Turn lifecycle: `node scripts/test-chat-turn-runner.js`
- Profile extraction and reduction: `node scripts/test-agent-profile.js`

## Extension Points

Add a provider:

1. Create `src/agents/<provider>/`.
2. Normalize provider events.
3. Register in `AgentRegistry.js`.
4. Add settings and docs.
5. Add focused tests for event mapping and turn lifecycle.

Add a memory extraction provider:

1. Keep `MemoryStore` persistence stable.
2. Add the provider behind an explicit setting.
3. Preserve sensitive text filtering.
4. Keep prompt-injected memory bounded and labeled as historical notes.

Add an affect label:

1. Add or update signal rules.
2. Add label thresholds.
3. Add a prompt profile with `pacing`, `expression`, `do`, and `avoid`.
4. Add negative-context `blockedBy` protection for positive tone rules.
5. Add tests proving both positive trigger and negated non-trigger behavior.

Add profile tendencies:

1. Extract only interaction evidence, not identity claims.
2. Require repeated durable evidence before prompt injection.
3. Apply confidence, strength, count, and time decay.
4. Add tests for extraction, reduction, and prompt inclusion boundaries.
