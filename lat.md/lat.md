# proper-pi-extensions

proper-pi-extensions is a repository of independently installable local pi extension packages.

## Repository layout

Each extension owns a top-level directory containing its package manifest, runtime source, tests, README, and agent guidance. Shared repository hooks, Beads state, and lat.md documentation remain at the repository root.

The root is not an installable pi package and has no npm workspace manifest. Package-local manifests keep dependency and validation choices independent until shared tooling is actually needed.

Current packages:

- [proper-llm-router](../proper-llm-router/) — routes each session's first task to an appropriate model.
- [proper-customs](../proper-customs/) — hosts cross-session history, autocomplete details, fullscreen scrolling compatibility, and footer styling.
- [proper-flow](../proper-flow/) — packages triage, bug investigation, specification, and implementation workflow prompts.

<!-- lat-index
- [[proper-llm-router]] — repository index entry
- [[proper-customs]] — repository index entry
- [[proper-flow]] — repository index entry
-->

## Installation model

Local pi installs point at an extension package directory rather than the repository root, allowing packages to be enabled and updated independently.

A package install replaces any legacy direct-file registration for the same extension. Keeping both entries can load the extension twice; keeping only the stale path can make pi fail during startup after a move.
