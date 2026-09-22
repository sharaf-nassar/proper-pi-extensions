# proper-pi-extensions

Local [Pi](https://pi.dev) packages and Beads workflow support. The repository
root is not a Pi package or npm workspace; install only the package directories
you use.

Agents configuring a complete user environment should follow
[Complete Pi setup](./PI_SETUP.md). It always installs `proper-base`, then lets
the user pick from the verified public extension set, UI/UX Pro Max, Unslop, and
Ponytail, without copying local credentials or private integrations.

## Packages and bundles

| Folder | Type | User-facing behavior |
| --- | --- | --- |
| [proper-base](./proper-base/README.md) | Pi extension | Improves transcripts, session titles, `/clear`, prompt history and search, editor keys, autocomplete, fullscreen navigation, image handling, cancellation, and footer layout. |
| [proper-llm-router](./proper-llm-router/README.md) | Pi extension | Routes each session's first task to one of seven model tiers, then handles command pins, per-task overrides, quota swaps, fallbacks, and `ultra` thinking support. |
| [proper-pacify](./proper-pacify/README.md) | Pi extension | Adds `/pacify`, `/pacify-session`, and `/pacify-config` for tone-only prompt rewriting, automatic prompt interception, and before/after session entries. |
| [proper-compact](./proper-compact/README.md) | Pi extension | Adds evidence-preserving compaction, bounded multi-call summaries, and branch-scoped transcript recall. Requires Pi 0.87.0; local checkout only until first publication. |
| [proper-flow](./proper-flow/README.md) | Pi prompt package | Adds `/triage`, `/file`, `/spec`, `/refine`, and `/implement-ready` for filing, planning, refining, and implementing Beads work, and ships the `constitution` and `speckit` formulas plus the worktree, retry, integration, and audit rail behind them. |

`proper-base` and `proper-llm-router` work independently. `proper-flow`
can also use pi-subagents for parallel workers and
`proper-llm-router` for per-task model selection. With both runtime extensions
installed, proper-base's `/clear` keeps the outgoing model instead of re-arming
the router. The Pi compatibility target is 0.87.1; dependency-backed
local setup requires Node 22.19 or newer.

## Install

Published packages:

```bash
pi install npm:proper-base
pi install npm:proper-llm-router
pi install npm:proper-pacify
pi install npm:proper-flow
```

`proper-flow` also links its Beads resources (formulas and rail) into
`~/.beads/`:

```bash
./proper-flow/install.sh link
```

Local checkout:

```bash
pi install ./proper-base
pi install ./proper-llm-router
pi install ./proper-pacify
pi install ./proper-compact
pi install ./proper-flow
```

`proper-base` includes [automatic updates](./proper-base/UPDATES.md): native
notices trigger installation on the next supported launch. Disable them with
**Automatic updates** in `/settings`. No separate updater package is needed.

Install order does not matter for `proper-pacify`; it pacifies prompts above
Pi's extension handler chain.

Pi supplies the extensions' core peer packages. proper-base also depends on
`sharp` for image previews; its local checkout needs `npm install`. For the
other packages, that command only prepares the development gates below. Each package README lists its remaining setup
and runtime requirements.

## Release npm packages

`.release-me.json` opts this repository into package-aware releases. Run the
shared script from the repository root with the package name:

```bash
./tools/release-me/release.sh bump patch proper-base
./tools/release-me/release.sh bump patch proper-llm-router
./tools/release-me/release.sh bump minor proper-pacify
./tools/release-me/release.sh bump minor proper-flow
./tools/release-me/release.sh bump --dry-run patch proper-base
./tools/release-me/release.sh latest proper-flow
```

The script updates the selected package version, validates its tarball, commits
the version, creates an annotated `<package>-vX.Y.Z` tag, and atomically pushes
`main` plus the tag. The tag starts `.github/workflows/publish-npm.yml`, which
verifies and packs without OIDC permissions, publishes the exact tarball through
npm trusted publishing, then creates a GitHub Release from the tag annotation.
A brand-new package needs one maintainer-authenticated initial publish before
npm allows trusted-publisher configuration; later versions use only this flow.
`proper-pacify` has its initial publish but still needs trusted-publisher
registration.

`proper-compact` is not published yet. Before its first release, a maintainer
must bootstrap npm publication and add its tag prefix to the protected release
environment and tag policies. Development does not perform those actions.

Configure all five packages with the same trusted publisher:

- GitHub repository: `sharaf-nassar/proper-pi-extensions`
- Workflow: `publish-npm.yml`
- Environment: `npm-release`
- Allowed action: npm publish

Keep the GitHub `npm-release` environment free of required reviewers and wait
timers so releases stay automatic. Restrict its deployment policies to
`proper-base-v*`, `proper-compact-v*`, `proper-llm-router-v*`,
`proper-pacify-v*`, and `proper-flow-v*` tags. Restrict tag creation or deletion
to maintainers. Main-branch rules must allow the
release maintainer to bypass a PR-only rule for the script's atomic
version-commit plus tag push. After the first trusted release succeeds, set each
npm package to disallow token publishing.

## Repository internals

| Folder | Purpose |
| --- | --- |
| [`lat.md/`](./lat.md/) | Architecture, protocol, and verification documentation. |
| [`.beads/`](./.beads/) | Repository task state and Git hook shims. This is separate from the user-facing resources `proper-flow/install.sh` links into `~/.beads/`. |
| [`scripts/`](./scripts/) | Shared repository validation checks. |
| [`test/`](./test/) | Cross-package regression tests. |

## Validate the checkout

Initialize a fresh checkout once:

```bash
npm --prefix proper-base install
npm --prefix proper-llm-router install
npm --prefix proper-pacify install
npm --prefix proper-compact install

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
push gate runs only audits, OSV, signatures, and the offline router smoke;
it does not repeat the commit checks.

Local hooks are guardrails, not a security boundary.
