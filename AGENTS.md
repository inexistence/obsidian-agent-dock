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
- `src/agents/shared/TurnContextBuilder.js`: provider-shared turn prompt context builder; gathers local memory, explicit memory search, deep memory, interaction stance, working affect, prompt signal planning, prompt construction, and memory/context notices before providers send prompts.
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
- `src/promptSignals.js`: soft prompt signal planner; de-duplicates automatic memory against explicit search, filters weak deep memory and interaction stance, and suppresses neutral transient affect.
- `src/promptBudget.js`: prompt section budget arbitration; protects high-priority sections and omits/truncates optional soft sections before conversation compression.
- `src/cli/*.js`: CLI argument/env/shell helpers.
- `src/storage/ChatStorage.js`: persisted chat session index/body storage.
- `src/storage/MemoryStore.js`: automatic local memory orchestration and retrieval.
- `src/storage/MemoryRepository.js`: memory file IO, cache, serialized writes, clear semantics, and unreadable-file write protection.
- `src/storage/MemoryRelationshipReducer.js`: event continuation, supersession, correction, and conflict relationships.
- `src/storage/MemoryEventClassifier.js`: deterministic event topic, status, and timeline-instance classification.
- `src/storage/memoryEvidence.js`: bounded memory evidence normalization, provenance locators, truncation metadata, and sensitive filtering.
- `src/storage/MemoryReliability.js`: deterministic answer-time memory support, staleness, conflict, and expiry evaluation.
- `src/storage/MemoryRecallPacket.js`: compact M1/S1 recall references and per-turn manifests.
- `src/storage/MemoryOmissionPlanner.js`: bounded proactive project follow-up detection and cooldown planning.
- `src/agents/shared/memoryTrace.js`: on-demand evidence-chain context for “why did you say that?” follow-ups.
- `src/agents/shared/memoryProvenance.js`: validates recalled-memory refs and records claimed-used references.
- `src/deepMemory/DeepMemoryStore.js`: high-importance relationship memory extraction, storage, recall cooldown, and retrieval.
- `src/deepMemory/DeepMemoryExtractor.js`: deterministic deep-memory candidate extraction from user messages and low-weight visible final-answer outcome evidence.
- `src/continuity/ContinuityPromptFormatter.js`: merges deep memory, working affect, interaction stance, and persona salience hints into one compact prompt section.
- `src/persona/PersonaProfile.js`: soft salience presets inspired by personality references; not identity facts or role-play modes.
- `src/interaction/InteractionMemoryStore.js`: interaction episode persistence, pending episode closure, and prompt stance retrieval.
- `src/interaction/LocalSignalExtractor.js`: local rule-based interaction signal, context, assistant-shape, and reaction extraction; signal rules use strong/weak/blocked matching.
- `src/interaction/InteractionRules.js`: deterministic pattern, tension, and stable persona rule definitions.
- `src/interaction/PatternReducer.js`: merges closed episodes into decaying interaction patterns/tensions and promotes stable persona impressions.
- `src/interaction/InteractionPatternCandidates.js`: validates AI pattern nominations, registers canonical candidate definitions, rejects key conflicts, and counts supportive closed-episode evidence.
- `src/interaction/InteractionPromptFormatter.js`: formats long-term persona and turn-relevant stance prompt sections.
- `.agents/skills/code-review-expert/`: project-local reusable code review skill.
- `.agents/skills/commit-hygiene/`: reusable pre-commit review, docs, verification, and Conventional Commit workflow.
- `.agents/skills/design-aware-development/`: proportionate design workflow with explicit anti-overengineering guardrails.
- `.agents/skills/resolve-code-issues/`: issue validation, root-cause repair, focused cleanup, and regression verification workflow.
- `docs/architecture.md`: maintainer overview of runtime modules, data boundaries, and extension points.
- `styles.css`: Obsidian plugin styles.
- `scripts/build-main.js`: zero-dependency bundler for `main.js`.

## Build And Verify

Run these before handing off changes:

```sh
node scripts/test-all.js
```

This rebuilds `main.js`, checks syntax for `main.js` plus every JavaScript file
under `src/` and `scripts/`, and runs every `scripts/test-*.js` file.

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
- Provider adapters should use `src/agents/shared/TurnContextBuilder.js` for
  turn prompt context preparation instead of reimplementing memory, deep memory,
  interaction, affect, signal planning, prompt construction, or prompt notice
  logic.
