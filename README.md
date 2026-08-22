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

Published packages:

```bash
pi install npm:proper-base
pi install npm:proper-flow
```

`proper-flow` still expects the Beads resources from this repository:

```bash
./beads-flow/install.sh link
```

Local checkout:

```bash
npm --prefix proper-base install

pi install ./proper-base
pi install ./proper-llm-router
pi install ./proper-flow
```

Pi supplies proper-base's core peer packages. Its local `npm install` prepares
development tooling and seeds the optional pi-subagents worker default. Each
package README lists its remaining setup and runtime requirements.

## Release npm packages

`.release-me.json` opts this repository into package-aware releases. Run the
shared script from the repository root with the package name:

```bash
./tools/release-me/release.sh bump patch proper-base
./tools/release-me/release.sh bump minor proper-flow
./tools/release-me/release.sh bump --dry-run patch proper-base
./tools/release-me/release.sh latest proper-flow
```

The script updates the selected package version, validates its tarball, commits
the version, creates an annotated `<package>-vX.Y.Z` tag, and atomically pushes
`main` plus the tag. The tag starts `.github/workflows/publish-npm.yml`, which
verifies and packs without OIDC permissions, publishes the exact tarball through
npm trusted publishing, then creates a GitHub Release from the tag annotation.

Configure both npm packages with the same trusted publisher:

- GitHub repository: `sharaf-nassar/proper-pi-extensions`
- Workflow: `publish-npm.yml`
- Environment: `npm-release`
- Allowed action: npm publish

Protect the GitHub `npm-release` environment with a required reviewer and
restrict creation or deletion of `proper-base-v*` and `proper-flow-v*` tags to
maintainers. Main-branch rules must allow the release maintainer to bypass a
PR-only rule for the script's atomic version-commit plus tag push. After the
first trusted release succeeds, set each npm package to disallow token
publishing.

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
