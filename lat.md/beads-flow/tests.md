# Verification

beads-flow uses dependency-free shell tests for installer and rail behavior, invoked by the repository's root Node test gate.

## Installer contract

The installer test uses an isolated home directory and exercises the real `link` and `check` modes.

It verifies managed symlinks, the real empty `no-hooks` directory, refusal to overwrite different user files, and missing-link detection.

## Survey acceptance contract

The survey test invokes the real rail with a fake read-only `bd` command.

It verifies structured acceptance criteria, legacy description-section fallback, blank rejection, and P4 exclusion. Focused overlap calls verify the canonical live-bead `Files:` parser handles multiple paths, missing declarations, unknown values, and case-insensitive keys.

## Integration recovery contract

The recovery test drives the real rail through temporary Git repositories.

It verifies a failed integration gate permits a same-task fix-forward preparation and that `unlock --abort` clears an in-progress conflicting rebase before releasing the lock.

## Retry and rebase contracts

Focused tests protect retry evidence and drive the real rail through both rebase modes.

They verify hard repeated-signature denial and the overridable cumulative ceiling. Temporary repositories prove `prepare` uses plain rebase when main contains the worker base and `--onto` after a rewrite, without resurrecting amended-away files.

## Audit absorption contract

The absorb test uses a temporary tracked `.beads/interactions.jsonl` file.

It verifies clean detection, staged-index refusal, staging only tracked Beads JSONL files, and final clean verification.

## Speckit normative coverage contract

The formula regression test validates the generic normative-ownership contract without invoking `bd`.

It verifies source authority and row-level coverage remain present, both implementation and verification owners are mandatory, both depths retain the gate, count mismatches stop before Beads mutation, the preflight precedes epic creation, and squash instructions record coverage totals.
