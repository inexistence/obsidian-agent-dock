# Privacy

Agent Dock runs configured Agent CLIs locally and does not include product
telemetry, analytics, advertising identifiers, a cloud vault index, or a local
vector database.

The selected provider CLI may send prompts, inspected file content, and tool
results to its provider according to that CLI's configuration, account, and
privacy terms. Agent Dock does not proxy those requests through an Agent Dock
service.

When enabled, chat history is stored under the plugin folder in
`.agent-dock-local/sessions/`. Settings and the lightweight session index are
stored in Obsidian's `data.json`. Pasted images used as references are copied to
`.agent-dock-local/pasted-images/` and cleaned locally.

Tone capsules are computed from the current request and visible current-turn
events. They are not sent to the provider and are not persisted.

Users can disable chat-history persistence and delete stored sessions from the
plugin UI. Uninstalling the plugin does not automatically remove provider CLI
accounts or provider-side data.
