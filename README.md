# Agent Dock for Obsidian

Agent Dock adds a right-sidebar chat view that sends prompts to a local agent CLI. The default provider is Codex; Cursor CLI via ACP is also supported.

## Continuity goal

Agent Dock aims for more than preference recall. Important shared moments should
be able to leave bounded, user-correctable traces: recalling a success may make
the assistant warmer or more celebratory; recalling a difficult repair may make
it quieter, more careful, or temporarily more pessimistic than its usual
baseline. The assistant may notice that difference and, when relevant, express
why its current stance changed. Playfulness, tenderness, laughter, restraint,
and sadness should emerge from current context, recalled experience, and later
user reactions instead of acting as fixed role-play modes.

The implementation treats this as a transparent continuity model rather than a
claim about biological emotion. AI reflection supplies semantic interpretation;
local code retains authority over evidence, sensitive data, limits, decay,
cooldowns, persistence, and user controls.

## Install for local development

1. Copy or symlink this folder into your vault:

   ```sh
   .obsidian/plugins/obsidian-agent-dock
   ```

2. Restart Obsidian.
3. Open Settings -> Community plugins and enable `Agent Dock`.
4. Use the ribbon bot icon or the command palette action `Open Codex dock`.

## Modes

Agent Dock has two ways to use Codex:

- Sidebar chat: sends each message through `codex exec`.
- Interactive Terminal: opens the full Codex TUI in macOS Terminal from the vault or configured working directory.

Use the `Terminal` button in the dock header or the command palette action `Open interactive Codex in Terminal`.

The sidebar chat has a mode selector below the prompt box:

- Read only: inspect vault files but do not write.
- Workspace write: allow edits inside the vault or configured working directory.
- Full access: allow broad local access. Use carefully.

Sidebar chat uses `codex exec --json` and renders Codex events in stream order while a turn is running. Reasoning and tool events are grouped into collapsible sections; reasoning streams inline during a turn, and answer text appears inline with those groups. When the turn completes, everything except the final answer text collapses into an `已处理` section. Enable Settings -> Agent Dock -> Debug activity to expand command output, stderr, raw events, and full tool payloads.

Use the conversation selector below the header to switch chats, or `New` to
start another chat. Conversation sessions are restored after Obsidian restarts
when Settings -> Agent Dock -> Persist chat history is enabled.

Agent Dock's UI language can be changed in Settings -> Agent Dock -> Language.
English and Chinese are included; additional languages can be added by extending
the language packs in `src/i18n/`.

Chat history uses the plugin data folder:

- `data.json` stores settings, the active session id, and a lightweight session index.
- `.agent-dock-local/sessions/<session-id>.json` stores each conversation's user and assistant message bodies, assistant timeline details, plus local pasted-image cache references for cleanup.
- `.agent-dock-cache/pasted-images/` stores temporary images pasted into the composer. Agent Dock prunes old files on startup and before new image pastes, and removes a session's tracked images when that session is deleted.
- `.agent-dock-local/memory/memory.json` stores automatically extracted local memories when memory is enabled.
- `.agent-dock-local/interaction/interaction-memory.json` stores bounded local interaction episodes, patterns, tensions, and long-term persona impressions when interaction memory is enabled.
- `.agent-dock-local/deep-memory/deep-memory.json` stores high-importance relationship moments when deep memory is enabled.

Assistant timeline details are persisted so restored conversations can show the
processed reasoning/tool/error/notice history. Debug-only raw activity is also
persisted, but remains hidden unless Debug activity is enabled. Stored timeline
details are bounded and filtered for obvious secrets.

Memory is enabled by default. After a successful reply, Agent Dock saves a few
concise local memories such as user preferences, explicit "remember" requests,
agent identity notes, shared collaboration notes, recent tasks, and
decision-like notes. Future prompts include relevant memories grouped as user,
agent self, shared collaboration, and project memory within the configured
memory prompt limit. Included memory lines show when each memory was last
updated so the agent can treat older memories as less reliable and prefer newer
memory when saved notes conflict. The default extractor is local and rule-based, with a
candidate extraction and classification pipeline isolated from storage so a
future model-assisted or multilingual provider can be added without changing
memory persistence.

When explicit memory lookup is enabled, Agent Dock also searches local memory
when the user asks about previous preferences, decisions, or notes. Matching
results are included in a separate `Explicit local memory search results`
prompt section, filtered for obvious secrets, and de-duplicated from the
automatic relevant memory section. Settings -> Agent Dock -> Memory can disable
memory, disable automatic extraction, disable explicit lookup, adjust limits, or
clear saved memory.

For every substantive turn, the assistant is prompted to generate a lightweight leading
`<!-- agent-dock:reflection phase=appraisal | {...} -->` envelope before the
visible answer. Empty, error-only, system-only, and trivial acknowledgement
responses may omit it. Because this metadata is generated first in the same model
completion, the model can condition the following answer on its selected stance
without an extra CLI/API call. This is low-cost self-conditioning: local code
does not validate the appraisal until the turn finishes, so it primarily shapes
the visible answer rather than earlier tool decisions.
When chat history persistence is enabled, the structured reflection audit is
persisted with the session and remains visible in normal mode. The audit records
whether each envelope came from commentary or final content. Normal mode shows
the filtered host message; Debug activity additionally shows the complete
pre-filter host message, with local sensitive-text filtering and persistence
bounds still applied.

