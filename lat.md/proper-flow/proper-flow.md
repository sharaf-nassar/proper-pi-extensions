# proper-flow

proper-flow packages four Beads workflow prompts as one independently installable Pi resource bundle.

## Purpose

The package owns `/triage`, `/file`, `/spec`, and `/implement-ready`, keeping workflow prompts versioned beside related Pi extensions instead of loose global files.

The four commands form a pipeline. Triage selects the entry point, file investigates broken behavior, spec creates implement-ready beads, and implement-ready executes one task, an epic frontier, or the whole ready board.

## Resource boundary

proper-flow contains prompt templates only. Pi discovers `prompts/` through the package manifest; there is no runtime extension entrypoint, dependency graph, or custom command handler.

Beads formulas, the implementation rail, pi-subagents, and model routing remain external services or packages. The separate `/constitution` governance prompt remains global and outside this workflow bundle.

## Core invariants

The package keeps command identity and ownership predictable.

1. Filenames remain `triage.md`, `file.md`, `spec.md`, and `implement-ready.md` because Pi derives slash-command names from them.
2. Every prompt retains `description` and `argument-hint` frontmatter for autocomplete.
3. The package is the only installed source for these four prompts; duplicate files under `~/.pi/agent/prompts/` are removed.
4. Prompt responsibilities stay separate: routing, bug investigation, specification, then implementation.
5. proper-llm-router owns command model pins; proper-flow does not duplicate routing configuration.
6. `/implement-ready` resolves a task id or unique title to one exact bead and never refills that run with sibling board work.

## Documentation map

The package documentation separates behavior from deployment and verification.

- [operations](./operations.md) — package identity, installation, migration, and runtime assumptions.
- [tests](./tests.md) — package manifest and prompt metadata verification.

<!-- lat-index
- [[operations]] — package operations
- [[tests]] — package verification
-->
