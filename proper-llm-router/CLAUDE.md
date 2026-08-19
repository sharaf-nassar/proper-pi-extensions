# proper-llm-router

## Task tracking

Beads (`bd`). Context loads via the SessionStart hook in
`.claude/settings.json` — run `bd prime` if it is missing or stale.

## lat.md

- Before coding on this project's architecture, design, protocols, or
  tests: `lat search "<task>"` to find the relevant design intent. Skip
  it for unrelated, general, or tooling questions.
- After changing behavior, architecture, or tests: update
  `../lat.md/proper-llm-router/`, then run `lat check` from the repository root.
- Syntax and section rules live in the `lat-md` skill, not here.

## Build & Test

No build step — pi loads `llm-router.ts` through this package's `pi`
manifest. Run strict type diagnostics, offline fixtures, and the live smoke:

```bash
npm run typecheck
npm run test:unit
npm run test:smoke -- ["task text"]
```

## Architecture Overview

Single-file pi extension (`llm-router.ts`): a judge LLM routes each
session's first prompt to one of 7 model arms via CPA/CLIProxyAPI, with
post-verdict quota swaps and an interactive `/llm-router-config` menu.
`exemplars.jsonl` provides measured-outcome few-shot for the judge.
See README.md for the full design.

## Conventions & Patterns

- User-facing config lives in `~/.pi/agent/llm-router.json`, re-read per
  routed prompt — never require a pi restart for a config change.
- Pure logic (swap resolution, quota aggregation, judge overrides) stays
  exported and covered by fixtures. Upstream usage 429 responses count as
  exhausted accounts; unknown probe failures degrade to ungated routing with a
  visible notice, never a blocked session.
