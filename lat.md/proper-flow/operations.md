# Runtime operations

proper-flow is installed as a local Pi package and exposes prompt templates without executing extension code.

## Package identity and installation

The repository directory is `proper-flow`; the manifest package name is `pi-proper-flow`.

Install the checkout with `pi install /path/to/proper-pi-extensions/proper-flow`. The manifest registers `./prompts`, and Pi derives `/triage`, `/file`, `/spec`, and `/implement-ready` from the four Markdown filenames.

## Source migration

The package directory is the source of truth for all four workflow prompts.

After registration, same-named files are removed from `~/.pi/agent/prompts/` so Pi does not discover duplicate command sources. `/constitution` remains in the global prompt directory because repository governance is separate from the triage-to-implementation flow.

## Runtime assumptions

Prompt execution depends on user-level workflow tools rather than npm dependencies.

The commands expect `bd`, formulas under `~/.beads/formulas/`, and the implementation rail at `~/.beads/rail/implement-ready.sh`. `/implement-ready` can use pi-subagents, while proper-llm-router independently supplies command pins and worker model routing.

## Validation

Run the package check from `proper-flow/`.

```bash
npm test
```

After installation, `pi list` must resolve the local proper-flow path. Reload Pi after prompt edits so command discovery refreshes.
