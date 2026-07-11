---
name: commit-hygiene
description: Prepare safe, reviewable git commits. Use when asked to commit, stage changes, prepare a commit, check commit readiness, write a commit message, or enforce pre-commit hygiene including staged-diff review, serious issue warnings, documentation update checks, verification, and Conventional Commit naming.
---

# Commit Hygiene

## Overview

Use this skill before creating a git commit. The goal is to commit only coherent,
reviewed, verified changes with an accurate Conventional Commit message.

Default to acting: inspect, verify, stage, and commit when the user asked for a
commit. Stop before committing only when a serious issue needs user attention.

Use the focused checks in this skill for ordinary commit preparation. Do not
invoke `code-review-expert` unless the user explicitly requested a formal code
review or a serious finding needs a dedicated severity-ranked report. If a
minor issue is safe to correct within the user's commit request, fix it without
adding a duplicate review-confirmation step.

## Workflow

1. Inspect repository state.
   - Run `git status -sb`.
   - Review `git diff --stat`, unstaged diff, and staged diff as appropriate.
   - Identify unrelated user changes and avoid staging them.

2. Review the commit contents before committing.
   - Check correctness, security/privacy risks, data loss risks, generated-file drift, and missing verification.
   - If you find a serious issue, stop and tell the user before committing.
   - If the issue is minor and safe to fix, fix it before committing when the user's request allows implementation.

3. Check documentation impact.
   - Decide whether README, AGENTS.md, settings/help text, changelogs, API docs, or user-facing docs need updates.
   - Update relevant docs in the same commit when behavior, setup, commands, settings, storage paths, or workflows changed.
   - If no docs are needed, mention that in the final summary when useful.

4. Verify.
   - Run the project's documented build, test, lint, typecheck, or syntax-check commands.
   - If the project has generated artifacts, regenerate and include them when required.
   - If verification cannot be run, state why before or after the commit as appropriate.

5. Stage deliberately.
   - Stage only files related to the requested change.
   - Re-check `git diff --cached --stat` before committing.
   - Watch for local data, secrets, logs, caches, histories, or environment files.

6. Commit with a Conventional Commit message.
   - Use `<type>(optional-scope): <description>`.
   - Keep the description imperative, concise, lowercase unless naming code, and ideally under 72 characters.
   - Include a body when needed for rationale, migration notes, or breaking changes.

## Conventional Commit Types

Prefer these common types:

- `feat`: user-facing feature or capability
- `fix`: bug fix
- `docs`: documentation-only change
- `style`: formatting or whitespace only, no behavior change
- `refactor`: code change that is neither a feature nor a bug fix
- `perf`: performance improvement
- `test`: add or update tests
- `build`: build system, bundling, dependency, or generated build artifact change
- `ci`: CI configuration or workflow change
- `chore`: maintenance that does not affect runtime behavior
- `revert`: revert a previous commit

## Scope Suggestions

Choose a scope when it clarifies ownership or review area. Prefer existing
package, feature, module, or domain names over inventing broad labels.

Useful generic scopes:

- `api`, `auth`, `build`, `cli`, `config`, `db`, `docs`, `ui`
- `settings`, `storage`, `tests`, `types`, `deps`, `release`

For frontend or app projects, consider:

- `view`, `components`, `styles`, `routes`, `state`, `forms`

For agent/tooling projects, consider:

- `agent`, `prompt`, `tools`, `mcp`, `memory`, `sandbox`, `workflow`

For Obsidian plugin projects, consider:

- `view`, `codex`, `prompt`, `settings`, `styles`, `storage`, `build`

Examples:

```text
feat(storage): persist chat sessions
fix(view): preserve final answer
docs(settings): describe history retention
build(bundle): regenerate main entrypoint
```

## Breaking Changes

Use `!` after the type or scope for breaking changes and add a body:

```text
feat(settings)!: remove legacy ask mode

BREAKING CHANGE: existing ask mode settings are migrated to readOnly.
```

## Final Response

After committing, report:

- commit hash and message
- verification run
- any skipped checks or residual risk
- whether docs were updated or judged unnecessary
