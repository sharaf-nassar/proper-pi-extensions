---
description: Run the global speckit beads formula from an idea, epic, or P4 backlog issue to implement-ready task beads
argument-hint: <feature idea, problem statement, existing epic id, P4 issue id, or "debt">
---

Pi port of `~/.claude/commands/spec.md` (itself twin-maintained with the
Codex skill at `~/.codex/skills/spec/SKILL.md`) — mirror any substantive
edit across all three (platform-specific wording aside).

Drive the global `speckit` beads formula end to end for: $ARGUMENTS

You run ALL bd commands yourself — the user never touches the bd CLI.

1. If $ARGUMENTS is empty or too vague to name a feature, ask the user for the
   problem statement first. If it names an existing issue id, inspect it with
   `bd show <id> --json` and route by type/priority:
   - Existing epic: use its title/description as the problem and pass
     `--var epic=<id>` so tasks land under it.
   - Non-epic P4 issue: treat the full issue as required source context, pass
     `--var source_backlog=<id>`, and use its title/description as the problem.
     Walk its structural parent chain first. If it has no epic ancestor, run
     `bd dep list <id> --direction=down --type=discovered-from --json`, then
     inspect each origin itself and walk its parent chain to the nearest epic.
     If exactly one distinct epic is found, pass it as `epic`. If multiple
     distinct epics are found, do not guess: pass them as comma-separated
     `--var epic_candidates="<ids>"` and put the ambiguity in `context` so the
     clarify gate requires the human to choose. If none is found, let the
     formula create an epic. A closed/superseded P4 remains retired but still
     requires actionable replacement coverage; never reopen it.
   - Any other existing issue is not a backlog-refinement input; treat the
     request as a problem statement unless the user explicitly asks to reuse it.
   - The literal argument `debt`: a ponytail-debt paydown pass, not a feature.
     Collect the ledger with `bd list --label ponytail-debt --status=open
     --json`. Empty → say the ledger is clean and stop; do not instantiate a
     wisp. Otherwise pass every id as `--var backlog="<ids>"` and use a problem
     statement naming the actual ceilings, e.g. "Pay down N deliberate ponytail
     shortcuts: <one clause per ceiling>." These beads are unparented by design
     (implement-ready files them that way so they stay out of feature-run
     closures), so there is no epic to infer — do NOT walk parent chains or
     provenance for them, and let the formula create the epic. Their
     `source-task` / `source-commit` description fields are the backtrack path
     to the change that incurred each shortcut; read them as context before
     refining. Every collected id still owes the normal P4 disposition.
   For an existing epic (including one inferred from a P4 source), compute its
   hierarchy-plus-provenance closure before instantiating the wisp:
   - Seed SCOPE with the epic and recursively add structural descendants using
     `bd list --parent <id> --all --limit=0 --json`.
   - Run `bd dep list <scope ids...> --direction=up
     --type=discovered-from --json` to add issues discovered from any SCOPE
     issue. Add their structural descendants, then repeat the provenance query
     for newly added ids until no ids are added.
   Collect every SCOPE issue whose stored status is `open` and priority is `4`.
   Pass the complete, de-duplicated id set as `--var backlog="<ids>"`. Include
   `source_backlog` even when it remains outside the epic closure.
2. Derive a short kebab-case feature slug and instantiate the molecule as an
   ephemeral wisp (the formula is `phase = "vapor"` — do NOT `bd mol pour` it):
   `bd mol wisp speckit --var feature=<slug> --var problem="<problem>" --var context="<any extra context the user gave>" [--var epic=<id>] [--var epic_candidates="<comma-separated ids>"] [--var source_backlog=<id>] [--var backlog="<comma-separated ids>"] [--var depth=quick]`
   (the underlying beads formula is named `speckit`).
   Depth defaults to `full`. Pass `--var depth=quick` when the user asks for a
   quick/light spec or the feature is plainly small (lighter self-review, merged
   alignment+analysis — both human gates still fire); when unsure, default to
   full. Quick runs write no `specs/` file — the epic carries the condensed
   spec/plan, so the run is bd-only and needs no worktree.
   (If the `speckit` formula is missing on this machine, say so — it lives in
   `~/.beads/formulas/speckit.formula.toml` — do not improvise a substitute.)
3. Work the molecule loop until done or gated:
   `bd ready --mol <root-id>` → `bd update <step> --claim` → follow the step's
   description verbatim (it is the runbook; dispatch parallel subagents where it
   says to) → `bd close <step>` → repeat. (`--mol` surfaces the wisp's ephemeral
   steps without `--include-ephemeral`; add that flag only if a step ever fails
   to appear. `bd close <step> --suggest-next` prints the steps a close just
   unblocked, if you want the next frontier inline.) The frontier also carries
   the two `[gate]` beads (clarify, analyze) from the start — do NOT routine
   claim/close those; they are the human decision points handled in step 4.
