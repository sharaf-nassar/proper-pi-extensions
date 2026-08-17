# proper-pi-extensions

## Task tracking

Beads (`bd`). Context loads via the SessionStart hook in
`.claude/settings.json` — run `bd prime` if it is missing or stale.

## Repository layout

Each extension lives in its own top-level directory with its source,
package manifest, tests, documentation, and extension-specific agent guidance.
Read that directory's `CLAUDE.md` before changing it.

## lat.md

- Before coding: `lat search "<task>"` to find relevant design intent.
- After changing behavior, architecture, or tests: update that extension's
  section under root `lat.md/`, then run `lat check` from the repository root.
- Syntax and section rules live in the `lat-md` skill, not here.

## Validation

Run each extension's checks from its directory. Pi loads installed local
packages directly from their registered directory paths.
