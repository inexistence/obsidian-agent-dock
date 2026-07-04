# Agent Dock for Obsidian

Agent Dock adds a right-sidebar chat view that sends prompts to a local agent CLI. The default provider is Codex; Cursor CLI via ACP is also supported.

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
- `sessions/<session-id>.json` stores each conversation's user and assistant message bodies.
- `memory/memory.json` stores automatically extracted local memories when memory is enabled.

Tool and reasoning timeline details are not persisted; restored conversations
show the final Markdown message content and can continue as normal context.

Memory is enabled by default. After a successful reply, Agent Dock saves a few
concise local memories such as user preferences, explicit "remember" requests,
agent identity notes, shared collaboration notes, recent tasks, and
decision-like notes. Future prompts include relevant memories grouped as user,
agent self, shared collaboration, and project memory within the configured
memory prompt limit. The default extractor is local and rule-based, with a
candidate extraction and classification pipeline isolated from storage so a
future model-assisted or multilingual provider can be added without changing
memory persistence. Settings -> Agent Dock -> Memory can disable memory,
disable automatic extraction, adjust limits, or clear saved memory.

## Architecture

The plugin keeps `main.js` as a thin Obsidian entrypoint and puts implementation code under `src/`:

```text
src/
  agents/
    AgentRegistry.js
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
  view/
    AgentDockView.js
  constants.js
  modes.js
  prompt.js
  settings.js
  settingsTab.js
```

Future CLIs such as Claude Code should be added as new agent adapters under `src/agents/`, then registered in `AgentRegistry.js`. Cursor is available now via `src/agents/cursor/`. The view only consumes normalized agent events: `content`, `reasoning`, `tool`, `error`, and `activity`.

For Obsidian runtime compatibility, `main.js` is generated as a single-file bundle:

```sh
node scripts/build-main.js
```

Edit files under `src/`, then rebuild `main.js`.

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

Within one Agent Dock conversation, Cursor ACP sessions are reused across turns. The ACP session id is persisted in `sessions/<session-id>.json` when chat history persistence is enabled. Idle ACP subprocesses are closed after 30 minutes without use. Tool permission requests default to `allow-once`; change this in Settings -> Agent Dock -> Cursor permission policy.

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

The composer shows an estimated context usage percentage below the prompt box.
If a send actually triggers compression, the response timeline includes a
`Context compressed` notice.

Relevant memory also counts toward the prompt budget. When memory is included,
the response timeline shows a `Memory included` notice; when a successful turn
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