4. Human gates (clarify, analyze). Each is a `[steps.gate] type="human"` step:
   bd creates a separate `human` gate bead that blocks the step, so the clarify
   / analyze STEP stays out of `bd ready` until you resolve its gate. When the
   pipeline reaches one, read the step's runbook (`bd show <step>`), present
   exactly what it says in chat, and STOP. After the user answers/approves,
   resolve the gate: `bd gate list` (the open `human` gate blocking that step —
   `bd gate show <gate-id>` names the step it gates) → `bd gate resolve
   <gate-id>`. The step then enters `bd ready` — claim it, fold the answers into
   the artifacts, and `bd close <step>` normally, then continue the loop.
   (`bd ready --gated` flags molecules whose gate just closed, for resume.)
5. Do not treat `create-beads` as finished until its backlog invariants pass:
   every source P4 is refined in place to P0-P3, superseded after replacement
   coverage exists, covered while already retired, or retired as an explicitly
   human-approved non-goal. Immediately before materialization and again before
   completion, recompute the full hierarchy-plus-`discovered-from` closure and
   include any outside direct source. The closure must contain no open P4, and
   its ready subset must contain zero P4 items. Report the feature epic id,
   task count, dispatchable ready count (ready P0-P3), blocked count, backlog
   dispositions, and `Ready P4: 0`.
   Only then recommend /implement-ready (or ask any session to work the epic).
6. Squash the wisp: `bd mol squash <root-id> --summary "<2-4 sentence digest: feature, epic id, task-bead count, both gate outcomes, spec file path (quick: epic-carried)>"`.
   This collapses the spent pipeline scaffolding into one durable digest bead and
   auto-cleans the ephemeral step beads; the feature epic and (full depth) the
   `specs/` file remain the record. Sweep any stragglers with `bd mol wisp gc`.
7. Absorb the beads audit log — the FINAL git action of the run, after step 6's
   wisp squash and all final bd reporting are done, immediately before you tell
   the user the run is complete. `.beads/interactions.jsonl` is a beads-tracked
   append-only audit log; those post-commit bd calls (`bd mol squash`, `bd mol
   wisp gc`, reporting) dirty it after your squash-to-main already landed.
   Absorb the delta exactly once:
   - `~/.beads/rail/implement-ready.sh absorb --repo <repo>` — it reports
     `clean` (nothing to do), stages only tracked `.beads/*.jsonl` and reports
     `staged`, or exits 8 with `blocked` when the index is not empty. On
     `blocked`, park the user's staged changes with `git stash push --staged`
     (verify support via `git stash -h`; git ≥ 2.35), call absorb again, and
     restore with `git stash pop --index` after the commit/amend.
   - On `staged`, commit it — and prefer AMENDING when HEAD is still THIS run's
     own squash commit and unpushed (`git branch --remotes --contains HEAD`
     empty): `git commit --amend -m "<same subject>" -m "<same body>"`,
     re-supplying the complete message (the user's hooks require literal `-m`
     on amends, never `--no-edit`). Otherwise — HEAD moved because a parallel
     session landed after you, HEAD is already pushed, or the run made no
     commit of its own — make a standalone `git commit -m "chore(beads):
     record task audit log"`. The rail never commits; that choice is yours.
   - `absorb --repo <repo> --verify` confirms `.beads/` is clean. Only now
     report completion. Never absorb mid-run — exactly once, at the end; if
     some bd command must run after the absorb, repeat it.

## Worktree protocol (parallel sessions)

Multiple spec/implement-ready sessions may run in parallel in the same repo, so
any run that will change files MUST isolate itself in its own git worktree before
the first edit and MUST squash-merge back to main and remove the worktree before
reporting completion — worktrees are never left behind, even if the run gets no
follow-up. bd resolves the shared issue database from any worktree (verified), so
bd commands may run anywhere. While a run is in flight main may not only ADVANCE
but also be REWRITTEN (the primary checkout frequently amends main via
`git commit --amend`), so the worktree records the commit it branched from at
creation to integrate correctly later.

**Start (before the first file change of the run):**
- Derive a short slug from the feature (e.g. `wt/spec-<slug>`).
- Ignore the worktree container without touching tracked files: if
  `git check-ignore -q .worktrees` fails, append `.worktrees/` to
  `.git/info/exclude`.
