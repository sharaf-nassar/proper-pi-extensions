# Verification

proper-flow uses one dependency-free Node test to protect its package and command discovery contract.

## Package fixture

The fixture verifies Pi receives the intended prompt resource set.

It parses `package.json`, checks that `pi.prompts` exposes `./prompts`, and requires exactly `file.md`, `implement-ready.md`, `spec.md`, and `triage.md`. Each file must retain `description` and `argument-hint` frontmatter.

## Implement-ready scope contract

The fixture protects the user-facing scope contract against regressing to epic-only execution.

It requires `/implement-ready` to advertise epic, task, and all scopes and to retain explicit resolution and single-task isolation instructions.

## Coverage boundary

The test validates package ownership, Pi-facing metadata, and the implement-ready scope contract, not the external workflow engines.

Beads formulas, rail behavior, subagent orchestration, model pins, and the rest of each prompt's prose are exercised by their owning tools and live workflow runs rather than duplicated in this package test.
