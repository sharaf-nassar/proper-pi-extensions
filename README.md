# proper-pi-extensions

Local [Pi](https://pi.dev) packages and Beads workflow support. The repository
root is not a Pi package or npm workspace; install only the package directories
you use.

## Packages and bundles

| Folder | Type | User-facing behavior |
| --- | --- | --- |
| [proper-base](./proper-base/README.md) | Pi extension | Improves transcripts, session titles, `/clear`, prompt history and search, editor keys, autocomplete, fullscreen navigation, image handling, cancellation, and footer layout. |
| [proper-llm-router](./proper-llm-router/README.md) | Pi extension | Routes each session's first task to one of seven model tiers, then handles command pins, per-task overrides, quota swaps, fallbacks, and `ultra` thinking support. |
| [proper-flow](./proper-flow/README.md) | Pi prompt package | Adds `/triage`, `/file`, `/spec`, and `/implement-ready` for filing, specifying, and implementing Beads work. |
| [beads-flow](./beads-flow/README.md) | Beads support bundle | Installs the `constitution` and `speckit` formulas plus the worktree, retry, integration, and audit rail used by `proper-flow`. |

`proper-base` and `proper-llm-router` work independently. `proper-flow` expects
`beads-flow`; it can also use pi-subagents for parallel workers and
`proper-llm-router` for per-task model selection. With both runtime extensions
installed, proper-base's `/clear` keeps the outgoing model instead of re-arming
the router. The tested Pi compatibility target is 0.84.2; dependency-backed
local setup requires Node 22.19 or newer.

## Install

From this checkout:

```bash
npm --prefix proper-base install

pi install ./proper-base
pi install ./proper-llm-router
pi install ./proper-flow

./beads-flow/install.sh link
```

The `proper-base` install prepares its runtime dependency and seeds its optional
pi-subagents worker default. Each package README lists its remaining setup and
runtime requirements.

## Repository internals

| Folder | Purpose |
| --- | --- |
| [`lat.md/`](./lat.md/) | Architecture, protocol, and verification documentation. |
| [`.beads/`](./.beads/) | Repository task state and Git hook shims. This is separate from the user-facing `beads-flow/` bundle. |
| [`scripts/`](./scripts/) | Shared repository validation and policy checks. |
| [`test/`](./test/) | Cross-package regression tests. |

## Validate the checkout

Initialize a fresh checkout once:

```bash
npm --prefix proper-base install
npm --prefix proper-llm-router install

git config core.hooksPath .beads/hooks
pre-commit install-hooks
```

Run either gate directly:

```bash
pre-commit run --all-files
pre-commit run --hook-stage pre-push --all-files
```

The commit gate runs formatting, lint, secrets, spelling, Markdown, shell,
package tests, strict TypeScript, package checks, and lat.md validation. The
push gate adds coverage, audits, OSV, signatures, and the live router smoke.
That smoke needs configured judge and CPA services plus credentials.

Validation policy changes require human review and a human-applied
`ALLOW_POLICY_CHANGES=1`. Local hooks are guardrails, not a security boundary.
