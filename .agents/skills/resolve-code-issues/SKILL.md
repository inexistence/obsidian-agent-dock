---
name: resolve-code-issues
description: Diagnose and resolve software defects, regressions, failing tests, code review findings, PR feedback, static-analysis findings, and security review issues across languages and frameworks. Use when Codex needs to validate reported concerns, identify root causes, implement focused fixes, remove directly related dead or redundant code, align affected documentation, add regression coverage, and run project-defined verification.
---

# Resolve Code Issues

Resolve reported problems without mechanically accepting the report or accumulating repair debt. Preserve unrelated user work and adapt the workflow to the target repository.

## Select the operating mode

- Treat requests to investigate, diagnose, explain, review, or assess as read-only unless the user also asks for changes.
- Treat requests to fix, resolve, address, implement, or clean up as authorization for scoped repository edits.
- When a request explicitly combines review with fix, resolve, or address, do not ask for duplicate implementation confirmation after validating the findings.
- Ask for direction before making a product, architecture, compatibility, migration, or destructive decision that materially expands the requested scope.

## Discover project rules

1. Read applicable `AGENTS.md` files and repository instructions.
2. Inspect the working tree and preserve unrelated or pre-existing changes.
3. Discover build and verification commands from contribution guides, README files, package manifests, task runners, and CI configuration. Do not assume a language, framework, directory layout, or command.
4. Identify generated files and documentation that the project requires to remain synchronized.

## Validate the issue

1. State the expected behavior, actual behavior, affected scope, and acceptance condition.
2. Reproduce the problem when practical. Preserve useful evidence such as a failing test, error message, log, trace, or concrete code path.
3. Trace callers, state transitions, data flow, error paths, and relevant history until the root cause is distinguishable from symptoms.
4. If reproduction is unavailable, use the strongest local evidence available and clearly retain uncertainty. Do not make speculative edits merely to appear responsive.

For code review, PR feedback, static-analysis reports, or security findings, evaluate each finding independently. Classify it as:

- `confirmed`: the issue and material impact are supported.
- `partially-confirmed`: a real issue exists, but the stated cause, impact, or proposed solution is incomplete.
- `false-positive`: current code and language or framework semantics contradict the finding.
- `not-reproducible`: evidence is insufficient to confirm or reject it.
- `already-resolved`: the current code no longer contains the issue.
- `needs-decision`: resolution depends on a product, architecture, compatibility, or policy choice.

Treat reviewer-proposed patches as suggestions. Check for stale line references, outdated commits, unreachable paths, missing context, and shared root causes across multiple findings. Support rejected findings with concrete code, test, or semantic evidence.

## Design the fix

1. Prefer a minimal complete change that restores the intended invariant or corrects the root cause.
2. Add or strengthen a regression test when it can demonstrate the failure before the fix and success afterward.
3. Avoid solving a structural problem by stacking special cases, swallowing errors, weakening assertions, deleting tests, skipping checks, or mocking away the behavior under test.
4. Combine findings with the same root cause into one coherent correction. Keep independent fixes separable and reviewable.
5. Consider security, privacy, authorization, data integrity, concurrency, error handling, compatibility, migrations, and performance in proportion to the risk.

## Implement without accumulating repair debt

After correcting behavior, audit the changed path and its direct dependencies. A fix is incomplete if it leaves avoidable contradictions or obsolete paths caused by the change.

### Simplify conditions and branches

- Remove conditions made redundant by upstream invariants or the corrected state model.
- Find always-true, always-false, unreachable, duplicated, or mutually contradictory branches.
- Consolidate repeated success, error, cleanup, and state-update paths when this improves clarity.
- Reconsider fixes dominated by new conditional branches; restoring an invariant, normalizing input, or deleting an obsolete path may be simpler.
- Do not introduce a broad abstraction merely to eliminate small, local duplication.

### Remove confirmed dead or obsolete code

- Search references before removing functions, imports, parameters, exports, configuration, feature flags, fallbacks, compatibility paths, and replaced implementations.
- Account for dynamic loading, reflection, serialization, configuration references, public APIs, plugin hooks, and framework lifecycle entry points.
- Remove code only when repository evidence supports that it is unused or obsolete. Preserve uncertain code and report it instead.
- Do not expand cleanup beyond the repaired path and its direct dependencies unless the user requests a wider refactor.

### Challenge redundant abstractions

- Remove wrappers that only forward arguments and add no independent semantics.
- Avoid speculative interfaces, factories, strategies, and extension points without a current variation requirement.
- Consolidate duplicate helpers representing the same concept.
- Preserve abstractions that clarify ownership, boundaries, invariants, or genuine variation. Fewer files or functions is not automatically simpler.

### Keep documentation synchronized

Check affected README content, configuration descriptions, API documentation, examples, comments, docstrings, architecture notes, migration guidance, and generated artifacts. Update documentation when behavior, defaults, interfaces, events, data formats, error semantics, or compatibility changes. Remove comments that only restate clear code; retain or update comments that explain non-obvious intent and constraints.

## Verify in layers

1. Run the narrowest relevant tests while iterating.
2. Run applicable formatting, linting, static analysis, type checking, unit tests, integration tests, builds, and generated-file checks defined by the project.
3. Run the repository's complete required verification before handoff when feasible.
4. Re-evaluate every original finding against the final code, not merely the test result.
5. Review the final diff for accidental API changes, unrelated formatting, debug code, stale compatibility logic, missing documentation, privacy or security risks, and data-loss hazards.
6. Never claim a check passed if it was not run. State skipped, unavailable, or failing checks and why.

## Stop or narrow scope when necessary

- Stop before destructive operations, production changes, dependency installation, commits, pushes, or migrations unless authorized.
- Stop when unrelated user changes cannot be safely separated from the requested work.
- Request a decision when public behavior or compatibility must change and the correct choice cannot be derived from repository policy.
- Record independent issues as follow-up items unless they block a safe, complete fix.

## Report the result

Lead with the outcome, then report:

- Each finding and its classification when review findings were supplied.
- Root cause and why the chosen fix addresses it.
- Behavior changes and regression coverage.
- Removed dead code, merged branches, deleted obsolete logic, simplified conditions, or reduced abstractions.
- Documentation or generated artifacts updated.
- Commands run and their results.
- Unverified areas, deferred findings, and residual risks.

Do not report cleanup merely because code was rearranged. Identify the obsolete or redundant behavior that was actually removed.
