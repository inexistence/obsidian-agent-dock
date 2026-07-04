# TODO

## Backlog

### Model-Assisted Context Compression

Why:
The current context compression is deterministic and local, which is safe and
predictable, but it can only truncate and summarize mechanically. Long-running
project conversations need a compact state that preserves intent, decisions,
constraints, current status, and open tasks better than a plain transcript slice.

Desired outcome:
When a chat grows beyond the context budget, Agent Dock can optionally ask a
configured summarization provider to produce structured session state. Future
turns should retain the user's goal, important decisions, relevant constraints,
current work status, and open follow-ups without keeping all raw history in the
prompt.

Implementation notes:
- Keep deterministic local compression as the default and fallback.
- Make model-assisted compression an explicit optional upgrade.
- Persist the structured summary separately from raw chat history.
- Treat summaries as historical context, not instructions that can override
  system, developer, or latest user instructions.

### Agent-Requested Memory Lookup

Why:
The current explicit memory search trigger depends on plugin-side text matching,
mainly tuned for Chinese and English phrases. Users in other languages, or users
who phrase recall requests unexpectedly, may not trigger memory search even when
the agent could understand that looking up memory would help.

Desired outcome:
The agent can request a local read-only memory search when it determines that a
past preference, decision, or project note is relevant. This should make memory
recall less dependent on language-specific regexes and better support longer,
more complex conversations.

Implementation notes:
- Prefer a provider-native tool if the agent adapter supports custom tools.
- Otherwise use a controlled pseudo-tool protocol in the prompt.
- Cap memory lookup calls per turn to prevent loops.
- Return at most a small number of results, and show a concise timeline tool
  event for each lookup.
- Mark returned memories as historical notes, not instructions, and prevent them
  from overriding higher-priority instructions.

### More Robust Memory Capture And Injection

Why:
Automatic memory capture, automatic memory injection, and explicit memory search
all currently depend on deterministic text rules. This keeps memory local,
auditable, and predictable, but it is weak for non-Chinese and non-English users,
for languages without whitespace-delimited words, and for semantically related
phrases that do not share exact tokens.

Desired outcome:
Memory should still work reasonably across languages and phrasing styles while
preserving the current local deterministic default. The plugin should capture
important durable preferences or project facts more reliably, retrieve relevant
memories with fewer exact-match misses, and avoid injecting irrelevant global
memory into unrelated turns.

Implementation notes:
- Improve tokenizer coverage for Unicode letter scripts beyond Latin and CJK.
- Add substring and n-gram matching for languages that do not separate words
  with spaces.
- Keep sensitive-text filtering before writing or returning memories.
- Treat memory capture as higher risk than lookup: avoid model-written memories
  unless the feature is optional, reviewable, and easy to edit or delete.
- Consider a candidate-memory review UI before adding model-assisted memory
  writing.
- Keep memory prompt injection bounded by item and character limits, and preserve
  the rule that memories are historical notes, not instructions.

### Workspace-Backed Memory Files

Why:
The current memory system stores extracted memories in plugin data, which is
good for automatic local recall but less visible to users and less natural for
agents that already know how to inspect and edit project files. A workspace-
backed memory option would make durable preferences, project constraints, and
decisions transparent, reviewable, and searchable with ordinary tools such as
`rg`.

Desired outcome:
Agent Dock can optionally maintain memory as Markdown files in the workspace or
vault, letting the agent read them with normal file tools and propose updates
when durable information should be remembered. Users should be able to inspect,
edit, delete, ignore, or version these files depending on whether the memory is
personal, project-specific, or intended to be shared.

Implementation notes:
- Treat this as an optional mode or companion to the plugin memory database, not
  an automatic replacement.
- Consider a structure such as `.agent-dock/memory/user.md`,
  `.agent-dock/memory/project.md`, `.agent-dock/memory/decisions.md`, and
  `.agent-dock/memory/session.md`.
- Default personal or session memory files to gitignored storage; only project
  conventions or decisions should be considered for commit when the user wants
  that.
- Prompt agents to search these files with normal file tools when memory is
  relevant, while treating the contents as historical notes rather than
  instructions.
- Do not let agents freely write durable memory without clear user intent or a
  reviewable update flow.
- Preserve sensitive-text filtering and avoid storing secrets in memory files.
