# beads-flow

beads-flow versions the user-level Beads formulas and implementation rail consumed by proper-flow.

## Purpose

The bundle makes global workflow support reviewable and testable in the same repository as the prompts that depend on it.

It owns the `constitution` and `speckit` formulas, the `implement-ready.sh` rail, their shell regression tests, and the installer that exposes runtime files under `~/.beads/`.

## Resource boundary

beads-flow owns static workflow resources, not Beads runtime state.

Only individual formula files and `rail/implement-ready.sh` are linked into `~/.beads`. Databases, shared-server state, configuration, locks, caches, audit logs, and the empty `no-hooks` directory remain outside Git.

## Core invariants

The installation model preserves Beads ownership of its user directory.

1. `~/.beads` is always a real directory, never a repository symlink.
2. Managed runtime files are individual symlinks into this checkout.
3. `~/.beads/no-hooks` is a real, empty directory.
4. Existing different regular files are never overwritten automatically.
5. Tests execute the repository rail directly, not the installed symlink.
6. Formula checks verify Beads resolves each user formula from its managed path.
7. Speckit inventories normative visual rows in both depths and refuses Beads
   mutations until every row has implementation and verification ownership.
8. Speckit includes open and deferred P4 issues in backlog closure, then clears
   deferral when refining a source into open P0-P3 work.
9. A P4 source that is also the target epic uses `promote-epic`: Speckit keeps
   its epic type and promotes priority only after P0-P3 child coverage exists.

## Documentation map

The bundle separates installation behavior from regression coverage.

- [operations](./operations.md) — linking, checking, formula precedence, and ownership.
- [tests](./tests.md) — installer, rail, recovery, and filtering verification.

<!-- lat-index
- [[operations]] — bundle operations
- [[tests]] — bundle verification
-->
