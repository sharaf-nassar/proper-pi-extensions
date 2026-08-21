# beads-flow

Version-controlled Beads formulas and the implementation safety rail used by
[`proper-flow`](../proper-flow/README.md). This is a support bundle, not a Pi
package.

## What it installs

| Resource | User-facing behavior |
| --- | --- |
| `constitution` formula | Inventories a repository's real engineering rules, separates observed and aspirational principles, pauses for human review, then writes a concise root `constitution.md`. |
| `speckit` formula | Turns an idea, epic, P4 backlog item, or ponytail debt ledger into an approved spec, plan, epic, and dependency-wired P0 to P3 task beads. |
| `implement-ready.sh` rail | Owns task claims, hook-free worktrees, overlap checks, retry evidence, integration locking, verification, cleanup, and Beads audit staging. |
| `no-hooks/` | Provides a real empty directory for per-worktree `core.hooksPath`, preventing repository and Beads hooks from running in task worktrees. |

## Formulas

### `constitution`

Run it as an ephemeral wisp:

```bash
bd mol wisp constitution
```

Pipeline:

```text
gather -> human review -> write constitution.md
```

The formula reads repository instructions, CI, lint, type, test, and existing
documentation settings. It tags candidate principles as observed or
aspirational, waits for the user to keep, amend, or drop them, then writes only
the approved numbered principles and rationales. Squashing the wisp leaves one
digest bead; `constitution.md` is the durable artifact.

### `speckit`

Start with a feature slug and problem statement:

```bash
bd mol wisp speckit --var feature=<slug> --var problem="<problem>"
```

The formula also accepts existing epic, source backlog, backlog list, context,
spec directory, and depth variables.

Pipeline:

```text
constitution check -> specify -> spec review -> human clarification
-> plan -> alignment fixes -> human approval -> create beads
```

User-visible guarantees:

- `full` depth writes one numbered `specs/NNN-<feature>.md` file, runs six spec
  review angles, and runs a separate alignment pass.
- `quick` depth keeps the condensed spec and plan on the epic and skips the
  file, but still runs both human gates.
- Product decisions go to the user. Technical choices are investigated and
  recorded for veto instead of being pushed back as avoidable questions.
- Existing epics and P4 inputs keep provenance. Every source P4 is refined,
  superseded after replacement coverage, preserved as already retired, or
  retired as a user-approved non-goal.
- Referenced visual artifacts record which sections are normative. Every
  normative row needs named implementation and verification owners before
  Beads mutation begins.
- Materialized tasks use P0 to P3, structured acceptance criteria, concrete
  `Files:` declarations, native spec/design links, and dependency edges only
  where order matters.
- The finished scope has no open or ready P4 work. Squashing the wisp leaves one
  digest bead plus the epic and full-depth spec file.

## Implementation rail

`rail/implement-ready.sh` never launches agents and never commits. The
orchestrator runs it around workers and primary-checkout commits. `init`
requires the primary checkout on the configured main branch; later integration
and absorb commands enforce the required primary-checkout state. Durable run
state lives under `${XDG_STATE_HOME:-~/.local/state}/bd-orchestrate`.

| Command | Purpose |
| --- | --- |
| `init` | Create run state for one epic or the full board and record the integration actor. |
| `survey` | Return ready, in-progress, blocked, P4-excluded, and missing-acceptance buckets as JSON. |
| `overlap` | Compare a task's declared `Files:` against active work. |
| `retry-gate` | Reject repeated failure signatures and enforce the cumulative attempt ceiling. |
| `claim` | Claim one task for the run actor. |
| `worktree` | Create the task branch and hook-free worktree. |
| `result` | Store one normalized worker result and attempt record. |
| `verify-worker` | Check worker status, commit, worktree, changed files, and forbidden Beads mutations. |
| `prepare` | Rebase the task correctly, acquire the integration lock, and stage its squash diff. |
| `verify-integration` | Verify the landed tree and optionally run the chosen integration gate while keeping the lock. |
| `cleanup` | Remove the integrated task worktree and branch. |
| `unlock` | Release a verified integration or abort a failed rebase during recovery. |
| `absorb` | Stage only tracked `.beads/*.jsonl` audit changes, or verify they are clean. |

All successful commands emit one JSON object. Failures return nonzero status;
they never masquerade as an empty frontier. `overlap` reports conflicts; the
orchestrator decides whether to serialize them. An integration-gate failure
keeps the lock so the orchestrator must fix forward or revert before preparing
another task.

Show the exact command syntax with:

```bash
~/.beads/rail/implement-ready.sh --help
```

## Install

Link the managed files into the user Beads registry:

```bash
./install.sh link
```

This creates individual links under `~/.beads/formulas/` and
`~/.beads/rail/`. It creates `~/.beads/no-hooks/` as a real empty directory.
Keep this checkout at the same path because the links point into it. The
installer never links the whole `~/.beads` directory. It retargets symlinks and
converts matching regular files, but refuses to replace a different regular
file.

Check links, executability, formula resolution, and the empty no-hooks
directory with:

```bash
./install.sh check
```

Repository-local `.beads/formulas/` files can override user formulas. The
check runs formula resolution outside a Beads project so it verifies the global
installation itself.

## Requirements

- Bash
- `bd`
- `git`
- `jq`

Machine-specific Beads databases, shared-server state, configuration, locks,
caches, and audit logs remain outside this repository.

## Test

```bash
./test.sh
```

The framework-free shell suite covers installation, survey filtering,
acceptance rules, overlap parsing, retry gates, rebase modes, integration
recovery, audit absorption, and normative visual coverage checks.
