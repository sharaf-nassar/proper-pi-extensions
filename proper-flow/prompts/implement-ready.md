---
description: Fan out parallel agents over the ready beads frontier — one agent per task, relaunching as tasks unblock, until all work is done
argument-hint: "[epic id | all] [max parallel agents, e.g. 4]"
---

Orchestrate parallel implementation of the ready beads frontier. Scope from the
user: $ARGUMENTS (an epic id to stay within, or "all" for the whole board;
optionally a number capping concurrent agents — default: no cap).

You are the ORCHESTRATOR: you dispatch and verify agents, re-survey, and report.
You MAY mutate files when needed, but never outside the rail's ownership model:

- Task-scoped edits happen only in that task's rail-created worktree, never
  while a worker is active there, and follow the same commit, result,
  verify-worker, prepare, and integration sequence as worker edits.
- Primary-checkout file edits are limited to run-level artifacts this prompt
  explicitly assigns to you (such as learnings). Never implement task code
  directly on main or edit while a prepared squash or staged index exists.
You need no separate orchestrator worktree. You run ALL `bd` and rail commands;
the user never touches the bd CLI.

Mechanism lives in the rail, not in this file:

```bash
~/.beads/rail/implement-ready.sh --help
```

Treat its help output as the source of truth for arguments. It owns run state,
claims, worktrees, the integration lock, squash preparation, integration
verification, cleanup, the acceptance gate, the overlap report, the retry gate,
and audit-log staging. It never launches agents and never commits. The same rail
drives the Claude and Codex versions of this command; only the agent runtime and
the routing model differ. Everything below is judgement the rail cannot make.

Worker model selection is llm-router's job, not yours: every spawned worker's
first input (its task) gets its own judge verdict, and any model option in the
spawn call is ignored. Your only model lever is the `[[llm-router: <model>]]`
task prefix, applied per the ROUTING NOTES below.

FIRST — routing precheck, before anything else (including the scope prompt):
run `printenv LLM_ROUTER_OFF`. If it prints `1`, llm-router will NOT route
workers — children keep whatever model pi-subagents resolves, and sentinel
prefixes are never stripped or honored. Tell the user, and ask (A) continue
with routing disabled, or (B) stop so they can unset it and restart pi. If
unset: routing works normally, proceed.

ROUTING NOTES — llm-router judges each worker's task text, so give it signal:
every dispatched task string must lead with the bead title and a one-line
scope summary before the protocol boilerplate (the judge reads the first
4000 chars). Levers:

- default task — NO prefix. The judge picks the arm per its measured rubric;
  trust it. Never pin a model upfront on a normal implementation task:
  escalation on evidence beats upfront prediction.
- escalation retry — prefix `[[llm-router: fable]]`. Reserved for step 4's
  fix-forward retry after a code/task-defect failure. Never dispatched
  upfront — the escalation lever is the model jump.

Routing discipline: bead text under-signals difficulty, and that is fine —
misrouting DOWN is self-correcting (the failure escalates the retry at the
cost of one attempt); a pinned misroute UP only burns money. So the
escalation retry is the ONLY pin. Record each pinned dispatch and include
escalation counts in the final report. (No surveyor agents exist in this
flow: `survey` is a rail command YOU run directly between waves.)

0. No args given? Prompt for scope before doing anything else. List the open
   epics (`bd list --status=open --type=epic`, plus any epic with open
   children) as numbered options — for each: number, epic id, title, and its
   open/ready/blocked task counts — plus a final "All" option for the whole
   board. If exactly one epic is in scope, do NOT prompt — auto-select it and
   print a one-line notice like "Single epic in scope — auto-selecting
   temet-cgh (admin-theme-polish)." Otherwise (2+ epics): prefer the
   ask-user-question tool when available (one option per epic + "All");
   otherwise print the numbered list in chat and ask the user to reply with a
   number or "all". Wait for the choice — do not pick a default. (Numbered
   options are intentional here and override any letter-label convention.)

   While scoping, also record HOLDS: any task the user wants kept out of this
   run — touching production, needing credentials or installs, or simply
   "leave X alone". Write the ids down as an explicit list the moment a hold
   is stated (at scope time or any point mid-run); step 2 screens every
   dispatch against it. A hold that lives only in chat intent is how a held
   task got dispatched in a previous run and made live production API calls:
   state it, list it, screen it.

