# proper-pi-extensions

proper-pi-extensions is a repository of independently installable Pi packages and workflow support bundles distributed through npm or local checkouts.

## Repository layout

Each extension owns a top-level directory containing its package manifest, runtime source, tests, README, and agent guidance. Shared repository hooks, Beads state, and lat.md documentation remain at the repository root.

The root is not an installable pi package and has no npm workspace manifest. Package-local manifests keep dependency and validation choices independent until shared tooling is actually needed.

Current packages:

- [proper-llm-router](../proper-llm-router/) — npm package `proper-llm-router`, routing each session's first task to an appropriate model.
- [proper-base](../proper-base/) — npm package `proper-base`, providing baseline history, prompt editing, cancellation, fullscreen navigation, image previews, and footer layout.
- [proper-flow](../proper-flow/) — npm package `proper-flow`, containing triage, bug investigation, specification, and implementation workflow prompts.

## Support bundles

Repository-owned support bundles remain separate from Pi package discovery.

- [beads-flow](../beads-flow/) — versions and installs the Beads formulas and implementation rail used by proper-flow.

<!-- lat-index
- [[proper-llm-router]] — repository index entry
- [[proper-base]] — repository index entry
- [[proper-flow]] — repository index entry
- [[beads-flow]] — Beads workflow support
-->

## Installation model

Published installs use npm package names; local installs point at package directories. The repository root is not installable, and each package remains independently enabled and updated.

The npm manifests use the `pi-package` keyword, explicit `pi.extensions` or `pi.prompts` resources, public-registry publish settings, package file allowlists, and monorepo repository metadata. A `prepack` gate validates each package before npm creates a tarball.

A package install replaces any legacy direct-file registration for the same extension. Keeping both entries can load the extension twice; keeping only the stale path can make Pi fail during startup after a move.

## Complete user setup

[PI_SETUP.md](../PI_SETUP.md) is the agent-facing runbook for reproducing the repository maintainer's public Pi environment without copying machine secrets or private integrations.

The runbook installs the repository packages and Beads support, the verified public npm extension set, `lat.md`, Beads, UI/UX Pro Max, Unslop, and Ponytail. Package installs remain unpinned so Pi can update them; the documented list records sources and user-facing purpose.

Settings changes are merge-only and limited to fullscreen TUI, skill commands, and the safe default for subagent worker context. Provider, trust, telemetry, proxy, image model, and credential choices remain user decisions.

CLIProxyAPI and llm-router setup uses a non-serving `llm-router/auto` placeholder plus user-entered provider credentials. The runbook never writes real keys. It explicitly excludes Quill, Scribe, the superseded Ctrl+C extension, and the local lat extension fork.

Verification covers Pi package registration, Beads links, lat validation, skill discovery, router/provider health, image configuration, MCP, FFF, context view, Ponytail, and proper-flow prompt discovery.

## Runtime responsiveness

Runtime extension entrypoints must not synchronously wait on child processes because Pi's terminal rendering and tool execution share the Node event loop.

The repository regression test discovers every `pi.extensions` manifest entry, follows its relative runtime imports, and rejects Node's synchronous child-process APIs. Install scripts, smoke commands, and repository hooks are outside that runtime graph.

## Package releases

Package releases use package-scoped tags and npm trusted publishing without stored registry tokens.

`.release-me.json` selects npm mode, requires releases from `main`, and maps `proper-base`, `proper-llm-router`, and `proper-flow` to their tracked manifests. The shared `tools/release-me/release.sh` requires a package argument only in this mode, derives the version from that manifest, and scopes release notes to the package directory.

A package bump updates only its `package.json`, validates `npm pack`, creates a conventional release commit and annotated `<package>-vMAJOR.MINOR.PATCH` tag, then atomically pushes `main` and the tag. Dry runs change no files or refs. Retagging is disabled because npm versions are immutable.

`.github/workflows/publish-npm.yml` accepts only the three configured package tag prefixes and then applies a strict package/version regex. Its verify job checks that the annotated tag targets a commit on the default branch, matches the config and manifest, runs package `prepack`, and uploads one integrity-described tarball without OIDC permissions.

The protected publish job downloads and verifies that exact artifact, holds only read plus `id-token: write` permissions, and publishes through npm's GitHub Actions trusted publisher. A separate `contents: write` job creates an idempotent GitHub Release from the tag annotation. Action dependencies are pinned to full commit SHAs.

All three npm packages must trust the `publish-npm.yml` workflow in `sharaf-nassar/proper-pi-extensions` with environment `npm-release`. A brand-new package receives one maintainer-authenticated initial publish because npm cannot configure trust before the package exists; later releases use the protected trusted path. The GitHub environment and package tag rules supply the human approval and maintainer-only tag boundary; the release maintainer also needs ruleset bypass for the atomic `main` version-commit push. npm token publishing is disabled after the trusted path is proven.

## Repository validation

Shared repository hooks run pinned format, lint, secret, package, test, type, documentation, and dependency checks before changes leave a checkout.

Git uses `.beads/hooks` through `core.hooksPath`. The Beads-managed `pre-commit` and `pre-push` shims chain into `.pre-commit-config.yaml`; commit checks run deterministic local validation, while push checks select coverage runs instead of repeating unit suites, then add the live router smoke, npm audits and signature verification, and OSV dependency scanning.

Biome enforces formatting, recommended lint rules, JSON syntax and duplicate-key checks, explicit-any rejection in runtime source, and focused or skipped test rejection. Both TypeScript packages enable strict diagnostics, unchecked-index checks, exact optional properties, unused checks, and no-emit compilation. Markdown, shell, YAML, TOML, spelling, file hygiene, package-lock consistency, package contents, and lat.md links are also checked.

`scripts/policy-guard.mjs` rejects staged edits to hook, validation, and npm release policy, deleted tests, and new suppression directives unless a human deliberately sets `ALLOW_POLICY_CHANGES=1`. Package manifests are not guarded — `package.json` edits pass while package locks, `.release-me.json`, and GitHub workflow files stay protected — and lock consistency is separately enforced by the package-lock hook. The `prepare-commit-msg` shim runs the committed guard when possible so a staged guard cannot approve itself.

These local controls are friction, not a security boundary. A process with the developer's filesystem and Git permissions can replace hooks, change `core.hooksPath`, or bypass Git porcelain. Protected package-tag rules, the reviewed `npm-release` environment, and npm's exact trusted-publisher binding are the remote publication boundary.
