---
description: Investigate a bug to root cause, then file precise fix beads for /implement-ready to pick up
argument-hint: <bug description, error message, or issue reference>
---

Investigate and file beads for: $ARGUMENTS

This is the high-judgment investigation seat. llm-router routes the session
automatically; when the bug warrants pinning the strongest arm, invoke as
`/file [[llm-router: fable]] <bug>` — the router strips the marker before
this template expands. The fix work itself will be done later by
/implement-ready workers, each routed per task.
You run ALL bd commands yourself — the user never touches the bd CLI.

1. Investigate to ACTUAL root cause — never pattern-match to a plausible one:
   - Reproduce first (failing test, curl, UI path — whatever proves it). If
     you cannot reproduce, say so and ask for more signal; do not file beads
     for unreproduced bugs.
   - Trace the mechanism: read the real code paths, check the repo's knowledge
     base (lat.md/ sections, specs/) for design intent — the bug may be a
     violated invariant that documentation already names.
   - Mine prior work before re-deriving it: search beads for earlier fixes or
     attempts on this symptom/component (`bd list --all --json` + grep; quill
     session-history search when bead signal is thin), and grep
     `docs/solutions/` titles/tags when that store exists, reading the hits.
     A landed fix that did not hold, or a documented failed approach, is
     negative evidence — never re-attempt it without naming what changed.
   - Distinguish root cause from symptom: state the mechanism in one sentence
     ("X assumes Y, but Z makes Y false when ...") backed by file:line
     evidence. If the first hypothesis dies, reinvestigate — don't stack
     variants.
   - Assess blast radius: what else does this mechanism affect? Related latent
     bugs found along the way get their own beads (type=bug, noted as found
     during this triage) — do not silently widen the fix.
2. Present findings in chat BEFORE filing anything: root cause (mechanism +
   evidence), reproduction, proposed fix approach, blast radius, and whether
   it is one bead or several. Wait for the user's go-ahead — they may know
   context you don't. (Quick obvious one-liners: still present, just briefly.)
3. File the beads:
   - `bd create --type=bug` per fix unit. Title defaults to symptom shape
     (`<subject> <does wrong thing> [when <condition>]`, e.g. `Guest routes
     stay dark after hydration`); imperative `Fix ...` is acceptable for an
     explicitly scoped fix unit. ≤60 chars, no trailing period, no `Bug:` or
     `[bracket]` prefix — bd renders the type itself. Root cause and fix stay
     in the description, never the title. Description must contain: Root
     cause (mechanism + file refs), Repro (exact steps/command), Fix approach
     (specific enough that a medium-effort worker cannot wander), `Files:` (one
     line, comma-separated repo-relative paths you expect the fix to touch —
     this is the input /implement-ready's overlap guard uses to decide what may
     run in parallel; a bead without it is dispatched unguarded, so write your
     best list from the investigation rather than omitting it, and mark it
     `Files: unknown — <why>` only when the root cause genuinely does not name
     them), Acceptance criteria (MUST include the regression test that fails
     before / passes after, plus the original repro passing).
   - Priority by user impact (P0 data loss/security, P1 broken flows, P2
     degraded, P3 cosmetic).
   - Multi-part fixes: separate beads wired with `bd dep add <dependent>
     <blocker>` only where order genuinely matters. Systemic clusters: group
     under an epic. Single bugs: standalone bead, no epic ceremony.
4. Hand off: report the bead id(s) and state they're ready for
   /implement-ready. Do NOT implement the fix in this session — the whole point
   is investigation here, execution there. Exception: if the user explicitly
   says fix it now, claim the bead, do the work under the full worktree protocol
   of /implement-ready's worker spec (worktree at `.worktrees/<slug>`, amend-safe
   integration, squash to main, cleanup verified), close the bead, then absorb
   the audit log — see /implement-ready for the full protocol text.
