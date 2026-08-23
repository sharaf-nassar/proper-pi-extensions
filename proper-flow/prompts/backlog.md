---
description: Research every P4 backlog item and refine independent clusters into implement-ready P0-P3 cards
argument-hint: "[workers 1-12, default 12]"
---

Drain the whole Beads backlog into implement-ready work. Worker limit from the
user: $ARGUMENTS (one positive integer, default 12, hard maximum 12).

You are the ORCHESTRATOR. You own root-level `bd` mutations; assigned
refinement workers may mutate only their exact wisp and source-id set. The user
never touches the Beads CLI. Whenever this workflow needs input from the user,
call the `ask_user_question` tool instead of asking in plain text. Group related
questions into one call. Fall back to plain text only if the tool is unavailable
or fails before displaying its UI.

This command REFINES work; it does not implement the resulting cards. The
durable output is verified P0-P3 Beads work. It uses one quick-depth `speckit`
wisp per independent conflict cluster so unrelated backlog never gets collapsed
into one feature epic. Quick depth is deliberate: workers write no repository
files, so independent clusters can run concurrently without Git worktrees or
integration commits. The final Beads audit log still lands through `absorb`.

## 0. Preflight, run ownership, and baseline

1. Parse the optional worker count. Default `POOL_LIMIT=12`, reject values below
   1, and clamp values above 12 to 12 while reporting the effective limit.
2. Verify `bd`, the `speckit` formula, pi-subagents, and the implementation rail
   exist. Missing tools or formula files are environment failures; report them
   instead of inventing substitutes.
3. Acquire one atomic repository run lock BEFORE reading the backlog. Set
   `BACKLOG_RUN_ID=backlog-<UTC timestamp>-<session suffix>`, resolve the common
   Git directory, and atomically create
   `<git-common-dir>/backlog-refinement.lock` with `mkdir`. Store the run id,
   repository, session identity, and acquisition time in its owner record.
   Existing lock → show its owner and stop. Resume only when the user explicitly
   chooses the same inactive run; adopt its `BACKLOG_RUN_ID`. Never steal or
   overwrite a lock owned by another live or uncertain run.
4. Snapshot the baseline once:

   ```bash
   bd list --status=open,deferred --priority=4 --json --limit=0
   ```

   Save the exact id set as `INITIAL_BACKLOG_IDS`. Start
   `ADOPTED_SOURCE_IDS=[]` and `RUN_SOURCE_IDS=INITIAL_BACKLOG_IDS`. Empty means
   the backlog is clean: release the owned lock, report that, and stop without
   creating wisps.
5. Read every baseline record with `bd show <id> --json`, including its parent,
   dependencies, labels, notes, design, acceptance, and provenance links. A P4
   epic is a cluster container, not a task to convert into type=task.

The baseline is the accountability boundary, not a ban on Speckit's required
live closure refresh. A P4 discovered later may join this run only when it is in
an active cluster's hierarchy-plus-provenance closure. The parent must add it to
that cluster, `ADOPTED_SOURCE_IDS`, and `RUN_SOURCE_IDS` before any worker
mutates it. Unrelated post-baseline P4s stay outside this run.

## 1. Reconnaissance fan-out

Run one read-only reconnaissance pass per initial P4 item. These workers may
read the repository, Beads, session history, `lat.md/`, `specs/`,
`docs/solutions/`, and current official web documentation. Use `bd --readonly`
for Beads inspection. They must not run mutating `bd` commands, edit files,
create worktrees, or implement code.

Each pass must research both sides of the item:

- Local: locate the actual code path, existing design intent, prior Beads work,
  failed approaches, parent/provenance context, likely `Files:`, and concrete
  verification or reproduction.
- Web: check current authoritative documentation when the item depends on an
  external library, protocol, service, CLI, or best practice. For a purely
  internal item, return `web_research: not_applicable` with a reason instead of
  padding the report with irrelevant search.

Return one JSON dossier:

```json
{
  "source_id": "bd-id",
  "title": "source title",
  "classification": "bug|feature|chore|decision",
  "problem": "one precise problem statement",
  "evidence": ["file:line or source URL"],
  "files": ["repo/relative/path"],
  "conflict_keys": ["component-or-shared-primitive"],
  "related_sources": ["bd-other"],
  "duplicate_sources": ["bd-other"],
  "target_epic": "id|new|ambiguous",
  "product_questions": ["question requiring the human"],
  "technical_decisions": ["decision and rationale"],
  "recommended_cards": 1,
  "web_research": "done|not_applicable"
}
```

Launch reconnaissance in rolling async batches up to `POOL_LIMIT`. Give each
child the source title and one-line problem first so llm-router has useful
signal. Use fresh worker context and no model pin. Track `RECON_ACTIVE` and
`LAUNCHING_SOURCES`; use the same short async launch-workflow, receipt
reconciliation, wait-for-next-terminal, and immediate-refill mechanics defined
for clusters in section 4. A failed code/task analysis retry may use
`[[llm-router: fable]]` only after the failure names a concrete missing
investigation.

## 2. Build conflict clusters

Reconcile all dossiers before any Speckit mutation.