- Always use plain git at the canonical location — do NOT use managed-worktree
  mechanisms (pi-subagents worktree isolation included); the location MUST be
  `.worktrees/`. Create it HOOK-FREE — repo hooks fire inside linked
  worktrees, and beads hooks there can sync the live DB from the worktree's
  stale tracked `.beads` snapshot (an open P1 bead was once hard-deleted this
  way). Run from the repo root; the worktree lives at
  `<repo>/.worktrees/<slug>`:
  - `mkdir -p ~/.beads/no-hooks` (once)
  - `git worktree add --no-checkout .worktrees/<slug> -b wt/<slug> main`
    (--no-checkout so no hook fires during the add itself)
  - `git config extensions.worktreeConfig true`
  - `git -C .worktrees/<slug> config --worktree core.hooksPath ~/.beads/no-hooks`
  - `git -C .worktrees/<slug> reset --hard main`
  Primary-checkout hooks are untouched — the squash commit to main still runs
  them.
- Record the base commit at creation: `BASE=$(git rev-parse main)` (the commit
  the worktree branch was created from) — it is needed at integration time to
  detect whether main later advanced or was rewritten.
- All file edits — including the `specs/` file this pipeline writes — happen
  in the worktree. bd commands may run anywhere.
- A bd-only survey or a `depth=quick` run (which writes no files) needs no
  worktree.

**Finish (MANDATORY before telling the user the run is complete):**
- Run the repo's quality gates in the worktree; commit the work there following
  the repo/user commit conventions (single bare `git commit` with literal `-m`
  messages; never `--no-verify`).
- Integrate onto current main (other parallel sessions may have advanced OR
  rewritten main). First detect which: `git merge-base --is-ancestor $BASE main`.
  - If main still contains $BASE (advanced or unchanged): rebase the worktree
    branch onto current main — from the worktree, `git rebase main` (rebase over
    merge keeps the squash diff clean) — resolving conflicts by inspecting both
    sides, never blind `--theirs`/`--ours`.
  - If main no longer contains $BASE (history rewritten, e.g. a force-amend):
    rebase ONLY the worktree's own commits onto the new main:
    `git rebase --onto main $BASE wt/<slug>`. Never merge here — merging a
    rewritten main can resurrect pre-amend content.
  - In BOTH cases, immediately before the squash step re-verify main hasn't moved
    again (`git rev-parse main` unchanged since the check); if it moved, repeat
    the detection. The squash-to-main must be based on main's tip at that moment.
- Landing guard (dirty-repo safety): in the primary checkout check
  `git rev-parse --abbrev-ref HEAD` and `git diff --cached --quiet`. If HEAD
  is `main` and the index is empty, proceed to the squash below. Otherwise
  STOP and ask, stating the exact state (current branch, staged files), with
  labeled options:
  - A (default; a bare `c` reply selects it): commit the squash onto the
    CURRENT branch, leaving all other in-flight changes intact — for when the
    user knows nothing else is concurrently changing the repo. Mechanics: if
    the index is non-empty, first verify `git stash push --staged` is
    supported (`git stash -h`; git ≥ 2.35), run it to park the user's staged
    changes, then `git merge --squash wt/<slug>`, one bare `git commit` (the
    index now holds only the squash diff), then `git stash pop --index` to
    restore. If `--staged` is unsupported or the pop conflicts, stop and
    report — never improvise with `git checkout`/`git reset`.
  - B: land nothing — keep the worktree and branch intact and report their
    exact paths so the user can land the commit manually later.
- Squash to main: from the primary checkout, `git merge --squash wt/<slug>`, then
  one commit on main (conventional subject + wrapped body describing the net
  change; include the `specs/` file).
- Clean up: `git worktree remove <path>` and `git branch -d wt/<slug>`
  (`git worktree prune` after; never `rm -rf`), then `git worktree list` to
  confirm no session worktree remains. Extend this to a sweep: remove any
  clean+merged leftover worktree you find, and explicitly report any
  dirty/unmerged one you refused to remove rather than deleting it.
- Only after cleanup verification may the session report completion.
- If the run made NO file changes, skip the merge/commit but still remove any
  worktree it created.

**After completion:** the session works directly on main; small follow-up
requests are committed straight to main (no new worktree) unless the user starts
a new large task.

**Failure path:** if a rebase (either form) or the squash-merge hits conflicts
you cannot confidently resolve, do NOT delete the worktree — report the exact
state (worktree path, branch, conflicting files) to the user and stop.

Committing in the worktree and the squash-commit to main are REQUIRED parts of
the run; pushing remains forbidden unless the user asks.

Resuming: if a speckit wisp for this feature already exists (check
`bd mol wisp list`, `bd mol ready --gated`, or `bd list --status=in_progress`),
resume it at its current position instead of instantiating a duplicate.
