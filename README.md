# Agent Dock for Obsidian

Agent Dock adds a right-sidebar chat view that sends prompts to the local Codex CLI.

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

Sidebar chat uses `codex exec --json` and renders Codex events in stream order while a turn is running. Consecutive reasoning and tool events are grouped into collapsed sections, and answer text appears inline with those groups. When the turn completes, everything except the final answer text collapses into an `已处理` section. Enable Settings -> Agent Dock -> Debug activity to expand command output, stderr, raw events, and full tool payloads. Hidden model reasoning is not exposed.

Use the conversation selector below the header to switch chats, or `New` to
start another chat. Conversation sessions are restored after Obsidian restarts
when Settings -> Agent Dock -> Persist chat history is enabled.

Chat history uses the plugin data folder:

- `data.json` stores settings, the active session id, and a lightweight session index.
- `sessions/<session-id>.json` stores each conversation's user and assistant message bodies.

Tool and reasoning timeline details are not persisted; restored conversations
show the final Markdown message content and can continue as normal context.

## Architecture

The plugin keeps `main.js` as a thin Obsidian entrypoint and puts implementation code under `src/`:

```text
src/
  agents/
    AgentRegistry.js
    codex/
      CodexAgent.js
      jsonEvents.js
  cli/
    args.js
    env.js
    shell.js
  storage/
    ChatStorage.js
  view/
    AgentDockView.js
  constants.js
  modes.js
  prompt.js
  settings.js
  settingsTab.js
```

Future CLIs such as Claude Code or Cursor should be added as new agent adapters under `src/agents/`, then registered in `AgentRegistry.js`. The view only consumes normalized agent events: `content`, `reasoning`, `tool`, `error`, and `activity`.

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

For interactive Terminal launches, you can also set optional interactive arguments, for example:

```sh
--sandbox workspace-write
```

## Notes

- This plugin is desktop-only because it runs a local CLI process.
- The active note can be included automatically with each request.
- Conversation history persistence is optional and defaults to enabled.
