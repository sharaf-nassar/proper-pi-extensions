# proper-flow

Workflow prompt templates for [pi](https://pi.dev) and [Beads](https://github.com/steveyegge/beads).

## Prompts

| Command | Purpose |
| --- | --- |
| `/triage` | Route a request to direct filing, bug investigation, or specification. |
| `/file` | Reproduce a bug, identify its root cause, and file implementation-ready beads. |
| `/spec` | Run the global `speckit` formula from an idea, epic, or backlog issue. |
| `/implement-ready` | Implement one task, an epic's ready frontier, or all ready beads through the shared rail. |

`/constitution` remains a separate global governance prompt and is not part of this package.

## Install

From this repository checkout:

```bash
pi install /path/to/proper-pi-extensions/proper-flow
```

The package uses Pi's `prompts/` resource type only; it installs no runtime extension code or dependencies. Remove same-named files from `~/.pi/agent/prompts/` to avoid duplicate command sources.

## Runtime assumptions

The prompts expect the Beads CLI (`bd`) and the resources installed by [`beads-flow`](../beads-flow/): shared formulas under `~/.beads/formulas/` and the rail at `~/.beads/rail/implement-ready.sh`. Hook-free worktrees point `core.hooksPath` at the empty `~/.beads/no-hooks/` directory. `/implement-ready` uses pi-subagents when available, while model routing remains owned by proper-llm-router.

## Development

```bash
npm test
```

The test verifies the package manifest exposes exactly the four workflow prompts and that each prompt keeps Pi autocomplete metadata.

## License

MIT
