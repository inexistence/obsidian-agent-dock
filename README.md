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

- Ask: answer questions without changing files.
- Read only: inspect vault files but do not write.
- Workspace write: allow edits inside the vault or configured working directory.
- Full access: allow broad local access. Use carefully.

Sidebar chat uses `codex exec --json` and renders Codex events in stream order. Reasoning summaries, tool calls, errors, and answer text appear in the same timeline. Details such as command output, stderr, raw events, and full tool payloads are hidden by default; enable Settings -> Agent Dock -> Debug activity to expand those details. Hidden model reasoning is not exposed.

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
  view/
    AgentDockView.js
  constants.js
  modes.js
  prompt.js
  settings.js
  settingsTab.js
```

Future CLIs such as Claude Code or Cursor should be added as new agent adapters under `src/agents/`, then registered in `AgentRegistry.js`. The view only consumes normalized agent events: `message`, `reasoning`, `tool`, `error`, and `activity`.

For Obsidian runtime compatibility, `main.js` is generated as a single-file bundle:

```sh
node scripts/build-main.js
```

Edit files under `src/`, then rebuild `main.js`.

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

For interactive Terminal launches, you can also set optional interactive arguments, for example:

```sh
--sandbox workspace-write
```

## Notes

- This plugin is desktop-only because it runs a local CLI process.
- The active note can be included automatically with each request.
- Conversation history is kept only in the sidebar session for now.