1. Initialize and survey through the rail:
   - `init --repo <path> --scope <epic|all>` → save `run_dir` and `actor`.
     A non-null `hooks_hazard` (absolute `core.hooksPath`) is informational,
     NOT a gate: the rail creates every task worktree hook-free (per-worktree
     `core.hooksPath` override), so repo hooks — beads DB sync included —
     cannot fire inside them; an open P1 bead was once hard-deleted by
     exactly that firing. Primary-checkout hooks still run, which is where
     they belong (your squash commits on main). Do not stop; carry the
     hazard line into the report — it still matters for worktrees created
     outside the rail. Consequence to know: worker commits in task worktrees
     get no hook-side lint or message validation — enforcement lives in
     `verify-integration --gates` and the primary hooks on your main commit.
   - `survey --run-dir <run_dir>` → the frontier. A nonzero exit or invalid
     JSON is a failure, NEVER an empty frontier. Save this first frontier's
     id set — step 2 adjudicates any task that later appears beyond it.

   The rail has already applied every mechanical filter, so do not re-derive
   them: epics are excluded, `p4_excluded` holds ready P4 items, and
   `unacceptable` holds P0-P3 beads whose `acceptance_criteria` is missing or
   blank — those are absent from `ready` and `claim` will refuse them.

   Report each bucket honestly and distinctly. `p4_excluded` was never
   dispatchable; `unacceptable` needs refinement, not dispatch — say
   `unacceptable: <ids> — no acceptance criteria, refine before dispatch` and
   suggest `/spec <id>` (or `/file <id>` for a bug). NEVER write acceptance
   criteria onto a bead yourself to get it dispatched: that is the worker's
   invention moved one seat earlier. Neither bucket is a failure or a stuck
   task. A childless epic in the frontier → report it and suggest `/spec <id>`.

   If the user asks you to work a P4 directly, do NOT dispatch it. A P4 has no
   acceptance criteria or plan refs by construction, so a worker would invent
   its own scope and integrate the invention. Offer `/spec <p4-id>` instead.

   If nothing is ready and nothing is in progress, show `bd blocked` and stop.

   Record main's current SHA as RUN_BASE (`git rev-parse HEAD` on the primary
   checkout) — step 7 needs it to tell this run's changes from pre-existing
   ones. Per-task branch points are not a run baseline.

   Also pick the run's INTEGRATION GATE command now: the repo's fast quality
   gate (lint + typecheck + the relevant test suite, from its justfile /
   package.json / CI config). If the full gate is slow, choose a smoke
   subset — the full gate still runs once at the end (step 6). Every
   `verify-integration` below passes this command via `--gates`; a clean
   rebase proves only textual integration, and this is what catches two
   individually-green siblings that break each other semantically.

