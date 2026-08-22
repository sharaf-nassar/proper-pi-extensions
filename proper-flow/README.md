# proper-flow

Four [Pi](https://pi.dev) prompt templates that take Beads work from intake to
verified implementation. The package contains prompts only; it installs no
runtime extension code, skills, or npm dependencies. Prompt-only describes the
package loading boundary, not the workflows' Beads, Git, worktree, and commit
side effects.

## Commands

| Command | User-facing behavior |
| --- | --- |
| `/triage <request>` | Classifies the request as broken behavior, known concrete work, or fuzzy scope. It routes to `/file`, files a ready task directly, or routes to `/spec`. |
| `/file <bug>` | Reproduces the bug, traces the root cause, checks prior work, presents findings for approval, then files precise bug beads with structured acceptance criteria. It does not implement unless explicitly asked. |
| `/spec <input>` | Accepts an idea, epic, P4 item, or `debt`; runs `speckit` in full or quick depth, pauses at clarification and approval gates, then creates or updates an epic with dependency-wired P0 to P3 tasks. |
| `/implement-ready [scope] [workers]` | Accepts an epic, task, or `all`; runs the scope through a rolling pool of 1 to 12 workers with worktree, integration, retry, verification, cleanup, and reporting controls. |

All four commands run `bd` for the user. When input is needed, they use
`ask_user_question` and group related questions into one dialog. Plain-text
questions are a fallback only when the tool is unavailable or fails before its
UI appears.

## Workflow behavior

### `/triage`

- Broken or regressed behavior goes to `/file`.
- Small work with known files and verifiable acceptance criteria is filed
  directly, without a larger pipeline.
- Features, material unknowns, multi-part work, and P4 refinement go to
  `/spec`.
- Borderline requests get one explicit user decision instead of a guess.

### `/file`

- Requires a real reproduction before filing work.
- Separates root cause from symptoms and reports the affected code paths and
  blast radius before creating beads.
- Searches existing beads, session history, and `docs/solutions/` when present
  so failed or superseded approaches are not repeated silently.
- Stores done conditions in Beads' native acceptance field. Every bug bead
  includes the regression test and original reproduction.
- Files separate latent bugs instead of widening one fix bead.
- Keeps reproduction work out of a dirty primary checkout by using scratch
  files or a disposable hook-free investigation worktree.
- Ends with an explicit learning disposition and absorbs the Beads audit log.
- `/file [[llm-router: fable]] <bug>` requests the strongest routing arm when
  proper-llm-router is active.

### `/spec`

Accepted inputs include a new idea, an existing epic, a direct P4 backlog item,
or `debt` for open `ponytail-debt` items.

The underlying `speckit` pipeline performs:

1. Constitution check.
2. Specification draft.
3. Requirements, gaps, ambiguity, feasibility, scope, and stakeholder review.
4. Human clarification gate for product decisions.
5. Implementation plan and sequencing.
6. Alignment and plan-quality fix pass.
7. Human GO, GO-WITH-FIXES, or NO-GO gate.
8. Epic and task materialization.

Full depth writes one numbered `specs/NNN-<feature>.md` file and uses parallel
review passes. Quick depth keeps the condensed spec and plan on the epic, but
retains both human gates. File-writing runs use isolated hook-free worktrees,
land as squash commits, clean up after success, and never push unless asked.
Both depths require verifiable acceptance criteria, resolve every source P4,
and verify implementation and test ownership for normative visual requirements
before creating tasks.

### `/implement-ready`

- Resolves an epic id, one task id or unique title, or `all`. The worker limit
  defaults to 12 and never exceeds 12.
- If `LLM_ROUTER_OFF=1`, asks whether to continue without routing or stop for a
  restart. Users can hold named tasks out of the run at any time.
- Refuses P4 items and P0 to P3 items without acceptance criteria instead of
  letting workers invent scope.
- Uses the `beads-flow` rail for claims, hook-free task worktrees, declared-file
  overlap checks, worker result validation, integration locks, squash
  preparation, quality gates, cleanup, and audit staging.
- Keeps a rolling async pool. A finished task can integrate and unblock the next
  task without waiting for unrelated workers.
- Serializes tasks whose declared or observed files overlap.
- Retries only after a concrete change. Repeated failure signatures stop. Code
  defects may escalate one retry with `[[llm-router: fable]]`; missing tools or
  services are returned to the user for installation or repair.
- Runs repository gates after each integration and the full gate once at the
  end.
- Reports completed, retried, stuck, blocked, held, excluded, and unacceptable
  work separately, including leftover worktrees and model escalations.
- When available, records new `ponytail:` debt, runs one whole-run
  `ponytail-review`, and writes only reusable run learnings.

Common report states:

| State | Meaning |
| --- | --- |
| `unacceptable` | P0 to P3 work lacks structured acceptance criteria and must return to `/file` or `/spec`. |
| `p4_excluded` | Backlog work is intentionally not dispatchable and should go through `/spec`. |
| `stuck` | Attempts stopped on repeated failure, environment, conflict, missing concrete fix, or retry ceiling. |
| `stranded` | Work remains blocked by a stuck task. |
| `held` | User excluded the task from this run. |

## Install

From npm:

```bash
pi install npm:proper-flow
```

From a local checkout:

```bash
pi install /path/to/proper-pi-extensions/proper-flow
```

Remove same-named files from `~/.pi/agent/prompts/` so Pi discovers only one
source for each command. Confirm the package with `pi list`, then reload Pi
after prompt edits.

## Runtime requirements

Install the support bundle first:

```bash
/path/to/proper-pi-extensions/beads-flow/install.sh link
```

The prompts expect:

- Beads CLI, `bd`.
- Git 2.35 or newer for staged-index preservation paths.
- `constitution` and `speckit` formulas under `~/.beads/formulas/`.
- `~/.beads/rail/implement-ready.sh`.
- The real empty `~/.beads/no-hooks/` directory for hook-free worktrees.

`/implement-ready` uses pi-subagents when available and otherwise works tasks
serially. `proper-llm-router` is optional, but its default command pins and
per-worker routing match this workflow. `/constitution` remains a Beads formula,
not a prompt in this package.

## Development

```bash
npm test
npm pack --dry-run
npm publish --dry-run
```

`prepack` runs the test before a tarball or publish. The test protects package
discovery, autocomplete metadata, questionnaire use, structured acceptance,
task scope, rolling-pool behavior, and integration sequencing. It does not
execute Beads formulas, the rail, subagents, or live model routing. Node 22.19
or newer is required for development checks.

## License

MIT
