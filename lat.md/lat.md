# proper-pi-extensions

proper-pi-extensions is a repository of independently installable local pi extension packages.

## Repository layout

Each extension owns a top-level directory containing its package manifest, runtime source, tests, README, and agent guidance. Shared repository hooks, Beads state, and lat.md documentation remain at the repository root.

The root is not an installable pi package and has no npm workspace manifest. Package-local manifests keep dependency and validation choices independent until shared tooling is actually needed.

Current packages:

- [proper-llm-router](../proper-llm-router/) — routes each session's first task to an appropriate model.
- [proper-base](../proper-base/) — provides baseline history, prompt editing, cancellation, fullscreen navigation, image previews, and footer layout.
- [proper-flow](../proper-flow/) — packages triage, bug investigation, specification, and implementation workflow prompts.

<!-- lat-index
- [[proper-llm-router]] — repository index entry
- [[proper-base]] — repository index entry
- [[proper-flow]] — repository index entry
-->

## Installation model

Local pi installs point at an extension package directory rather than the repository root, allowing packages to be enabled and updated independently.

A package install replaces any legacy direct-file registration for the same extension. Keeping both entries can load the extension twice; keeping only the stale path can make pi fail during startup after a move.

## Runtime responsiveness

Runtime extension entrypoints must not synchronously wait on child processes because Pi's terminal rendering and tool execution share the Node event loop.

The repository regression test discovers every `pi.extensions` manifest entry, follows its relative runtime imports, and rejects Node's synchronous child-process APIs. Install scripts, smoke commands, and repository hooks are outside that runtime graph.

## Repository validation

Shared repository hooks run pinned format, lint, secret, package, test, type, documentation, and dependency checks before changes leave a checkout.

Git uses `.beads/hooks` through `core.hooksPath`. The Beads-managed `pre-commit` and `pre-push` shims chain into `.pre-commit-config.yaml`; commit checks run deterministic local validation, while push checks add coverage floors, the live router smoke, npm audits and signature verification, and OSV dependency scanning.

Biome enforces formatting, recommended lint rules, explicit-any rejection in runtime source, and focused or skipped test rejection. Both TypeScript packages enable strict diagnostics, unchecked-index checks, exact optional properties, unused checks, and no-emit compilation. Markdown, shell, JSON, YAML, TOML, spelling, file hygiene, package-lock consistency, package contents, and lat.md links are also checked.

`scripts/policy-guard.mjs` rejects staged edits to hook and validation policy, deleted tests, and new suppression directives unless a human deliberately sets `ALLOW_POLICY_CHANGES=1`. Package manifests are not guarded — `package.json` edits pass while `package-lock.json` stays protected — and lock consistency is separately enforced by the package-lock hook. The `prepare-commit-msg` shim runs the committed guard when possible so a staged guard cannot approve itself.

These local controls are friction, not a security boundary. A process with the developer's filesystem and Git permissions can replace hooks, change `core.hooksPath`, or bypass Git porcelain; authoritative enforcement requires a remote pre-receive policy or protected CI rules.
