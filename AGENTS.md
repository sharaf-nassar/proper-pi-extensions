# proper-pi-extensions — repo guide for agents

Independently installable local Pi packages: `proper-base/` (TS extension),
`proper-llm-router/` (TS routing extension + exemplar corpus),
`proper-flow/` (prompt-only package), `beads-flow/` (Beads formulas +
implementation rail). Root is NOT an npm package/workspace — use
`npm --prefix <pkg>` or cd into each package.

## Ground rules

- Task tracking is Beads: `bd ready`, `bd show <id>`, `bd close <id>`;
  `bd prime` when stale.
- Architecture/protocol/operations per package in `lat.md/`; search before
  coding, update after changes; `lat check` runs inside both gates below.
- Validation-policy edits, test deletions, and suppression directives are
  guarded: they fail pre-commit unless a HUMAN reviews and applies
  `ALLOW_POLICY_CHANGES=1`. Never set it yourself.
- Pre-commit/pre-push remain the development gates. GitHub Actions runs only
  the protected npm trusted-publishing release path.

## Build, test, gates

Fresh checkout setup (repo root):

```bash
npm --prefix proper-base install
npm --prefix proper-llm-router install
git config core.hooksPath .beads/hooks
pre-commit install-hooks
```

Gates (repo root):

```bash
pre-commit run --all-files                      # commit/fast gate
pre-commit run --hook-stage pre-push --all-files  # full gate
```

Fast = biome-ci, gitleaks, typos, markdownlint, shellcheck, policy guard,
then `node scripts/check-repo.mjs fast` (node --test suites in every
package, tsc typechecks, npm pack dry-runs, exemplars JSON parse,
`lat check`). Full swaps in coverage-thresholded tests and adds
`npm audit`, `npm audit signatures`, osv-scanner, and the router live
smoke. No build step exists anywhere.

Package releases use `.release-me.json` and package-scoped tags. Run
`./tools/release-me/release.sh bump <part> <package>` from the repo root. The
GitHub release workflow verifies and packs without OIDC, then publishes the
exact artifact from a protected `npm-release` environment.

- Router live smoke (`npm run test:smoke` in proper-llm-router/) needs a
  reachable judge/CPA at `http://127.0.0.1:8317` and
  `ANTHROPIC_AUTH_TOKEN`; unit tests and typechecks are offline.

## Gotchas

- Install into Pi with `pi install ./<package>`; stale direct-file
  registrations can double-load an extension.
- `beads-flow/install.sh link` symlinks into THIS checkout — moving the
  repo breaks `~/.beads/` links. Rail state:
  `${XDG_STATE_HOME:-~/.local/state}/bd-orchestrate`; prompt history:
  `~/.pi/agent/proper-history/`; router config:
  `~/.pi/agent/llm-router.json`.
- Router models.json needs an `llm-router/auto` placeholder; its port-1
  URL is an intentional dead placeholder, not a service.
- Toolchain: Node 22.19+, Pi 0.84.2 compatibility, TypeScript 6.
