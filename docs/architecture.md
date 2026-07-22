# Architecture

## Runtime

Obsidian loads the generated `main.js`. Source modules live under `src/` and are
bundled by `scripts/build-main.js`.

```text
AgentDockPlugin
  ├─ AgentRegistry ── CodexAgent / CursorAgent
  ├─ ChatStorage
  └─ AgentDockView
       ├─ references and composer
       ├─ session and queue management
       ├─ normalized timeline rendering
       └─ current-turn tone capsule
```

`src/plugin.js` owns plugin lifecycle, provider creation, settings, diagnostics,
and chat storage. It does not own provider parsing or view session state.

## Turn flow

1. `AgentDockView` creates user and assistant message objects.
2. `ChatTurnRunner` starts the selected provider and appends normalized events.
3. `TurnContextBuilder` builds a bounded prompt from response style, workspace
   boundary, referenced paths, conversation history, and the current request.
4. The provider runs in the current vault or configured working directory.
5. Provider-specific event parsers emit `content`, `reasoning`, `tool`, `error`,
   `notice`, or debug-only `activity` events.
6. The timeline keeps live events in one processing group and exposes the last
   content event as the final answer when the turn completes.
7. Chat persistence writes only the bounded, normalized session fields.

Context compression is deterministic and local. It preserves stable boundary
instructions and the newest user request before trimming older conversation.

## Provider boundary

`src/agents/AgentRegistry.js` defines provider descriptors:

```js
{
  label,
  description,
  create(plugin),
  diagnose(plugin)
}
```

Diagnostics report the executable path, version, authentication status, and an
actionable message. Provider adapters own process execution and protocol parsing.
The view remains provider-agnostic.

Codex uses `codex exec --json --output-last-message`. Cursor uses ACP over stdio
and stores only the ACP session id in the Agent Dock session's provider state.

## Normalized events

- `content`: assistant answer text.
- `reasoning`: visible progress or reasoning summaries.
- `tool`: commands, searches, generic tools, and file changes.
- `error`: user-visible failures.
- `notice`: context, connection, and provider notices.
- `activity`: low-level debug information, hidden by default.

File modifications use this provider-neutral shape:

```js
{
  kind: "tool",
  toolType: "file_change",
  paths: [],
  title,
  summary,
  detail
}
```

Vault-relative paths are rendered as buttons that open the changed note.

## Permissions

`src/modes.js` is the local authority for the two public modes:

- `readOnly`: Codex `read-only`; Cursor ACP `ask`.
- `workspaceWrite`: Codex `workspace-write`; Cursor ACP `agent`.

Read only is the default. The first switch to workspace write requires an
explicit acknowledgment. There is no Full access mode.

## Tone capsule boundary

`src/view/turn/TurnToneCapsule.js` owns the 12 expressive current-turn states.
It can read only the current request and visible normalized events. It ignores
debug activity and never reads full command output. Strong, weak, blocked, and
priority rules are deterministic.

`TurnStatusController` owns minimum display time and short shared transitions.
`EmotiveFeedbackController` owns DOM-bound animation and particles. Tone capsule
state is deliberately absent from `ChatStorage` serialization.

## Persistence

Plugin data contains only schema version, settings, and lightweight chat state.
Full session bodies are stored under `.agent-dock-local/sessions/` when history
persistence is enabled. Pasted image cache files are stored separately and
cleaned locally.

There is no memory, persona, affect, reflection, interaction-profile, or
cross-session continuity subsystem.

## Adding a provider

1. Add an adapter under `src/agents/<provider>/`.
2. Use `TurnContextBuilder` for the shared prompt boundary.
3. Normalize provider events before they reach the view.
4. Add `create(plugin)` and `diagnose(plugin)` to `AgentRegistry`.
5. Add focused protocol, diagnostics, and event-mapping tests.

Do not place provider parsing in `AgentDockView`.
