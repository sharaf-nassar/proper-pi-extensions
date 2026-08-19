# proper-pi-extensions

## Task tracking

Beads (`bd`). Context loads via the SessionStart hook in
`.claude/settings.json` — run `bd prime` if it is missing or stale.

## Repository layout

Each package lives in its own top-level directory with runtime source or
resources, a package manifest, validation, documentation, and package-specific
agent guidance. Read that directory's `CLAUDE.md` before changing it.

## lat.md

- Before coding on this project's architecture, design, protocols, or
  tests: `lat search "<task>"` to find the relevant design intent. Skip
  it for unrelated, general, or tooling questions.
- After changing behavior, architecture, or tests: update that package's
  section under root `lat.md/`, then run `lat check` from the repository root.
- Syntax and section rules live in the `lat-md` skill, not here.

## Validation

Run `pre-commit run --all-files` before finishing. Run
`pre-commit run --hook-stage pre-push --all-files` for the full networked gate.
Pi loads installed local packages directly from their registered paths.

Never set `ALLOW_POLICY_CHANGES=1`. Validation-policy changes require a human
to review the staged diff and apply that override outside the agent.