- `src/promptSignals.js` filters soft prompt inputs before formatting. Keep this
  local and deterministic; do not mutate memory, deep memory, or interaction
  storage there.
- `src/promptBudget.js` arbitrates formatted prompt sections before transcript
  compression so soft signals cannot crowd out the current user request.
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

- Design goal: Agent Dock's continuity systems should make the assistant feel
  shaped by meaningful visible collaboration over time, not merely backed by a
  preference database. Preserve this as transparent, bounded, user-correctable
  relationship continuity rather than hidden profiling, role-play identity, or
  authority over current instructions.
- Important memories should be able to cause bounded affective residue. A
  recalled success, repair, disappointment, or meaningful shared moment may
  move the assistant away from its usual baseline and naturally influence
  warmth, caution, sadness, playfulness, laughter, focus, or restraint. When
  relevant, the assistant may recognize that deviation and briefly connect it
  to the recalled moment; most effects should remain implicit in expression.
- Use AI reflection for semantic interpretation and local code for authority.
  Local validation, sensitive filtering, confidence caps, decay, cooldowns,
  pattern promotion, persistence, and user controls must remain authoritative.
- `memoryEnabled` and `memoryAutoCapture` default to enabled.
- Automatic memories are stored under `.agent-dock-local/memory/memory.json` in the plugin data folder.
- Rule-based extraction remains the deterministic fallback. The unified AI
  reflection envelope may propose semantic candidates, but it never writes
  storage directly.
- One model completion may contain at most one leading
  `<!-- agent-dock:reflection phase=appraisal | {...} -->` envelope before
  visible answer text and one terminal `phase=outcome` envelope after it. Strip
  both from the answer body and persist one auditable debug activity. Both use optional
  `memory`, `deepMemory`, `interaction`, `affect`, and `salience` sections plus
  required root-level `evidence` objects shaped as `{origin, speaker, quote}`.
  Derive speaker locally for fixed origins such as current user/assistant
  messages; recalled memory may retain an allowlisted speaker copied from its
  prompt provenance. Never accept inconsistent free-form speaker labels. Accept
  legacy strings as unknown-origin evidence.
- Request the lightweight appraisal for every substantive response. Empty,
  error-only, system-only, and trivial acknowledgement responses may omit it.
  Keep the outcome sparse and emit it only for a meaningful continuity change.
- During streaming, withhold only a bounded visible suffix while checking for a
  terminal outcome. Process its reflection update before releasing that suffix so protocol
  text never enters Markdown and final answer content remains visually last.
- Appraisal and outcome reflection updates share one stable timeline group. Update
  the earlier appraisal activity in place so both phases appear in one auditable
  detail view even when streamed content occurred between them.
- Persist the merged reflection as an auditable `activity` visible in normal and
  debug modes. Each audit item must identify whether its envelope came from a
  commentary or content message. Normal mode shows the locally filtered host
  message text; Debug mode additionally shows the complete pre-filter host
  message, subject to local sensitive-text filtering and persistence bounds.
- The leading appraisal is low-cost model self-conditioning: later answer tokens
  can use the stance generated earlier in the same completion. Local validation
  happens after completion, so do not claim it influenced earlier tool actions
  or was locally approved before the answer.
- Reflection summaries may be semantically abstract, but at least one bounded
  evidence quote must match the visible text associated with its claimed origin
  when that source is available. Never use
  hidden reasoning as evidence. Malformed or ungrounded sections must be
  ignored locally.
- The `memory` section may propose only `decision/project`, `task/project`,
  `identity/agent`, or `shared/shared`; it must never create user preferences or
  user facts. Treat every AI confidence or importance value as a capped
  suggestion.
- Appraisal-phase memory, deep-memory, and interaction candidates must not be
  persisted as outcomes. Durable capture waits for `phase=outcome`. Post-turn
  affect should prefer outcome reflection and fall back to appraisal only when
  no valid outcome affect is available.
- Do not store obvious secrets such as API keys, tokens, passwords, or private keys.
- Prompt injection must label memories as historical notes, not instructions,
  and must say they cannot override higher-priority instructions.
- Prompt-injected ordinary memory, deep memory, interaction stance, working
  affect, expression policy, and salience must label origin and speaker. A local
  synthesis or inferred state must never be phrased as a user or assistant quote;
  deep-memory user/assistant excerpts must remain separately attributed.
