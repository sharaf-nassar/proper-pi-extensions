# proper-flow

proper-flow packages five Beads workflow prompts as one independently installable Pi resource bundle.

## Purpose

The package owns the five workflow prompts plus the Beads resources they drive: the `constitution` and `speckit` formulas and the `implement-ready.sh` rail, versioned beside related Pi extensions instead of loose global files.

The five commands form a pipeline. Triage selects the entry point, file investigates broken behavior, spec refines one feature, backlog drains P4 work into independent implement-ready clusters, and implement-ready executes ready cards.

## Resource boundary

Pi loads prompt templates only. Pi discovers `prompts/` through the package manifest; there is no runtime extension entrypoint, dependency graph, or custom command handler.

The formulas and rail ship in the package but deploy outside Pi: `install.sh` links them into `~/.beads/` as individual symlinks to the checkout, and only Beads reads them. Runtime Beads state stays out of the package. pi-subagents and model routing remain external packages. The separate `/constitution` governance prompt remains global and outside this workflow bundle; its formula ships here.

## Core invariants

The package keeps command identity and ownership predictable.

1. Filenames remain `triage.md`, `file.md`, `spec.md`, `backlog.md`, and `implement-ready.md` because Pi derives slash-command names from them.
2. Every prompt retains `description` and `argument-hint` frontmatter for autocomplete.
3. The package is the only installed source for these five prompts; duplicate files under `~/.pi/agent/prompts/` are removed.
4. Prompt responsibilities stay separate: routing, bug investigation, one-feature specification, backlog refinement, then implementation.
5. proper-llm-router owns command model pins; proper-flow does not duplicate routing configuration.
6. `/implement-ready` resolves a task id or unique title to one exact bead and never refills that run with sibling board work.
7. Every workflow uses `ask_user_question` when it needs user input, grouping related questions into one call and falling back to plain text only when the tool is unavailable or fails before displaying its UI.
8. `/implement-ready` caps its rolling pool at 12 workers and refills capacity after terminal workers are reconciled, without waiting for unrelated active workers.
9. Newly filed P4 debt is indefinitely deferred so Beads excludes it from `bd ready`; `/backlog` owns whole-board open and deferred P4 refinement.
10. `/backlog` holds one atomic repository run lock, snapshots baseline P4 ids, and records later P4 adoption only from a cluster's required live closure.
11. `/backlog` combines only duplicate or same-epic outcomes; cross-epic file conflicts stay in separate serialized wisps, and every run source needs a verified terminal disposition.
12. `~/.beads` is always a real directory, never a repository symlink; managed runtime files are individual symlinks into this checkout.
13. `~/.beads/no-hooks` is a real, empty directory.
14. Existing different regular files are never overwritten automatically.
15. Tests execute the repository rail directly, not the installed symlink, and formula checks verify Beads resolves each user formula from its managed path.
16. Speckit inventories normative visual rows in both depths and refuses Beads mutations until every row has implementation and verification ownership.
17. Speckit includes open and deferred P4 issues in backlog closure, then clears deferral when refining a source into open P0-P3 work.
18. A P4 source that is also the target epic uses `promote-epic`: Speckit keeps its epic type and promotes priority only after P0-P3 child coverage exists.

## Documentation map

The package documentation separates behavior from deployment and verification.

- [operations](./operations.md) — package identity, installation, migration, and runtime assumptions.
- [tests](./tests.md) — package manifest and prompt metadata verification.

<!-- lat-index
- [[operations]] — package operations
- [[tests]] — package verification
-->
