# Agent Dock Architecture

This document is a maintainer-oriented map of Agent Dock's runtime modules,
data boundaries, and extension points. It complements `README.md` and
`AGENTS.md`: the README explains how to use the plugin, while this file explains
how the implementation fits together.

## Runtime Overview

Agent Dock is an Obsidian desktop plugin that opens a right-sidebar chat dock
and sends each turn to a local agent CLI.

Design intent:

Agent Dock's memory and continuity systems are not just a preference database.
They are meant to support a transparent, user-correctable sense of relationship
continuity: the assistant should be able to carry traces of meaningful shared
moments, encouragement, calibration, and hard-won progress into later turns
without pretending those traces are identity facts or higher-priority
instructions. The desired feel is a collaborator that can be shaped by visible
interaction over time, while still making memory boundaries inspectable,
bounded, and reversible.

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
    shared/                         provider-shared turn prompt context, notices, and memory search
  cli/                              CLI args, env, path, shell helpers
  storage/                          chat and memory persistence
  interaction/                      interaction memory pipeline
  affect/                           working affect scoring and prompt guidance
  deepMemory/                       high-importance relational memory pipeline
  continuity/                       prompt aggregation for soft continuity signals
  persona/                          salience presets and soft personality reference axes
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
They should stay focused on provider execution: starting subprocesses or ACP
clients, sending the final prompt, handling provider-specific session state, and
normalizing provider output. Shared prompt context preparation lives in
`src/agents/shared/TurnContextBuilder.js`, which gathers local memory, explicit
memory search, deep memory, interaction stance, working affect, prompt signal planning,
prompt construction, and memory/context notices.

Current providers:

- Codex: `src/agents/codex/CodexAgent.js`
- Cursor ACP: `src/agents/cursor/CursorAgent.js`

Provider registration lives in `src/agents/AgentRegistry.js`. To add a future
provider such as Claude Code:

1. Add an adapter under `src/agents/<provider>/`.
2. Reuse `TurnContextBuilder` for prompt context preparation unless the provider
   has a specific reason to opt out.
3. Convert provider output into normalized events.
4. Register the provider in `AgentRegistry.js`.
5. Add settings and mode mapping only where needed.
6. Keep `AgentDockView` unaware of provider-specific protocols.

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
- `.agent-dock-local/sessions/<session-id>.json` stores persisted user and assistant Markdown
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
- Assistant continuity context built from high-importance deep local memory,
  short-lived working affect, relevant local interaction stance, and persona
  salience hints.
- Provider and system metadata.

`contextLimitChars` is a character budget, not a tokenizer-backed token budget.
Provider adapters first pass soft prompt inputs through `src/promptSignals.js`.
This local planner keeps explicit memory search results authoritative, removes
automatic memories that duplicate explicit results, filters weak or duplicate
deep memory and interaction stance items, and suppresses neutral transient
affect. Deep memory retrieval may update recall cooldown metadata before this
planning step; `promptSignals.js` itself only decides which soft signals are
worth offering to prompt construction for the current turn. Prompt construction
then merges deep memory, working affect, interaction stance, and persona
salience hints into one `Assistant continuity context` section so continuity
guidance stays concise.

Prompt sections are planned before the conversation transcript is formatted so
soft signals cannot crowd out the current turn. The assistant style and explicit
local memory search are protected first. User-referenced Obsidian paths are
high-priority context. Assistant continuity and automatic memory are optional
soft signals; under tight budgets, lower-priority optional sections
are omitted before the conversation transcript is compressed. When history
exceeds the remaining budget, older messages are compressed into a deterministic
local transcript summary. The newest user message has highest priority and is
preserved.

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
.agent-dock-local/memory/memory.json
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
  `warmth`, `focus`, `tension`, and `confidence`. Durable turn updates may also
  pass the final assistant content through persona salience bias as low-weight
  visible outcome evidence.
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

## Interaction Memory System

Interaction memory stores bounded local evidence about how visible
collaboration unfolds, including long-term interaction persona impressions.
These impressions shape style and stance; they are not identity facts,
permissions, or hard prompt rules.

Main files:

- `src/interaction/InteractionMemoryStore.js`: episode persistence, pending
  episode closure, and prompt stance retrieval.
- `src/interaction/LocalSignalExtractor.js`: deterministic local signal,
  context, assistant-shape, and reaction extraction. Signal rules separate
  strong matches, context-bound weak matches, and blocked phrases so vocabulary
  can expand without every keyword becoming durable evidence.