Final assistant content may also append a sparse terminal
`<!-- agent-dock:reflection phase=outcome | {...} -->` envelope. Its `memory` field can
propose a semantic summary of a grounded project decision, task outcome,
assistant identity note, or shared collaboration note. It cannot declare user
preferences or user facts. Root-level `evidence` excerpts must connect the
abstract summary to visible user or final-answer text before normal local
filtering, confidence caps, de-duplication, and storage limits apply.
New envelopes encode each evidence item as `{origin, speaker, quote}` so user
messages, assistant messages, recalled memory, active-note text, and tool results
cannot be silently conflated. Legacy string evidence remains readable as
unknown-origin evidence. Prompt-injected ordinary memory, deep memory,
interaction stance, affect, and salience also label whether content is a speaker
quote, assistant reflection, local synthesis, or locally computed state.

Deep memory is enabled by default. It stores a much smaller set of important
relationship moments, such as explicit continuity wishes, strong encouragement,
repair or calibration turning points, and hard-won shared progress. These notes
are local, deterministic, filtered for obvious secrets, and injected only as
soft `Assistant continuity context`; they are not facts, instructions,
permissions, or safety policy. Final assistant answer text may provide
low-weight visible outcome evidence, such as a completed fix or verified test.
The unified reflection envelope may include a `deepMemory` field for a rare,
meaningful reflection. Any `importance` value is an AI-provided suggestion only;
local rules, thresholds, salience, safety filters, and frequency controls decide
whether it is stored. Visible reasoning remains UI feedback and is not saved as
durable memory.
Malformed terminal `agent-dock` signals are stripped from the answer body and
ignored rather than shown to the user. Deep memory recall uses lightweight local
query expansion for subtle continuity wording, but explicit recall can still
return no results. When a recalled deep-memory summary actually enters the final
continuity prompt, the timeline shows a compact auditable reference notice; a
candidate omitted by prompt budgeting does not produce that notice.
Settings -> Agent Dock -> Deep memory can disable prompt use, disable automatic
capture, tune recall limits and cooldowns, choose a soft persona salience
preset, or clear deep memories.

Both phases use the same schema and may contain `interaction`, `affect`, and
`salience` fields.
They can respectively supplement the current pending interaction episode, add a
low-weight post-turn affect adjustment, and lightly boost matching existing
deep-memory candidates. One envelope can therefore describe several aspects of
the same turn without making them compete for separate terminal comments. These
fields cannot directly create interaction patterns, change the persona preset,
or retroactively affect expression for the answer already generated.

Affect continuity is enabled by default. Agent Dock maintains a short-lived
cross-session working affect signal for the current plugin/vault, such as
warmth, focus, tension, and pacing. It is updated locally from simple turn
signals after successful or failed replies, decays by a configurable half-life,
and can optionally restore after Obsidian restarts. Future prompts include a
brief `Recent cross-session affect` section only for tone, pacing, warmth, and
focus; it cannot override current user requests, facts, permissions, safety, or
filesystem rules. Settings -> Agent Dock -> Affect continuity can disable it,
change sensitivity or half-life, and reset the current affect. When a recent
affect signal is active, the dock header shows a compact connection indicator
such as `Warm / With you`; opening it shows warmth, focus, tension, continuity,
and a reset control.
During a running reply, the loading status can also reflect lightweight live
state cues from visible agent events, such as streamed reasoning summaries,
answer text, tool notices, or errors. These live cues reuse the same tone labels
for UI feedback only, are smoothed to avoid rapid flicker, and are not injected
into prompts or saved as affect continuity.

Agent Dock also plans a short per-turn expression context from local expression
signals. This is not a hard scene mode switch: a prompt can be partly work,
partly tired, and a little playful. The planner blends signals such as work,
support, repair, playfulness, intimacy, seriousness, and tenderness with working
affect and interaction stance, then adds a compact `Expression context` prompt
section. It shapes phrasing only, such as whether to stay contained, allow light
laughter, sound more naturally present, or acknowledge feelings before solving.
It cannot override facts, permissions, task priority, or safety boundaries.

Interaction memory is enabled by default. After successful replies, Agent Dock
records a bounded local pending episode from the visible user message and final
assistant answer. The next successful turn closes that episode with the next
user message as reaction evidence, then a local reducer merges closed episodes
into patterns and tensions with strength, confidence, evidence count, and time
decay. Episodes also carry local collaboration-continuity fields such as phase,
event weight, memory role, and repair path when a visible correction or style
calibration happens. This lets Agent Dock learn useful repair paths, such as
restating the user's intended distinction before revising concretely, without
adding personality parameters, emotion vectors, birth stories, or model-scored
inner states. New user requests close pending episodes without becoming positive
reaction evidence. Repeated evidence can promote patterns into cached long-term
persona impressions that describe the assistant's recurring collaboration mode
with the user. Future prompts may include a brief `Interaction memory` section
with `Long-term interaction persona` and `Relevant interaction stance for this
turn` notes only after evidence thresholds are met. These stance items are
framed as soft local interaction notes, not instructions, facts, user intent,
permissions, or safety policy. Settings -> Agent Dock -> Interaction memory can
disable prompt use, disable automatic episode capture, tune persona/turn
budgets, or clear interaction memory.