5. Repo hygiene during investigation — the primary checkout is often dirty
   with the user's in-flight work; never add to that dirt:
   - Throwaway repro scripts that can run from anywhere: session scratchpad,
     never the repo.
   - If the repro genuinely needs in-repo files (failing unit test under the
     test tree, fixtures, build-system integration): create a throwaway
     investigation worktree at `.worktrees/bug-<slug>` on branch
     `wt/bug-<slug>` using /spec's HOOK-FREE worktree sequence verbatim
     (`worktree add --no-checkout` → `extensions.worktreeConfig true` →
     per-worktree `core.hooksPath ~/.beads/no-hooks` → `reset --hard main`;
     repo hooks fire in linked worktrees and beads hooks there can corrupt
     the live DB). Ensure `.worktrees/` is ignored via `.git/info/exclude`,
     as in /spec — and write/run the failing test THERE. Copy the exact failing test into the bead's Repro/Acceptance
     text; that is the durable artifact — the fix worker recreates it as the
     real regression test in its own worktree. Then discard:
     `git worktree remove --force .worktrees/bug-<slug>` and
     `git branch -D wt/bug-<slug>`. This worktree is throwaway BY DESIGN —
     the never-delete-dirty-worktrees rule does not apply to it; nothing
     from investigation ever lands on main.
   - If the bug reproduces in the dirty primary checkout but NOT in a clean
     worktree from main, that is itself the finding: the bug lives in the
     in-flight uncommitted work. Report that instead of filing a bead
     against main.
6. Learning disposition — every run ends with one, stated in the hand-off:
   `learning: <path> | none — <reason>`. Write a learning when the
   investigation produced knowledge a future session would otherwise
   re-derive the hard way: a non-obvious root cause, an approach that looked
   right but failed, an environment/tooling trap, or a violated assumption
   worth a convention. Trivial or purely local fixes: `none`, with the
   reason.
   - Location: `docs/solutions/<category>/<slug>.md` (short kebab category —
     runtime-errors, build-errors, environment, conventions, workflow, ...).
     Before writing, grep existing docs' titles/tags for the same problem and
     UPDATE the existing doc (add `last_updated: YYYY-MM-DD`) instead of
     creating a near-duplicate — two docs on one problem drift apart.
   - Format: frontmatter `title` (symptom-shaped), `date`, `component`,
     `tags`, `problem_type` (bug|environment|convention|workflow); body
     sections Problem, Root cause, What didn't work, Fix, Prevention.
   - Grounding: every code-behavior claim cites file:line verified against
     the CURRENT tree; anything unverifiable is attributed ("per this
     investigation"), never stated as fact — this doc becomes trusted
     knowledge, and a wrong claim compounds too. The fix has not landed yet
     at /file time: phrase it as the approach plus its bead id ("fix filed
     as <bead-id>, unlanded as of this writing"), never as a landed change.
   - Boundary with lat.md: a newly named invariant belongs in lat.md/ as
     design intent (put that in the fix bead's acceptance); the learning
     carries the incident — symptoms, dead ends, prevention — which lat.md
     by charter does not record.
   - Commit the learning as its own commit BEFORE the absorb, message
     `docs: record learning <slug>` (single bare git commit, literal -m).
     If the index is not empty, park it with `git stash push --staged` and
     restore with `git stash pop --index` after, exactly as the absorb's
     blocked path does.

7. Absorb the beads audit log — the FINAL git action of the run, after the
   `bd create`/`bd dep add` filing and all final bd reporting are done,
   immediately before you hand off to the user. `.beads/interactions.jsonl` is
   a beads-tracked append-only audit log that filing beads dirties.
   - `~/.beads/rail/implement-ready.sh absorb --repo <repo>` — it reports
     `clean` (nothing to do), stages only tracked `.beads/*.jsonl` and reports
     `staged`, or exits 8 with `blocked` when the index is not empty. On
     `blocked`, park the user's staged changes with `git stash push --staged`
     (verify support via `git stash -h`; git ≥ 2.35), call absorb again, and
     restore with `git stash pop --index` after the commit. If `--staged` is
     unsupported or the pop conflicts, stop and report.
   - On `staged`, commit: `git commit -m "chore(beads): record task audit log"`
     (single bare command, literal `-m`, per the user's commit conventions;
     never `--no-verify`). The rail never commits — that is yours.
   - `absorb --repo <repo> --verify` confirms `.beads/` is clean. Only now hand
     off. Never absorb mid-run — exactly once, at the end; if some bd command
     must run after the absorb, repeat it.
   (If the user had you fix inline via step 4's exception, follow
   /implement-ready's worker absorb step instead.)