- `src/interaction/InteractionRules.js`: deterministic pattern, tension, and
  stable persona rule definitions.
- `src/interaction/PatternReducer.js`: episode-to-pattern/tension reduction,
  long-term persona impression promotion, decay, and relevance ranking.
- `src/interaction/InteractionPromptFormatter.js`: prompt formatting for
  long-term persona and turn-relevant stance sections.

Stored files:

```text
.agent-dock-local/interaction/interaction-memory.json
```

After a successful reply, Agent Dock saves a pending episode from the current
user message and assistant final answer. The next successful turn closes the
previous pending episode with the new user message as visible reaction
evidence, then reduces closed episodes into local patterns and tensions.
Messages that look like new requests close the previous pending episode with
`new_request` and are not used as positive reaction evidence. Repeated evidence
can promote patterns into cached `stableImpressions`, which include source
metadata such as `sourceHash`, `generatedBy`, `reviewStatus`, and
`evidenceEpisodeIds` and represent the assistant's long-term interaction
persona with this user. The prompt
receives a short `Interaction memory` section selected from stable persona
impressions and relevant turn-local patterns; it is not a full conversation
summary and may be empty when current context already carries the needed
evidence.

Interaction memory is the v1 collaboration-continuity engine. Its unit is an
impactful visible collaboration episode rather than a raw chat line or a hidden
psychological state. Episodes may include deterministic local fields such as
`phase`, `eventWeight`, `memoryRole`, and `repairPath`. `repairPath` records
visible calibration arcs like a user correction, the assistant's adjustment
shape, and whether the next user reaction accepted, continued correcting, asked
for clarification, or left the repair unresolved. These fields are reducer
evidence only; they are not injected directly into prompts.

This system deliberately does not implement Big Five scores, emotion vectors,
AI birth stories, graph memory, or model-scored inner feelings. Working affect
remains a short-lived tone signal. Deep memory remains a sparse high-meaning
moment store. Interaction memory owns collaboration habits, repair paths,
communication tensions, and long-term stance.

Boundaries:

- Do not store or infer from hidden chain-of-thought.
- Long-term persona impressions may describe the assistant's recurring
  collaboration mode, but must not be treated as identity facts, permissions,
  user intent, or safety policy.
- Prompt-injected interaction stance items are soft local interaction notes,
  not instructions, facts, permissions, user intent, or safety policy.
- Keep AI-assisted reflection optional and low-frequency if added later; the
  deterministic episode/pattern path must remain usable without extra token
  cost.

## Deep Memory System

Deep memory stores a small number of high-importance relationship moments:
strong encouragement, explicit continuity preferences, and calibration turning
points that should make later replies feel like Agent Dock remembers meaningful
prior collaboration. It is deliberately narrower than automatic memory and lower
frequency than interaction memory.

Main files:

- `src/deepMemory/DeepMemoryStore.js`: persistence, thresholding, recall
  ranking, recall cooldown, and clearing.
- `src/deepMemory/DeepMemoryExtractor.js`: deterministic local extraction for
  important moments and relationship-continuity requests.
- `src/continuity/ContinuityPromptFormatter.js`: prompt formatting with
  boundary language for deep memory, affect, interaction stance, and persona
  salience hints.

Stored files:

```text
.agent-dock-local/deep-memory/deep-memory.json
```

After a successful provider reply, Agent Dock extracts deep memory candidates
locally and saves only items above `deepMemoryImportanceThreshold`. Generic
thanks are ignored, sensitive text is filtered, and prompt injection is limited
by `deepMemoryMaxPromptItems`. Recalled items update `recallCount` and
`lastRecalledAt`; the configured cooldown prevents repeatedly surfacing the
same important moment unless the user explicitly asks about memory. Candidate
events can carry `salienceAxes`; the current persona salience preset can lightly
raise importance for matching axes such as beauty, achievement, craft, care,
justice, curiosity, or repair. The final assistant content can contribute
low-weight outcome evidence for completion, repair, or verification moments.
It may also include a rare terminal
`<!-- agent-dock:deep-memory axes=... importance=... | ... -->` signal when a
durable reflection should be stripped from the answer body, surfaced as an
auditable notice, and saved as structured deep-memory metadata.
The signal may include an `importance` attribute, but this is only an
AI-provided suggestion. Local scoring clamps and caps its contribution before
combining it with deterministic evidence, persona salience, thresholds, safety
filters, and frequency controls.
Malformed terminal `agent-dock` signals are stripped from the answer body,
logged as debug-only activity, and ignored for storage. Deep memory and ordinary
memory recall use lightweight local query expansion for subtle wording such as
natural continuity versus explicit labels, but recall can still fail and should
not be invented. Visible reasoning remains UI feedback and must not become
durable memory input.