A refinement cluster may combine sources only when they are duplicates, pursue
the same outcome, or form one coherent feature under the same resolved target
epic. Duplicate sources belong together so one worker proposes canonical
coverage instead of creating duplicate cards.

File, component, schema, API, dependency, or shared-primitive overlap creates a
serialization edge, not automatically one wisp. Sources with distinct target
epics remain separate clusters even when they touch the same files; mark them
`serializes_with` and materialize them in order. Never collapse two P4 epics
into one Speckit wisp merely because their implementation may conflict.

Take the transitive closure of true same-outcome/same-epic relationships: every
id in `INITIAL_BACKLOG_IDS` belongs to exactly one refinement cluster. Build a
separate conflict graph between clusters. Independent clusters have no conflict
edge and may run together; conflicting clusters are serialized.

Present a compact cluster plan before refinement: cluster id, source ids,
target epic, problem, likely files/components, `serializes_with`, and unresolved
product questions. Ask only questions needed to change clustering or authorize
a product decision; do not ask the user to choose technical implementation
details that research can resolve.

## 3. Instantiate one quick Speckit wisp per cluster

Create cluster wisps sequentially from the parent so no cluster is instantiated
twice. First inspect `bd mol wisp list` and `bd mol show`. Resume only a wisp
whose notes name the same `BACKLOG_RUN_ID` and source ids. Never resume, claim,
or resolve gates for a wisp tagged to another run.

For each new cluster derive a short slug and problem statement from the dossiers,
then run one of:

- Singleton non-epic source:
  `bd mol wisp speckit --var feature=<slug> --var problem="<problem>" --var context="<dossier context>" --var source_backlog=<id> --var depth=quick`
- Related source set:
  `bd mol wisp speckit --var feature=<slug> --var problem="<problem>" --var context="<dossier context>" --var backlog="<comma-separated ids>" --var depth=quick`
- Existing target epic: add `--var epic=<id>`.
- Ambiguous epic provenance: add `--var epic_candidates="<ids>"` and explain the
  ambiguity in `context`; the human chooses at the clarify gate.

Always pass dossier evidence, source URLs, local file findings, technical
decisions, and `backlog-run: BACKLOG_RUN_ID` through `context`. Immediately
append notes to the wisp root containing the run id, cluster id, and source ids.
Record cluster id → wisp root → source ids. No source id may appear in two
active wisps.

For a P4 epic source, pass it as `epic`. Use Speckit's `promote-epic`
disposition when its approved plan yields P0-P3 child coverage; the formula
keeps its epic type and promotes priority only after that coverage exists. An
explicitly human-approved epic non-goal may still use `approved-non-goal`.
Never convert an epic into a task merely to clear P4.

## 4. Rolling refinement pool

Use pi-subagents as a rolling pool. Keep explicit maps:

- `ACTIVE`: cluster id → child run id, wisp root, attempt, source ids.
- `LAUNCHING_CLUSTERS`: cluster ids reserved by a launch workflow but not yet
  reconciled.

Hard invariant:
`ACTIVE.size + LAUNCHING_CLUSTERS.size <= POOL_LIMIT <= 12`.

Only clusters without a serialization edge may be ACTIVE together. A cluster
discovered to overlap an active sibling is held until that sibling materializes
and the held plan can reuse its cards rather than duplicate them.

For each refill batch, make ONE top-level `subagent` call with `async: true` and
a short `workflowScript`. Launch one `runs.all` item per preassigned cluster,
`agent: "worker"`, `context: "fresh"`, and child `async: true`. Return only
launch receipts. Wait for that short launch workflow by exact id, reconcile
receipts, then move successful launches into `ACTIVE`.

Each worker receives one exact cluster, source-id set, and wisp root. It must:

1. Work only that wisp and its parent-approved source set. Never select another
   backlog item. Use one stable cluster actor and pass it to every mutating
   `bd` command.
2. Loop through `bd ready --mol <root-id>`, claim one step, follow the step
   runbook verbatim, and close it.
3. Use quick depth: no repository file edits, worktrees, commits, or nested
   subagents.
4. Preserve every dossier citation and research conclusion in the quick
   spec/plan, epic, task design, or acceptance fields.
5. Stop at each human gate and contact the supervisor with structured gate id,
   step id, questions, technical decisions, coverage summary, and recommendation.
   Never answer a human gate itself.
6. Before `create-beads`, re-read every source, the formula's refreshed closure,
   and any cards materialized by a serialized sibling. If the closure contains
   a new P4, stop before mutation and send its id/evidence to the parent. The
   parent must either adopt it into this cluster and update
   `ADOPTED_SOURCE_IDS`/`RUN_SOURCE_IDS`, or stop for reclustering. Reuse existing
   coverage and dependencies; never create a second card for the same outcome.
7. Squash the completed wisp and return JSON:

   ```json
   {
     "cluster_id": "cluster-1",
     "source_ids": ["bd-a"],
     "status": "done|failed",
     "epic_id": "bd-epic",
     "task_ids": ["bd-task"],
     "dispositions": {"bd-a": "refined|epic-promoted|superseded|already-retired-covered|retired"},
     "research_sources": ["file:line", "https://..."],
     "checks": ["verification performed"],
     "failure": "only when failed",
     "error_signature": "stable signature only when failed"
   }
   ```

