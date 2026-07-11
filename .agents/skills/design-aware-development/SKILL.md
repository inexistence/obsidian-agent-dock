---
name: design-aware-development
description: Implement features, fixes, and refactors with proportionate upfront design, clear ownership boundaries, minimal sufficient abstractions, and verification. Use when changing production code, especially for cross-module behavior, new extension points, provider adapters, storage boundaries, or requests that emphasize architecture, maintainability, SOLID, design patterns, extensibility, or avoiding over-engineering.
---

# Design-Aware Development

Build the smallest clear design that satisfies the current behavior and preserves established boundaries. Treat design patterns as optional tools for observed problems, never as goals.

## Calibrate the design effort

Classify the change before implementation:

- **Small**: Local bug fix or isolated behavior change. Trace the affected path, implement directly, and add focused regression coverage.
- **Medium**: Change spanning neighboring modules or adding a real variation point. Identify ownership, contracts, and dependency direction before editing.
- **Large**: Cross-cutting capability, new provider or external boundary, persistence change, or architectural refactor. Map data flow, state ownership, failure paths, compatibility, and extension points first.

Increase design effort only when risk or scope justifies it. Do not produce a design document unless the user requests one or the change needs a durable decision record.

## Inspect before designing

1. Read the repository instructions and relevant implementation, tests, and documentation.
2. Trace callers, consumers, state ownership, and existing extension points with `rg`.
3. State the concrete invariant or behavior that must change.
4. Distinguish current requirements from hypothetical future needs.
5. Preserve unrelated user changes and follow the repository's existing architectural vocabulary.

## Choose the minimal sufficient design

Prefer, in order:

1. A direct change inside the module that already owns the behavior.
2. A small helper when it makes one responsibility clearer.
3. An extracted module when behavior has distinct ownership, lifecycle, state, or testing needs.
4. An interface, strategy, registry, adapter, or factory only when a real boundary or variation point requires it.

Require every new abstraction to answer:

- What present complexity or coupling does it remove?
- Why is the existing owner the wrong place for the behavior?
- Which current call sites or implementations benefit?
- Can the behavior be tested more clearly through this boundary?

If those answers are weak, use the direct implementation.

## Apply anti-overengineering guardrails

- Do not introduce a pattern merely because it is recognizable.
- Do not create an interface for one internal implementation unless it isolates a meaningful external boundary.
- Do not generalize two similar code paths until they share semantics and are likely to change for the same reason.
- Do not add configuration, plugin hooks, factories, or indirection for speculative consumers.
- Do not split files solely to make them smaller; split when ownership or change reasons differ.
- Do not preserve obsolete layers for symmetry. Remove directly related dead or redundant code when safe and in scope.
- Prefer composition and explicit data flow over inheritance and hidden mutable state.
- Keep validation and policy decisions local and authoritative when the repository requires deterministic behavior.

Use this stop rule:

> If the direct implementation is clear, testable, and consistent with existing module boundaries, stop designing and implement it.

## Protect repository boundaries

For Agent Dock changes:

- Keep provider-specific parsing and process behavior under `src/agents/<provider>/`.
- Keep `AgentDockView` and normalized timeline events provider-agnostic.
- Reuse `TurnContextBuilder` for shared prompt, memory, affect, interaction, and notice preparation.
- Keep local validation, filtering, storage authority, cooldowns, and limits deterministic.
- Maintain the normalized event contract: `content`, `reasoning`, `tool`, `error`, `notice`, and `activity`.
- Change source files under `src/`; never implement features directly in generated `main.js`.
- Commit rebuilt `main.js` with source changes.

## Implement in reviewable increments

1. Make the smallest coherent source change.
2. Add or update behavior-focused tests near the affected contract.
3. Keep compatibility and migration behavior explicit for persisted data or settings.
4. Update documentation when public behavior, settings, architecture, or extension guidance changes.
5. Avoid unrelated cleanup unless it is necessary for the requested change.

## Review the result

Before handing off, check:

- Responsibilities and ownership remain clear.
- Dependencies point toward stable shared contracts rather than UI or provider details.
- New abstractions have current consumers and reduce real complexity.
- Error, cancellation, empty, concurrency, and persistence paths are covered where relevant.
- Sensitive data, command execution, paths, and persisted content remain safely handled.
- Tests verify observable behavior instead of implementation structure.

Perform a proportionate internal self-check after implementation. Invoke `code-review-expert` only when the user explicitly requests a formal review; architectural significance alone does not require switching to its review-and-confirm workflow. Use `resolve-code-issues` when addressing confirmed defects or review findings.

## Verify

Follow repository-defined verification. In Agent Dock:

1. Run `node scripts/build-main.js` after source changes when not already covered by the test command.
2. Run focused tests while iterating.
3. Run `node scripts/test-all.js` before handoff.
4. Report what passed, what was not run, and any residual risk.

Do not claim architectural flexibility without identifying the concrete boundary that provides it.
