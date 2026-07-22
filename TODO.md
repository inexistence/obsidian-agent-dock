# TODO

## Retrieval experience

- Improve scoped vault-search prompts and reference previews without adding a
  plugin index or vector database.
- Make large folder references easier to inspect and narrow before sending.
- Add clearer “searched / read / not found” summaries for knowledge-base Q&A.

## File modification experience

- Produce clearer per-file modification summaries and rename/move indicators.
- Add a compact diff-review path before accepting larger workspace changes.
- Improve links for renamed, deleted, and external files while keeping vault
  paths safe by default.

## Provider extensions

- Document the normalized event compatibility checklist for new local CLIs.
- Improve authentication diagnostics with provider-supported status commands.
- Evaluate additional local Agent providers only after the Codex and Cursor
  onboarding paths are stable.

## Context quality

- Improve deterministic transcript compression while preserving the latest
  request and referenced-path scope.
- Add better local character-budget estimates for active note and image context.
- Keep any future summarization optional and provider-explicit; do not introduce
  hidden memory or cross-session profiling.

## Release quality

- Capture and add real Obsidian screenshots for the README and community listing.
- Add manual UI regression coverage for narrow sidebars and reduced motion.
- Validate macOS, Windows, and Linux executable discovery where supported by the
  provider CLIs.
