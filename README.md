# Agent Dock

Agent Dock is a desktop-only Obsidian community plugin that brings local coding
agents into the right sidebar. Ask questions about the current note, search the
vault with local file tools, or let an agent organize and edit notes after you
explicitly enable workspace write access.

All agent work runs through a CLI installed on your computer. Agent Dock does
not provide cloud indexing, a vector database, or product telemetry.

## Core workflows

- **Ask about the current note** — start with the active note as the agent's
  first inspection target.
- **Search the knowledge base** — let Codex or Cursor use local file search and
  reading tools across the vault.
- **Organize or modify notes** — review reasoning, commands, and changed files in
  the timeline. Writing is disabled until you switch from Read only to Workspace
  write and acknowledge the permission change.

Agent Dock also supports `@file` and `@folder` references, Obsidian links,
drag-and-drop references, pasted images, multiple chat sessions, queued prompts,
background turns, stopping, and local chat-history persistence.

## Providers

### Codex

Install and authenticate the OpenAI Codex CLI, then configure its executable
path if it is not available at `/opt/homebrew/bin/codex`.

Agent Dock runs Codex with JSON events and a sandbox matching the selected mode.
The model control beside the message composer lists models available to the
signed-in CLI account and shows Codex's effective default. Leaving the field
empty uses that default.

### Cursor

Install and authenticate the Cursor Agent CLI. The default path is
`~/.local/bin/agent`; authentication can be completed with `agent login` or a
supported `CURSOR_API_KEY` configuration.

Agent Dock communicates with Cursor through ACP over stdio and reuses the ACP
session for each Agent Dock chat session.
The model control lists models available to the signed-in Cursor account and
identifies its default. Changing the model applies on the next message and
creates a fresh ACP session for that chat.

## Getting started

1. Install the plugin files in `.obsidian/plugins/obsidian-agent-dock/`.
2. Enable Agent Dock in Obsidian's Community plugins settings.
3. Open Agent Dock from the ribbon or command palette.
4. Choose Codex or Cursor in the first-run guide.
5. Check the CLI version and authentication status.
6. Run the explicit read-only connection test.
7. Choose one of the three starter tasks.

The default working directory is the current vault. An external working
directory is available as an advanced setting.

## Permissions

Agent Dock exposes two modes:

- **Read only** — inspect and search files without changing them. This is the
  default.
- **Workspace write** — allow changes inside the vault or configured workspace.
  The first switch requires confirmation.

There is no Full access mode and no separate interactive Terminal launcher.

## Tone capsules

While a turn runs, Agent Dock can show one concise local status such as
“盯住重点”, “眼前一亮”, “星星眼”, or “小小庆祝”. The 12 expressive capsules
are selected only from the current user request and visible events in the
current turn.

Tone capsules:

- do not enter the provider prompt;
- do not call a model;
- do not read hidden reasoning or debug activity;
- do not persist in plugin data or chat sessions;
- respect `prefers-reduced-motion`.

They can be disabled in Settings → Answer experience.

## Privacy and local data

Agent Dock has no product telemetry and creates no cloud knowledge-base index.
Provider CLIs may communicate with their own services according to the
provider's terms and configuration.

Local data lives in the plugin folder:

- Obsidian plugin settings and the lightweight chat index: `data.json`
- chat bodies: `.agent-dock-local/sessions/<session-id>.json`
- temporary pasted-image cache: `.agent-dock-local/pasted-images/`

See [docs/privacy.md](docs/privacy.md) for details.

## Development

Source lives under `src/`. Obsidian loads the generated `main.js`, so rebuild it
after every source change:

```sh
node scripts/build-main.js
```

Run the full verification suite before handing off changes:

```sh
node scripts/test-all.js
```

Architecture and provider extension guidance are in
[docs/architecture.md](docs/architecture.md). Release steps are in
[docs/release-checklist.md](docs/release-checklist.md).

## License

MIT
