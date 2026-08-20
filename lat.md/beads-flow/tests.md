# Verification

beads-flow uses dependency-free shell tests for installer and rail behavior, invoked by the repository's root Node test gate.

## Installer contract

The installer test uses an isolated home directory and exercises the real `link` and `check` modes.

It verifies managed symlinks, the real empty `no-hooks` directory, refusal to overwrite different user files, and missing-link detection.

## Survey acceptance contract

The survey test invokes the real rail with a fake read-only `bd` command.

It verifies structured acceptance criteria, legacy description-section fallback, blank rejection, P4 exclusion, and `Files:` parsing without duplicating the production filter.

## Integration recovery contract

The recovery test drives the real rail through temporary Git repositories.

It verifies a failed integration gate permits a same-task fix-forward preparation and that `unlock --abort` clears an in-progress conflicting rebase before releasing the lock.

## Retry and rebase contracts

Focused tests protect retry evidence and rewritten-main handling.

They verify hard repeated-signature denial, the overridable cumulative ceiling, advanced-main rebasing, and replaying only task commits after main history is rewritten.

## Audit absorption contract

The absorb test uses a temporary tracked `.beads/interactions.jsonl` file.

It verifies clean detection, staged-index refusal, staging only tracked Beads JSONL files, and final clean verification.