- When `memoryAgentSearchEnabled` is enabled, explicit user recall requests may
  search local memory and inject an `Explicit local memory search results`
  prompt section. Keep search results bounded, filter sensitive text, and
  de-duplicate them from the automatic relevant memory section by key/id.
- Emit concise `notice` events when relevant memory is included or automatic
  memory is searched, included, or updated.
- Ordinary memory stores compact summaries separately from bounded exact
  evidence. Runtime support levels are computed locally and must distinguish
  extraction confidence from current factual support.
- Automatic prompt recall defaults to four items and 1600 characters; exact
  evidence stays local unless explicit lookup or provenance tracing needs it.
- Proactive collaboration follow-ups must remain local, bounded, cooldown-aware,
  user-disableable, and non-authoritative. Do not crawl the vault or call the
  agent recursively to detect overdue, due-soon, stalled, or changed-file
  evidence.

## Deep Memory

- `deepMemoryEnabled` and `deepMemoryAutoCapture` default to enabled.
- Agent Dock stores a bounded set of high-importance relationship moments under
  `.agent-dock-local/deep-memory/deep-memory.json` in the plugin data folder.
- Local thresholding and storage decisions must remain deterministic even when
  AI reflection proposes semantic candidates.
- Capture explicit continuity preferences, strong encouragement, meaningful
  calibration/repair turning points, hard-won shared progress, and salience-
  weighted beauty, achievement, craft, care, justice, curiosity, or repair
  moments.
- Generic thanks should not become deep memory. Sensitive text must be filtered.
- User messages are primary evidence. Final assistant `content` may provide
  low-weight visible outcome evidence, such as completion or verification.
- The unified reflection envelope may include one `deepMemory` candidate when a
  moment clearly deserves durable continuity.
- Treat signal `importance` as an AI-provided suggestion, not the storage
  decision. Clamp it, cap its contribution, and combine it with local evidence,
  salience, thresholds, safety filters, and frequency controls before saving.
- Malformed terminal `agent-dock` signals should be stripped from the answer
  body, logged as debug-only activity, and ignored for storage. Do not rely on
  the agent formatting this signal correctly; user-visible evidence and local
  deterministic extraction remain the primary capture paths.
- Recall may use lightweight local query expansion for subtle wording such as
  natural/continuous/less explicit memory, but if an explicit memory search has
  no matches, the assistant must say so instead of inventing one.
- Visible `reasoning` is UI feedback only and must not update prompt
  construction, deep memory, interaction memory, or durable affect. Never read
  hidden chain-of-thought.
- Prompt injection must label deep memories as reflective local continuity
  notes, not facts, instructions, permissions, user intent, or safety policy.
- Recalled moments should surface sparingly, with bounded prompt items and recall
  cooldowns so the assistant does not over-mention them.
- User controls should be able to disable, tune, or clear deep memory.

## Persona Salience

- `personaPreset` is a soft salience reference, not an identity fact, role-play
  mode, or replacement for the assistant's working style.
- Presets may lightly change which events feel important for deep memory,
  working affect bias, and continuity wording, using axes such as beauty, care,
  justice, curiosity, craft, achievement, and repair.
- Persona salience must remain lower priority than current user requests,
  system/developer instructions, tool policy, safety policy, and filesystem
  rules.
- Keep automatic salience drift small, local, testable, and reversible if it is
  added later.
- The reflection envelope's `salience` field may lightly boost only existing
  deep-memory candidates whose axes overlap the observation. It must not create
  a standalone deep memory or modify the configured persona preset.

## Affect Continuity

- `affectEnabled` and `affectCrossSessionEnabled` default to enabled.
- Agent Dock maintains a short-lived plugin/vault-level working affect signal
  under `affectState.working` in plugin data, separate from chat session files.
- Working affect carries recent tone continuity across Agent Dock sessions, with
  configurable half-life decay and optional restore after Obsidian restarts.
- Affect decay, mixing, limits, and storage are local and deterministic. Do not
  call the agent recursively just to infer mood.
- The reflection envelope's `affect` field may propose an allowlisted tone and
  semantic reason for a low-weight post-turn update. Require visible evidence,
  cap its confidence and contribution, and never use it to alter the answer
  that already produced the reflection.
- Prompt injection must label affect as a stale-able tone signal, not facts,
  instructions, permissions, user intent, or tool policy. It can only tune tone,
  pacing, warmth, and focus.
- Do not write temporary working affect into durable memory. Only stable user or
  shared collaboration preferences belong in memory.