After each launch/refill, inspect ACTIVE once for instant completion. If no
ACTIVE child is terminal, call
`subagent_wait({ stopOnAttention: false })`, never `all: true`; this wakes on the
next completion while unrelated workers continue. Refill immediately after a
terminal cluster is reconciled.

## 5. Human gates and cross-cluster safety

Workers send human gates to the parent with exact wisp root, gated step id, and
gate id. The worker must inspect the step runbook, then run `bd gate list` and
`bd gate show <gate-id>` to prove that the open gate blocks that exact step. It
must never select a gate by title or proximity.

The parent independently runs `bd gate show <gate-id>`, verifies the root and
step ids, and uses `ask_user_question` for all user input, at most four related
questions per call. After the user answers, resolve exactly
`bd gate resolve <gate-id>`, reply to the waiting child with the answers, and
require it to claim the now-ready step, incorporate the answers, and close the
step normally. Multiple simultaneous gates remain separate records; never bulk
resolve or send one cluster's answer to another child.

Clarify gates carry product decisions. Technical questions stay with the worker
unless research found no standard and the choice materially changes product
behavior, cost, privacy, or irreversible risk.

Hold analyze gates until every concurrently planned cluster has exposed its
likely files, shared primitives, and proposed cards. Cross-check plans:

- no duplicated card outcome;
- no two unordered cards introduce the same primitive;
- shared target epics and dependencies agree;
- every source P4 has one explicit disposition;
- every proposed task has concrete acceptance and `Files:`.

If late overlap appears, serialize those clusters. Let the first materialize;
then send the second back through its plan with instructions to reuse the landed
coverage. Human approval never waives missing acceptance, missing source
coverage, or duplicate work.

## 6. Failure policy

A retry requires a concrete change: new evidence, corrected source set,
answered gate, or specific failed command/context. One identical
`error_signature` repeat stops retries. Missing tools, credentials, services,
or production access go to the user; never install or improvise around them.
Keep independent clusters draining while one waits.

A failed cluster is not complete. Preserve its wisp, run lock, and attempt
evidence in source notes, and report the exact blocker. Do not relabel it as
refined merely because research was produced. Release the lock on failure only
when the user explicitly abandons the run; otherwise it protects resume.

## 7. Verify the entire initial snapshot

Do not trust worker reports. For every id in `RUN_SOURCE_IDS` (the initial
baseline plus parent-approved adopted closure ids), inspect the live source and
replacement cards. Exactly one terminal disposition must hold:

1. **refined** — source reused as an open P0-P3 non-epic card with structured
   acceptance criteria and a concrete `Files:` line;
2. **superseded** — source retired only after P0-P3 replacement cards provide
   complete acceptance coverage;
3. **already-retired-covered** — another actor retired the source, and verified
   P0-P3 cards still provide complete actionable replacement coverage;
4. **retired** — source closed as an explicitly human-approved non-goal;
5. **epic-promoted** — source remains an epic, is P0-P3, and has concrete P0-P3
   child cards covering its approved plan.

Every resulting task must have a verb-first title, Why/What description,
`Files:`, structured acceptance, design context, correct parent, and only real
blocking dependencies. Verify no run source remains open or deferred at P4.
Run:

```bash
bd list --id "<comma-separated RUN_SOURCE_IDS>" --status=open,deferred --priority=4 --limit=0 --json
```

The result must be empty before this run can report success. Run `bd blocked`
and scoped ready queries to verify the resulting cards form a workable frontier.
Sweep completed wisps with `bd mol wisp gc`; preserve failed wisps as evidence.

Finally list current open/deferred P4s again and subtract `RUN_SOURCE_IDS`.
Report the remainder as `new_backlog_since_snapshot`, not as work this run
abandoned.

## 8. Absorb and report

After every final `bd` command, run:

```bash
~/.beads/rail/implement-ready.sh absorb --repo <repo>
```

On `staged`, commit only the tracked `.beads/*.jsonl` audit delta with the
repository's required literal-message commit protocol. On `blocked`, park an
existing staged index with `git stash push --staged`, absorb, commit, then
restore it with `git stash pop --index`. Finish with `absorb --repo <repo>
--verify`. The rail stages but never commits. After clean verification, remove
`backlog-refinement.lock` only after re-reading its owner record and confirming
it still matches `BACKLOG_RUN_ID`.

Report:

- `BACKLOG_RUN_ID`, initial backlog count/ids, and adopted source ids;
- research completed and web-not-applicable reasons;
- conflict clusters and peak worker occupancy;
- clarify/analyze gate decisions;
- each source disposition;
- epics and P0-P3 cards created or reused;
- retries, failures, and preserved wisps;
- initial P4 remaining (must be zero for success);
- `new_backlog_since_snapshot`;
- audit absorption result.

Never implement the resulting cards, never push, and never call the run complete
while any initial or adopted P4 source lacks a verified terminal disposition.