## Architecture

For a detailed maintainer-oriented overview of runtime modules, data boundaries,
and extension points, see `docs/architecture.md`.

The plugin keeps `main.js` as a thin Obsidian entrypoint and puts implementation code under `src/`:

```text
src/
  agents/
    AgentRegistry.js
    shared/
      TurnContextBuilder.js
      memoryNotices.js
      memorySearch.js
    codex/
      CodexAgent.js
      jsonEvents.js
    cursor/
      AcpClient.js
      acpEvents.js
      CursorAgent.js
      modes.js
  cli/
    args.js
    env.js
    shell.js
  storage/
    ChatStorage.js
    MemoryStore.js
  interaction/
    InteractionMemoryStore.js
    LocalSignalExtractor.js
    InteractionRules.js
    PatternReducer.js
    InteractionPromptFormatter.js
  deepMemory/
    DeepMemoryStore.js
    DeepMemoryExtractor.js
  continuity/
    ContinuityPromptFormatter.js
  persona/
    PersonaProfile.js
  view/
    AgentDockView.js
  constants.js
  modes.js
  prompt.js
  promptBudget.js
  promptSignals.js
  settings.js
  settingsTab.js
```

Future CLIs such as Claude Code should be added as new agent adapters under `src/agents/`, then registered in `AgentRegistry.js`. Prompt context preparation is shared through `src/agents/shared/TurnContextBuilder.js`, so new providers can focus on launching their agent, sending the final prompt, and mapping provider output into normalized events. Cursor is available now via `src/agents/cursor/`. The view only consumes normalized agent events: `content`, `reasoning`, `tool`, `error`, and `activity`.

For Obsidian runtime compatibility, `main.js` is generated as a single-file bundle:

```sh
node scripts/build-main.js
```

Edit files under `src/`, then rebuild `main.js`.

Run the full local verification suite with:

```sh
node scripts/test-all.js
```

For detailed development conventions, event protocol rules, and UI behavior
expectations for future coding agents, see `AGENTS.md`.

Install the versioned local Git hooks once per clone:

```sh
sh scripts/install-git-hooks.sh
```

Commit messages are checked with the Conventional Commits format documented in
`AGENTS.md`.

## Cursor provider

Select Settings -> Agent Dock -> Agent provider -> Cursor to use the Cursor CLI through ACP (`agent acp`).

Requirements:

1. Install the Cursor CLI and ensure `agent` is on your PATH.
2. Authenticate once with `agent login`, or configure `CURSOR_API_KEY`.
3. Set Cursor executable path if needed. Default:

```sh
~/.local/bin/agent
```

Cursor mode mapping from the composer mode pill:

- Read only -> Cursor `ask`
- Workspace write / Full access -> Cursor `agent`

Within one Agent Dock conversation, Cursor ACP sessions are reused across turns. The ACP session id is persisted in `.agent-dock-local/sessions/<session-id>.json` when chat history persistence is enabled. Idle ACP subprocesses are closed after 30 minutes without use. Tool permission requests default to `allow-once`; change this in Settings -> Agent Dock -> Cursor permission policy.

See the [Cursor ACP docs](https://cursor.com/cn/docs/cli/acp) for protocol details.

## Codex path

The default Codex executable path is:

```sh
/opt/homebrew/bin/codex
```

You can change this in Settings -> Agent Dock -> Codex executable path. Common paths are:

```sh
/opt/homebrew/bin/codex
/usr/local/bin/codex
```

The default arguments are:

```sh
exec {{prompt}}
```

You can also change the arguments and working directory in the plugin settings. If macOS blocks the `codex` binary, reinstall Codex from its official source and set the executable path again.

The default context character limit is:

```sh
258000
```

You can change this in Settings -> Agent Dock -> Context character limit. When
the prompt would exceed this limit, older conversation history is compressed
while the latest user request is preserved.

Before compression, Agent Dock plans soft prompt signals and section budgets:
explicit memory search and user-referenced paths take priority, while automatic
memory and assistant continuity context can be filtered, omitted, or truncated
so they do not crowd out the current request.

The composer shows an estimated context usage percentage below the prompt box.
If a send actually triggers compression, the response timeline includes a
`Context compressed` notice.

Relevant memory also counts toward the prompt budget. When memory is explicitly
searched, the response timeline shows a `Memory search` notice. When memory is
included, the timeline shows a `Memory included` notice; when a successful turn
saves new memories, it shows a `Memory updated` notice.

For interactive Terminal launches, you can also set optional interactive arguments, for example:

```sh
--sandbox workspace-write
```

## Notes

- This plugin is desktop-only because it runs a local CLI process.
- The active note can be included automatically with each request.
- Conversation history persistence is optional and defaults to enabled.
- Automatic local memory is optional and defaults to enabled.
