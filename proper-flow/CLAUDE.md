# proper-flow

## Task tracking

Beads (`bd`) is managed from the repository root.

## lat.md

- Before changing prompts: run `lat search "<task>"` from the repository root.
- After changing prompt behavior, package structure, or tests: update
  `../lat.md/proper-flow/`, then run `lat check` from the repository root.

## Validation

```bash
npm test
```

## Architecture

This is a prompt-only Pi package. `package.json` registers `prompts/`; there is
no runtime extension entrypoint or dependency tree.

## Conventions

- Keep command filenames stable: `triage.md`, `file.md`, `spec.md`, and
  `implement-ready.md` define their slash-command names.
- Preserve `description` and `argument-hint` frontmatter for autocomplete.
- Keep routing responsibilities separate: triage chooses a flow, file
  investigates bugs, spec refines scope, and implement-ready executes one task,
  an epic frontier, or the whole board.
- `spec.md` is twin-maintained with the Claude command and Codex skill named in
  that prompt; mirror substantive workflow changes across all copies.
- Shared Beads formulas and the implementation rail remain external user tools,
  not files copied into this package.