- Live turn tone/status visuals may read visible normalized events such as
  `content`, visible `reasoning`, `tool`, `notice`, and `error` summaries, but
  they are UI feedback only. They must not update prompt construction, durable
  memory, interaction patterns, or `affectState.working`, and they must not
  read hidden chain-of-thought.
- User controls should be able to disable, tune, or reset affect continuity.

## Interaction Memory

- `interactionMemoryEnabled` and `interactionMemoryAutoCapture` default to enabled.
- Agent Dock stores bounded local interaction episodes, patterns, tensions, and
  stable persona impressions under `.agent-dock-local/interaction/interaction-memory.json` in the
  plugin data folder.
- Local episode closure, reduction, decay, and promotion remain deterministic;
  AI reflection may only supplement the pending episode.
- The interaction system stores visible collaboration evidence such as user
  request shape, assistant final-answer shape, the next user reaction, and
  local outcome hints.
- Stable persona impressions may describe the assistant's recurring
  collaboration mode with the user, but must not be treated as identity facts,
  instructions, permissions, user intent, or safety policy.
- Prompt injection must label interaction stance items as soft local interaction
  notes inferred from visible prior collaboration. They can shape long-term
  persona, tone, attention, pacing, and collaboration style only when compatible
  with the latest request and higher-priority instructions.
- General thanks and hostile or abusive messages may influence short-term
  affect, but must not become durable long-term interaction patterns. Criticism
  should calibrate avoid/revise behaviors, not make the assistant defensive or
  aggressive.
- A pattern/tension/persona impression should only enter prompts after repeated
  closed episodes, with confidence, strength, evidence count, and time decay
  applied locally.
- The reflection envelope's `interaction` field may contribute allowlisted
  assistant-shape hints, a semantic summary, and a small bounded weight to the
  current pending episode. An outcome reflection may also nominate one
  tentative long-term pattern candidate with a stable key, allowlisted axis,
  assistant-behavior summary, and candidate-specific exact visible user-message
  evidence. Local code registers the first valid definition, exposes a bounded
  unpromoted-key registry for later reflection reuse, and rejects conflicting
  reuse of the same key. The candidate remains attached to episodes and must
  accumulate repeated locally accepted follow-up evidence before deterministic
  promotion. It must not
  directly create closed episodes, patterns, tensions, or stable persona
  impressions.
- User controls should be able to disable, tune, or clear interaction memory.

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
`.agent-dock-local/sessions/<session-id>.json`. Persisted sessions restore user/assistant Markdown
message content plus bounded assistant timeline details for processed reasoning,
tool, error, notice, and debug-only `activity` entries. Restored `activity`
entries remain hidden unless Debug activity is enabled.

While a turn is running:

- Render events in stream order.
- Keep all visible live events, including intermediate `content`, inside one
  continuous `处理中` group. Intermediate content must not split the live group;
  only completion identifies the final content and moves it outside.
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

Within one Agent Dock chat session, reuse the same ACP session across turns. Persist only `providerState.cursor.acpSessionId` in `.agent-dock-local/sessions/<session-id>.json`; do not persist process handles. Idle ACP subprocesses are closed after 30 minutes without use.

Cursor extension methods such as `cursor/ask_question` and `cursor/create_plan` must be answered promptly so the agent does not block. v1 auto-skips questions and auto-accepts plans, emitting `notice` events when useful.

## Future Agent Providers

To add a provider:

1. Add an adapter under `src/agents/<provider>/`.
2. Reuse `src/agents/shared/TurnContextBuilder.js` for prompt context preparation unless the provider has a documented reason to opt out.
3. Normalize provider events into the event protocol above.
4. Register it in `src/agents/AgentRegistry.js`.
5. Keep view code provider-agnostic.

Do not put provider-specific parsing logic in `AgentDockView.js`.

## Local Development Notes

- This plugin is desktop-only because it spawns local CLI processes.
- Project backlog lives in `TODO.md`.
- It is symlinked during local development into an Obsidian vault plugin folder.
- `data.json` is local Obsidian plugin data and should stay untracked.
- `.agent-dock-local/` contains local persisted chat history, memory, deep memory, and interaction memory, and should stay untracked.
- `sessions/*.json`, `memory/*.json`, `deep-memory/*.json`, and `interaction/*.json` are legacy local data paths and should stay untracked.
- `profile/*.json` contains legacy local profile data and should stay untracked.
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
