# proper-pi-extensions

A collection of local [pi](https://github.com/badlogic/pi-mono) packages.

## Packages

| Extension | Purpose |
| --- | --- |
| [proper-llm-router](./proper-llm-router/) | Routes each session's first task to an appropriate model. |
| [proper-base](./proper-base/) | Provides baseline history, prompt editing, cancellation, fullscreen navigation, image previews, and footer layout. |
| [proper-flow](./proper-flow/) | Packages the triage, bug filing, specification, and implementation workflow prompts. |

Each package is self-contained in its own top-level directory. Install one
from this checkout with its directory path:

```bash
pi install ./proper-llm-router
pi install ./proper-base
pi install ./proper-flow
```

## Validation

The repository uses pinned [pre-commit](https://pre-commit.com/) hooks through
`.beads/hooks`. Initialize a fresh checkout once:

```bash
git config core.hooksPath .beads/hooks
pre-commit install-hooks
```

Run either gate directly with:

```bash
pre-commit run --all-files
pre-commit run --hook-stage pre-push --all-files
```

Commit checks cover formatting, lint, secrets, spelling, Markdown, shell,
package tests, strict TypeScript, package locks, package contents, and lat.md
validation. Push checks add coverage floors, OSV, npm audit/signature checks, and
the live router smoke.

Validation policy changes, test deletion, and new suppression directives are
blocked by default. After human review, use `ALLOW_POLICY_CHANGES=1` for an
intentional policy update. Local hooks can still be bypassed by a process with
the same Git and filesystem permissions; use protected remote checks for an
authoritative boundary.
