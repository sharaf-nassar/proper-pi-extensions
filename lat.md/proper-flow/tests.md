# Verification

proper-flow uses one dependency-free Node test to protect its package and command discovery contract.

## Package fixture

The fixture verifies Pi receives the intended prompt resource set.

It parses `package.json`, checks that `pi.prompts` exposes `./prompts`, and requires exactly `file.md`, `implement-ready.md`, `spec.md`, and `triage.md`. Each file must retain `description` and `argument-hint` frontmatter.

## File acceptance contract

The fixture prevents bug triage from hiding done conditions in prose that the implementation rail cannot classify reliably.

It requires `/file` to write criteria through Beads' structured `--acceptance` field and to forbid description-only acceptance criteria.

## Implement-ready scope contract

The fixture protects the user-facing scope contract against regressing to epic-only execution.

It requires `/implement-ready` to advertise epic, task, and all scopes and to retain explicit resolution and single-task isolation instructions.

## Integration recovery contract

The fixture protects the rail-owned integration order and recovery references that task cleanup depends on.

It requires `/implement-ready` to close each bead before cleanup, document rebase abort recovery, and keep `/file` inline fixes on the run-level absorb path.

## Coverage boundary

The test validates package ownership, Pi-facing metadata, acceptance storage, integration sequencing, and scope selection, not the external workflow engines.

Beads formulas, rail behavior, subagent orchestration, model pins, and the rest of each prompt's prose are exercised by their owning tools and live workflow runs rather than duplicated in this package test.