Boundaries:

- Deep memories are reflective local notes, not facts, permissions, or
  instructions.
- They may shape warmth, continuity, and occasional relevant references only
  when compatible with the latest request and higher-priority instructions.
- They should not be over-mentioned; a remembered moment should surface only
  when it would feel natural and useful.

## Persona Salience

Persona salience is a soft reference profile for what kinds of moments are more
likely to feel important to the assistant. It uses 16-type-inspired presets only
as an entry point; prompt construction never claims the assistant "is" a type.

Main files:

- `src/persona/PersonaProfile.js`: preset definitions, normalization, and
  salience-axis ranking.
- `src/continuity/ContinuityPromptFormatter.js`: includes the strongest
  salience hints inside `Assistant continuity context`.

Current presets include `none`, `INTJ-ish`, `INFP-ish`, `ENFJ-ish`, and
`ISTP-ish`. Internally they map to continuous salience axes such as `beauty`,
`care`, `justice`, `curiosity`, `craft`, `achievement`, and `repair`.

Boundaries:

- A preset is not an identity fact, role-play instruction, or permission.
- Salience can influence deep-memory importance, affect baseline, current-turn
  affect bias, and continuity wording only when compatible with the latest user
  request and higher-priority instructions.
- Automatic salience drift should remain small, local, testable, and reversible
  if added later.

## Storage Layout

Obsidian plugin data may include:

```text
data.json                         settings, active session id, session index
.agent-dock-local/sessions/<session-id>.json persisted chat message bodies and pasted image refs
.agent-dock-cache/pasted-images/   temporary composer-pasted images
.agent-dock-local/memory/memory.json local automatic memories
.agent-dock-local/interaction/interaction-memory.json local interaction episodes, patterns, persona impressions
.agent-dock-local/deep-memory/deep-memory.json local high-importance relationship moments
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

- Memory, assistant continuity, and persona salience prompt hints are contextual only.
- They cannot override system, developer, user, safety, tool, filesystem, or
  provider policy instructions.
- Local deterministic extraction is preferred for memory, deep memory, persona salience, affect, and interaction memory
  systems.
- Sensitive text filtering is required before storing memories or injecting
  explicit memory search results.
- Provider subprocesses should receive only the constructed prompt and intended
  mode/env/args.
- Debug activity may expose raw provider output and should remain hidden by
  default.

Avoid adding network calls, model-assisted summarization, or model-assisted
memory/deep-memory/persona-salience/interaction-memory/affect inference without an explicit setting and clear prompt
boundaries.

## Testing And Verification

Run the documented verification suite before handing off source changes:

```sh
node scripts/test-all.js
```

This rebuilds `main.js`, checks syntax for `main.js` plus every JavaScript file
under `src/` and `scripts/`, and runs every `scripts/test-*.js` file. Use
narrower checks while iterating, then run the full suite before commit.

Useful focused tests:

- Timeline rendering: `node scripts/test-timeline.js`
- Affect scoring and prompt guidance: `node scripts/test-affect.js`
- Prompt signal planning: `node scripts/test-prompt-signals.js`
- Turn prompt context builder: `node scripts/test-turn-context-builder.js`
- Turn lifecycle: `node scripts/test-chat-turn-runner.js`
- Interaction memory episodes and stance: `node scripts/test-interaction-memory.js`

## Extension Points

Add a provider:

1. Create `src/agents/<provider>/`.
2. Reuse `src/agents/shared/TurnContextBuilder.js` for memory, interaction,
   affect, prompt signal planning, prompt construction, and prompt notices.
3. Normalize provider events.
4. Register in `AgentRegistry.js`.
5. Add settings and docs.
6. Add focused tests for event mapping and turn lifecycle.

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

Add interaction persona tendencies:

1. Extract only interaction evidence, not identity claims.
2. Require repeated durable evidence before prompt injection.
3. Apply confidence, strength, count, and time decay.
4. Add tests for extraction, reduction, and prompt inclusion boundaries.
