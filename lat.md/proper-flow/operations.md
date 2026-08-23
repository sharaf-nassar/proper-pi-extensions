# Runtime operations

proper-flow is installed as a local Pi package and exposes prompt templates without executing extension code.

## Package identity and installation

The repository directory and public npm package are both named `proper-flow`.

Install the published package with `pi install npm:proper-flow`, or install the checkout with `pi install /path/to/proper-pi-extensions/proper-flow`. The manifest registers `./prompts`, and Pi derives `/triage`, `/file`, `/spec`, `/backlog`, and `/implement-ready` from the five Markdown filenames.

The npm manifest uses the `pi-package` discovery keyword, limits the tarball to prompts, formulas, the rail, the installer, and user documentation, points repository metadata at the `proper-flow` monorepo directory, and publishes only to the public npm registry. Its `prepack` script runs the package contract test before tarball creation or publication.

Releases run from the repository root with `./tools/release-me/release.sh bump <major|minor|patch> proper-flow`. The script commits the manifest version and creates `proper-flow-vMAJOR.MINOR.PATCH`; [[lat#Package releases]] verifies and publishes that exact tarball through npm trusted publishing.

## Source migration

The package directory is the source of truth for all five workflow prompts.

After registration, same-named files are removed from `~/.pi/agent/prompts/` so Pi does not discover duplicate command sources. `/constitution` remains in the global prompt directory because repository governance is separate from the triage-to-implementation flow.

## Link installation

`proper-flow/install.sh link` creates the user formula and rail directories, then links each managed runtime file individually into `~/.beads/`.

A matching regular file may be replaced with its repository link during migration. A different regular file is preserved and stops installation. Existing symlinks may be redirected to the current checkout.

## Drift check

`proper-flow/install.sh check` verifies every managed link, rail executability, and the `no-hooks` invariant.

The check runs `bd formula show` from outside a Beads project and requires each formula's reported source to be its user-level link. This catches missing links and higher-priority accidental sources during installation validation.

## Formula precedence

Beads searches active-project and checkout-local formula directories before `~/.beads/formulas/`.

A repository may intentionally shadow a user formula with `.beads/formulas/<name>.formula.toml`. The package check isolates formula resolution from project-local registries so it verifies the global installation itself.

## User-directory ownership

The installer leaves machine-specific Beads state unmanaged.

`~/.beads/no-hooks` remains a real empty directory because Git worktrees point `core.hooksPath` there. Shared-server data and any future Beads-managed files can coexist beside the linked formulas and rail without entering this repository.

## Runtime assumptions

Prompt execution depends on user-level workflow tools rather than npm dependencies.

The commands expect `bd`, formulas under `~/.beads/formulas/`, and the implementation rail at `~/.beads/rail/implement-ready.sh` — the package's own resources after `install.sh link`. Hook-free worktrees use the empty `~/.beads/no-hooks/` directory. `/backlog` and `/implement-ready` can use pi-subagents, while proper-llm-router supplies command pins and worker model routing.

`/spec` passes resolved epic and direct-source identifiers into Speckit without precomputing a backlog snapshot; the formula owns the live hierarchy-plus-provenance closure and refreshes it before materialization.

`/backlog` acquires one atomic lock in the common Git directory, snapshots open and deferred P4 ids, and runs read-only reconnaissance. It combines duplicate or same-epic outcomes, serializes cross-epic conflicts, and instantiates one quick Speckit wisp per independent cluster.

Speckit's live closure may add a P4 after the baseline. The parent must adopt that id into the owning cluster before mutation; unrelated later P4s remain outside the run. Quick depth keeps refinement Beads-only, so cluster workers need no Git worktrees or integration commits.

`/implement-ready` accepts an epic id, a task id or unique title, or `all`. Task titles resolve through Beads search. Single-task mode initializes the descendant-oriented rail with `all`, then filters every survey, dispatch, and report to the resolved task id.

The command defaults to a rolling pool of 12 workers and never exceeds 12. Refill batches launch async pi-subagents children, while the parent waits for individual completions, integrates terminal work through the rail, surveys newly unblocked tasks, and fills open slots without draining active siblings.

## Validation

Run the package and release checks from `proper-flow/` with Node 22.19 or newer.

```bash
npm test
npm pack --dry-run
npm publish --dry-run
```

After installation, `pi list` must resolve `npm:proper-flow` or the selected local checkout. Reload Pi after prompt edits so command discovery refreshes.