2. Orchestrate as a WAVE LOOP that YOU drive, dispatching each wave with the
   pi-subagents `subagent` tool (this command is your authorization to invoke
   it). Do NOT try to encode the whole dispatch/refill cycle in one
   workflowScript: scripts can only run agents (`runs.run`/`runs.all`) — they
   cannot run the rail, bd, or git; claims and worktrees must exist
   parent-side BEFORE a worker can be dispatched; and beads only close when
   YOU integrate results, so an in-script survey can never see a refilled
   frontier. One big script degenerates to a single wave and then stalls.
   The loop lives in you; the script is per-wave.

   Each wave:
   - Survey: re-run rail `survey` yourself → the current frontier.
   - Pick the wave: PRE-ASSIGN each agent its exact task id — agents must NOT
     survey, pick, or re-route for themselves; assignment by the orchestrator
     is what prevents two agents claiming the same task. Slice to the cap,
     and screen every candidate:
     - HOLDS: never dispatch a task on the hold list (step 0).
     - Newly-ready tasks (any id beyond the first frontier saved in step 1,
       including beads filed mid-run) are ADJUDICATED, never auto-dispatched:
       check the hold list, and ask whether closing it needs anything a
       worker must not do — production access, credentials, spend, an
       irreversible action. If yes, surface it to the user and leave it out
       of the wave; the rest of the frontier keeps dispatching.
   - Per assigned task, YOU run the rail pre-dispatch sequence
     (overlap → claim → worktree; details below).
   - Dispatch the wave as ONE `subagent` call: a `workflowScript` whose body
     is a single `runs.all` with one item per task (`agent: "worker"`,
     `context: "fresh"`, task string per the prompt spec below), returning
     the workers' JSON results. Every worker's task gets its own llm-router
     verdict from its task text — no per-child model or effort options exist,
     and none are needed.
   - When the wave returns, integrate each result through the rail (result →
     verify-worker → prepare → your commit → verify-integration --gates →
     cleanup → unlock), close each completed bead, then loop back to Survey —
     completing a task may unblock others.
   - Track per-task attempt count AND the previous attempt's
     `error_signature` across waves (step 4 needs both). Stop when the
     frontier has no workable tasks or a wave makes no progress.

   If pi-subagents is unavailable, work the tasks one at a time yourself under
   the worker protocol below. You may also take over a narrow repair directly
   when its root cause and patch are concrete. A direct orchestrator attempt
   still uses the task worktree, produces a commit and result JSON, and passes
   every normal rail verification and integration step. Never edit a task
   worktree while its worker is active — stop or reap the worker first.

   Per task, YOU run the rail sequence; workers never touch it:
   - `overlap --run-dir DIR --task ID` — report-only. `conflict` means another
     in-flight task declares the same non-hub file; serialize it into a later
     wave when you judge that worthwhile. `undeclared` means the bead has no
     `Files:` line and the guard is blind to it — count these, because a run
     that is mostly undeclared is unguarded, not clear.
   - `claim --run-dir DIR --task ID` — exit 3 means another actor holds it;
     that is terminal for this run, never steal a claim.
   - `worktree --run-dir DIR --task ID` — creates the worktree and branch and
     records the base. This is the worker's only workspace.
   - Dispatch the worker (prompt below).
   - `result --run-dir DIR --task ID --attempt N --json <worker JSON>`
   - `verify-worker` — proves the commit is real, canonical, on the right
     branch, and descends from the recorded base, and reports `files_drift`.
     Do NOT relay worker claims without it. Non-empty `undeclared` drift
     means the overlap guard screened this task against the wrong file set:
     re-check those paths against the other in-flight tasks' declared files
     before `prepare`, integrate any intersecting pair serially, and count
     the drift in the report.
   - `prepare` — takes the integration lock, rebases (choosing the advanced or
     rewritten-main path itself), squashes into the primary index, and proves
     the staged tree equals the branch tree.
   - YOU commit on main, following the repo/user commit conventions.
   - `verify-integration --gates "<the run's integration gate command>"` —
     proves the commit shape AND runs the gate on the integrated tree while
     the lock is held. Exit 10 = the gate failed on main: the breakage
     belongs to the task that just landed (its own worktree checks passed
     against a main that no longer exists). Keep the lock, fix forward with
     a fresh worker branched from current main — or revert the squash
     commit — and do not `prepare` the next task until main is green again.
   - `cleanup` → `unlock`. On a rebase conflict (exit 5) the lock is retained
     deliberately: preserve the evidence, report, and use `unlock --abort`
     only when recovering.

   Each dispatched worker's task string must be self-contained and contains NO
   git protocol — the rail owns that:
   - The bead title + one-line scope summary FIRST (llm-router judges on it),
     then the task id and the worktree path the rail created, with the
     instruction to work ONLY there.
   - Read the spec/plan artifacts linked from the bead's `Spec:` (spec_id) and
     DESIGN fields via `bd show` (fall back to the epic's notes/spec_id for
     older beads); implement to the acceptance criteria; verify concretely
     (tests/lint/build); respect repo rules (AGENTS.md, constitution.md,
     lat.md sync). When `docs/solutions/` exists and a cheap grep of its
     titles/tags matches the task's files or component, read the hits before
     implementing — recorded root causes and failed approaches there are
     required context, same as lat.md.
   - Commit its work on the task branch and return JSON:
     `{task_id, attempt, status: "done"|"failed", commit_sha, checks, summary}`
     or on failure `{..., failure, error_signature}` where `error_signature` is
     one normalized line naming the failing command plus its first real error
     line, volatile tokens (durations, pids, tmp paths, timestamps) stripped,
     file:line kept. You compare that string across attempts, so it must be
     stable for the same underlying failure.
   - A decision the bead and its spec/plan do not answer (product behavior,
     scope, anything irreversible) is NOT the worker's to make: use
     `contact_supervisor` with `reason: "need_decision"` when available,
     otherwise return `status: "failed"` naming the needed decision as the
     `failure`. An invented decision that integrates is worse than a failed
     attempt.
   - Workers must NEVER run `bd`, mutate `.beads`, touch the primary checkout,
     create or remove worktrees or branches, spawn their own subagents, or work
     on another task. The rail refuses a task branch that modifies `.beads`.

