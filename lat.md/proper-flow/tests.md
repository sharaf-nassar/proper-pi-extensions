# Verification

proper-flow uses one dependency-free Node test for its package and command discovery contract, plus dependency-free shell suites for installer, rail, and formula behavior, invoked by the repository's root Node test gate through `test.sh`.

## Package fixture

The fixture verifies Pi receives the intended prompt resource set.

It parses `package.json`, checks that `pi.prompts` exposes `./prompts`, and requires exactly `backlog.md`, `file.md`, `implement-ready.md`, `spec.md`, and `triage.md`. Each file must retain `description` and `argument-hint` frontmatter.

## Questionnaire routing contract

The fixture requires every workflow prompt to route user questions through `ask_user_question` and retain the plain-text fallback for unavailable tools or failures before UI display.

## File acceptance contract

The fixture prevents bug triage from hiding done conditions in prose that the implementation rail cannot classify reliably.

It requires `/file` to write criteria through Beads' structured `--acceptance` field and to forbid description-only acceptance criteria.

## Implement-ready scope contract

The fixture protects the user-facing scope contract against regressing to epic-only execution.

It requires `/implement-ready` to advertise epic, task, and all scopes and to retain explicit resolution and single-task isolation instructions.

## P4 backlog-state contract

The fixture requires `/implement-ready` to create each P4 debt bead with deferred status, point debt paydown to `/backlog`, and leave `/spec` without a whole-ledger debt route.

## Backlog orchestration contract

The fixture protects `/backlog` locking, P4 snapshot/adoption, distinct-epic serialization, bounded async refinement, exact human gates, and final audit absorption.

## Rolling pool contract

The fixture requires `/implement-ready` to default to 12 workers, enforce the hard maximum, launch async children, wait for the next completion rather than the whole pool, and refill without waiting for active siblings.

## Integration recovery contract

The fixture protects the rail-owned integration order and recovery references that task cleanup depends on.

It requires `/implement-ready` to close each bead before cleanup, document rebase abort recovery, pass the upcoming retry attempt number to the rail, and keep `/file` inline fixes on the run-level absorb path.

## Installer contract

The installer test uses an isolated home directory and exercises the real `link` and `check` modes.

It verifies managed symlinks, the real empty `no-hooks` directory, refusal to overwrite different user files, and missing-link detection.

## Survey acceptance contract

The survey test invokes the real rail with a fake read-only `bd` command.

It verifies structured acceptance criteria, legacy description-section fallback, blank rejection, and P4 exclusion. Focused overlap calls verify the canonical live-bead `Files:` parser handles multiple paths, missing declarations, unknown values, and case-insensitive keys.

## Rail integration recovery contract

The recovery test drives the real rail through temporary Git repositories.

It verifies a failed integration gate permits a same-task fix-forward preparation and that `unlock --abort` clears an in-progress conflicting rebase before releasing the lock.

## Retry and rebase contracts

Focused tests protect retry evidence and drive the real rail through both rebase modes.

They verify hard repeated-signature denial and the overridable cumulative ceiling. Temporary repositories prove `prepare` uses plain rebase when main contains the worker base and `--onto` after a rewrite, without resurrecting amended-away files.

## Audit absorption contract

The absorb test uses a temporary tracked `.beads/interactions.jsonl` file.

It verifies clean detection, staged-index refusal, staging only tracked Beads JSONL files, and final clean verification.

## Speckit backlog-state contract

The backlog-state regression protects open/deferred discovery, deferral clearing, target-epic promotion without type conversion, and formula versioning.

## Speckit normative coverage contract

The formula regression test validates the generic normative-ownership contract without invoking `bd`.

It verifies source authority and row-level coverage remain present, both implementation and verification owners are mandatory, both depths retain the gate, count mismatches stop before Beads mutation, the preflight precedes epic creation, and squash instructions record coverage totals.

## Coverage boundary

The Node test validates package ownership, Pi-facing metadata, acceptance storage, backlog orchestration, integration sequencing, and scope selection; the shell suites validate the installer, rail, and formula contracts above.

Subagent orchestration, model pins, and the rest of each prompt's prose are exercised by their owning tools and live workflow runs rather than duplicated in these package tests.
