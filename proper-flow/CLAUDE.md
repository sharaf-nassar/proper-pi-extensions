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
bash test.sh
```

## Architecture

Pi loads only `prompts/` (registered in `package.json`); there is no runtime
extension entrypoint or dependency tree. The package also owns the Beads
resources the prompts drive: `formulas/` (constitution, speckit), the
`rail/implement-ready.sh` safety rail, and `install.sh`, which links them into
`~/.beads/` as symlinks to this checkout.

## Conventions

- Keep command filenames stable: `triage.md`, `file.md`, `spec.md`,
  `backlog.md`, and `implement-ready.md` define their slash-command names.
- Preserve `description` and `argument-hint` frontmatter for autocomplete.
- Keep routing responsibilities separate: triage chooses a flow, file
  investigates bugs, spec refines scope, backlog drains P4 work into
  implement-ready clusters, and implement-ready executes one task, an epic
  frontier, or the whole board.
- The rail never launches agents and never commits; agent orchestration and
  judgement stay in the prompts.
- Formulas and the rail deploy only through `install.sh` symlinks; runtime
  Beads state (databases, locks, audit logs, `no-hooks`) never enters the
  package.
