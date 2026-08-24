---
description: Route work to /file, direct Beads creation, /refine, or /spec
argument-hint: <bug report, feature idea, task description, or issue reference>
---

Route this request to the right flow: $ARGUMENTS

You run every `bd` command yourself; the user never touches the Beads CLI.
Whenever this workflow needs input from the user, call the
`ask_user_question` tool instead of asking in plain text. Group related
questions into one call. Fall back to plain text only if the tool is unavailable
or fails before displaying its UI.

Classify the request, announce the route in ONE line ("Routing: <tier> —
<reason>"), then follow that flow. If genuinely borderline, ask one question
with labeled A/B options instead of guessing.

1. **Broken behavior** — an error, regression, crash, or observably wrong
   output → invoke `/file` with the request (root-cause investigation, then
   fix beads).
2. **Known concrete work** — you can write verifiable acceptance criteria
   yourself without needing a human decision (chore, small known task,
   mechanical change) → file the bead directly, no pipeline:
   - `bd create "<verb-first title, ≤60 chars>" --type=task -p <P0-P3> --description="Why: <goal>
What: <concrete work>
Files: <comma-separated repo-relative paths this will touch>" --acceptance="<verifiable conditions>"` — add
     `--parent=<epic>` if it clearly belongs to one, `--design="<1-3 line
     design note>"` when there is a real design decision to record, and
     `--type=chore` for maintenance.
   - Wire `bd dep add <dependent> <blocker>` only where order genuinely
     matters. Report the id(s), ready for /implement-ready.
   - Then absorb the beads audit log exactly as /file step 7 does (standalone
     chore-commit path, staged-index guard included). No learning disposition
     here — tier 2 is known work, not an investigation.
3. **Card refinement** — the request names one or more existing cards that need
   investigation/planning, or asks to refine all backlog/P4/ponytail-debt work →
   invoke `/refine` with the card selectors and any worker limit. Invoke it with
   no card selectors for the whole backlog. Never collapse unrelated cards into
   one `/spec` run.
4. **Fuzzy new scope** — a new feature or problem statement needs product
   answers and an implementation plan but has no source card → invoke `/spec`
   with the request (quick depth for plainly small features, full otherwise).

Tie-breakers:
- If you could not write the acceptance criteria without asking the user
  something material, it is tier 4 — regardless of how small it sounds.
- If you cannot name the `Files:` this touches without guessing, you have not
  looked at the code, and tier 2 is not available to you: open the files and
  confirm, or route to tier 1/3. This gate tests FACTS, not whether the human
  needs consulting — crisp acceptance criteria can be written for a function
  that does not exist.
- A "bug" whose fix requires a design decision is tier 4, not tier 1 — say
  so in the routing line.
- An existing issue id routes by its content: bug-shaped → tier 1 context;
  anything needing further investigation or planning → tier 3. Tier 4 starts
  from new scope rather than an existing source card.
