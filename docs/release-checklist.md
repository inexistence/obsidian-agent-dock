# Release checklist

- Confirm `manifest.json` version and description.
- Confirm `versions.json` maps the release to the minimum Obsidian version.
- Run `node scripts/test-all.js` and verify `main.js` was rebuilt.
- Run `git diff --check`.
- Test first-run onboarding for Codex and Cursor.
- Test missing executable, bad path, unauthenticated CLI, timeout, and permission
  failures.
- Confirm Read only is the default and Workspace write asks once for approval.
- Test current-note, vault-search, and note-modification starters.
- Confirm file-change paths open vault files.
- Test narrow sidebar layout and `prefers-reduced-motion`.
- Confirm no telemetry, cloud index, memory, persona, affect, reflection, Full
  access, or interactive Terminal code remains.
- Review README, privacy statement, license, screenshots, and provider
  prerequisites.
- Package `main.js`, `manifest.json`, and `styles.css` for the release.