3. Monitor and refill: the wave loop keeps the pipeline full — completing a
   task may unblock others, which get agents in the next wave. When the run
   finishes, verify the load-bearing claims yourself: spot-check beads closed
   (`bd show`), squash commits present on main (`git log --oneline`), and sweep
   worktrees (`git worktree list`). Do not relay agent claims unverified.

4. Failures. Before dispatching attempt N+1, run
   `retry-gate --run-dir DIR --task ID --attempt N --prior-attempts M`, where M
   is the count this bead already burned in EARLIER runs (read it from the bead
   notes — without it the ceiling is meaningless, since a fresh run resets a
   per-run counter). Two denial classes:
   - exit 7 (hard): the prior attempt did not fail, no result was recorded, or
     the `error_signature` repeated. A repeated signature is evidence the change
     did not move the failure. Not overridable.
   - exit 9 (soft): the cumulative ceiling. Pass `--override-ceiling "<reason>"`
     to proceed; the reason is journaled. Do this when you can name a genuinely
     different next attempt — do not let arithmetic stop a converging run.

   The gate the rail CANNOT check is yours: you must be able to name a concrete
   change since the last attempt — an amended prompt stating the specific fix
   (exact file + mismatched context, or the failing gate), or a
   human-remediated environment. "Try again harder" is not a change. Passing
   the rail gate is necessary, not sufficient.

   Stuck-task triage (MANDATORY for every stuck id, before reporting). Read the
   last failing attempt's actual error lines, then classify:
   - environment/system dependency — missing binary, `command not found`, a
     PEP 668 pip failure, a missing apt/system package or service. STOP: do not
     re-dispatch. Surface the exact remediation command to the human and wait,
     quoting the failing log lines. Per the user's Missing-Tools rule, installs
     are always the human's decision; never self-install with sudo. The rest of
     the frontier keeps dispatching while this one task waits.
   - code/task defect — apply_patch context mismatch, a failing test/lint/type
     gate, a logic error. When the root cause and patch are narrow and concrete,
     you may fix it directly in the preserved task worktree as the next gated
     attempt. Otherwise use a fresh agent whose task is prefixed
     `[[llm-router: fable]]` (the escalation pin) and whose prompt names the
     specific failure. Either path must pass `retry-gate` and the full worker
     result/verification/integration protocol. If you cannot name a concrete
     fix, or the signature repeated, file a bug bead (`bd create --type=bug`,
     blocking the stuck task) and leave it stuck.
   - transient — git lock, network blip, sibling contention. The ONLY class
     where a plain re-run is legitimate, at the task's original prefix (usually
     none); the condition clearing IS the concrete change. A repeated signature
     means it was never transient — reclassify.

   When the gate allows a retry because the signatures DIFFER, read that as a
   sizing signal: repeated failures on different defects mean the task is too
   large to hold in one worker's head. Splitting the bead beats another attempt
   at the whole thing.

   An unresolvable-conflict report is terminal immediately — no retry. Stuck
   means: leave the bead open with `bd update --notes` explaining why (quote the
   repeated signature, the missing concrete fix, or the total attempt count),
   preserve any conflict worktree as evidence, keep orchestrating the rest, and
   report it. Tasks blocked only by a stuck task are stranded, not dispatched.

