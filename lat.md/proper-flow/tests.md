# Verification

proper-flow uses one dependency-free Node test to protect its package and command discovery contract.

## Package fixture

The fixture verifies Pi receives the intended prompt resource set.

It parses `package.json`, checks that `pi.prompts` exposes `./prompts`, and requires exactly `file.md`, `implement-ready.md`, `spec.md`, and `triage.md`. Each file must retain `description` and `argument-hint` frontmatter.

## Coverage boundary

The test validates package ownership and Pi-facing metadata, not the external workflow engines.

Beads formulas, rail behavior, subagent orchestration, model pins, and the prose instructions inside each prompt are exercised by their owning tools and live workflow runs rather than duplicated in this package test.