5. Human gates: if progress stalls because a formula molecule is waiting on a
   human gate, surface the gate's question to the user — never answer it
   yourself. That task alone waits; the frontier keeps draining.

6. Done: when all scoped tasks are closed, close the epic if it is now
   childless-open (`bd epic close-eligible`), run the repo's FULL quality
   gates once on main (the complete gate, even when per-integration `--gates`
   ran only a smoke subset), then file ponytail debt and run the ponytail
   review (both below), and only then absorb.

   Ponytail debt (BEFORE the absorb — it runs `bd create`). Workers under
   ponytail mark deliberate shortcuts with `ponytail: <ceiling>, <upgrade path>`
   comments that squash onto main where nobody sees them again. Invoke the
   `ponytail-debt` skill for the ledger — do NOT hand-roll the scan. (On pi the
   skill id is bare `ponytail-debt`, from `npm:@dietrichgebert/ponytail`; the
   `ponytail:` prefix in the Claude and Codex copies of this command is that
   host's plugin namespacing and does not resolve here.) Ponytail is an optional
   package: if unavailable, report `ponytail_debt: skill unavailable` and move
   on; never substitute your own grep. Otherwise:
   - Keep only rows this run introduced: a row's `<file>:<line>` must appear in
     `git diff RUN_BASE..HEAD`. Everything else predates the run.
   - Attribute each survivor: `git blame -L<line>,<line> <file>` gives the
     commit, and the run's one-squash-per-task mapping names the task bead.
   - File each as unparented P4 backlog:
     `bd create "<the ceiling, as a short imperative>" --type=chore -p 4
     --label ponytail-debt --description "<file>:<line> — <full comment text>.
     Upgrade trigger: <the trigger, or 'none stated'>.
     source-task: <task-bead-id>  source-commit: <squash sha>
     source-epic: <epic-id or 'all-board run'>  source-run: <run_id>"`
   - Unparented and dependency-free is deliberate: both a `--parent` and a
     `discovered-from` edge would pull these into /spec's SCOPE closure, whose
     zero-open-P4 invariant would then force every later spec run to adjudicate
     unrelated debt. Provenance lives as description TEXT, which no closure
     traverses. `bd list --label ponytail-debt` is the ledger; `/spec debt` is
     the paydown.
   - Report `ponytail_debt: N filed`.

   Ponytail review (after debt filing, still before the absorb). Dispatch ONE
   fresh agent over the whole run diff and have it invoke
   `ponytail-review` on `git diff RUN_BASE..HEAD` (bare skill id on pi, as
   above). Same optional-package rule; never improvise a review of your own.
   - ONE agent for the run, never one per worker. Workers already generate under
     ponytail, so re-reviewing a single worker's diff re-applies the same lens
     to the same code by the same author.
   - Weight cross-task duplication first. Each worker branched from main and
     could not see its siblings' unlanded work, so two can each write a minimal
     helper for the same thing and both be individually correct. The combined
     run diff is the only vantage point where that is visible.
   - Adjudicate every finding — investigate first, never act on one unverified.
     A finding is an inference, not an author's declaration (the skill lists and
     never applies; correctness and security stay out of its lens):
     - CONFIRMED, cheap, in scope (cross-task duplication above all): file a
       small task bead and run it through the normal rail path in THIS run,
       unprefixed (router-judged). Batch compatible findings into one bead.
     - CONFIRMED but larger, risky, or out of scope: file a follow-up bead
       (normal priority, label `review-followup`) and leave it open.
     - REFUTED: dismiss with a one-line reason.
   - EVERY finding leaves this step as either a bead id or a written REFUTED
     reason. There is no third disposition. "Advisory", "noted", "nothing
     applied", and reporting a finding only in chat are NOT dispositions: chat
     is not durable, the next session cannot read it, and a finding that dies in
     scrollback cost a full-diff review agent and bought nothing. Reconcile
     explicitly: `findings: N = fixed F + filed L + refuted R`. If the three do
     not sum to N, disposition the rest before closing out.
   - If any fix worker landed commits, re-run the quality gates once after the
     last integration.
   - Report per-finding dispositions plus the literal `RUN_BASE..HEAD` SHAs, so
     the pass is reproducible later against an immutable range.

   Learnings (after the review, still before the absorb) — forced
   disposition, same rule as review findings: the report carries
   `learnings: N filed | none — <reason>`, never silence. Write one for
   every stuck task whose diagnosis names a reusable mechanism (environment
   trap, repo hazard, documented-failed approach), every escalated retry
   whose fix reveals why the first attempt was wrong, and any run-level
   discovery (an integration-gate failure's root cause, a confirmed hooks
   hazard). Follow /file step 6's location, format, dedup, and grounding
   rules verbatim (`docs/solutions/<category>/<slug>.md`,
   file:line-verified claims, update-don't-duplicate) — here the fix HAS
   landed, so cite the squash commit and bead id as the fix record. Commit
   them on main as one `docs: record run learnings` commit before the
   absorb. Routine completions produce NO learning — the bar is "a future
   session would re-derive this the hard way", not "something happened".

   Absorb (FINAL git action, after every `bd` command of the run — including
   the epic close, the debt filing, the review's bead filings, the learnings
   commit, and your final surveys): run `absorb --run-dir DIR`. It reports `clean` (nothing to do),
   stages only tracked `.beads/*.jsonl` and reports `staged`, or exits 8 with
   `blocked` when the primary index is not empty — park those staged changes
   (`git stash push --staged`) and call it again. The rail never commits: YOU
   issue one bare `git commit -m "chore(beads): record task audit log"` per the
   user's commit conventions, never `--no-verify`. Then `absorb --verify` to
   confirm `.beads/` is clean. If some `bd` command must run after the absorb,
   repeat it.

7. Report using the run's OWN scoped result — completed (with their commits on
   main), retries, stuck, stranded, unacceptable, p4_excluded, blocked_remaining,
   leftover_worktrees, overlap_guard (declared/undeclared), files_drift
   (workers whose diff left their declared Files), integration_gates (the
   gate command used; any exit-10 failure and its resolution), holds
   (honored, and any adjudicated newly-ready ids), hub_contention,
   ponytail_debt, ponytail_review, learnings (filed paths or `none — <reason>`),
   orchestrator_edits (task id, reason, worktree, and commit), and escalations
   (fable retries dispatched; every other task was router-judged). NEVER a raw
   board-wide `bd ready`/`bd blocked` count, which mixes in epic containers and
   other epics' tasks and reads as abandoned in-scope work. Report stuck tasks
   as stuck; never fold them into p4_excluded or unacceptable — a stuck task
   exhausted the retry gate, a p4_excluded task was never dispatchable, an
   unacceptable one lacked criteria. For each stuck task say which gate stopped
   it: repeated signature, no concrete fix nameable, environment, conflict, or
   the cumulative ceiling. If a board-wide check shows ready/blocked items
   outside this run's scope, put them on a separate, explicitly-labeled line
   naming their epic and suggesting a separate scoped run. Do NOT push unless
   the user asks.
