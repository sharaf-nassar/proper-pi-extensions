# proper-customs

## Task tracking

Beads (`bd`) is managed from the repository root.

## lat.md

- Before coding: run `lat search "<task>"` from the repository root.
- After changing behavior, architecture, or tests: update
  `../lat.md/proper-customs/`, then run `lat check` from the repository root.

## Build & test

Pi loads `index.ts` through this package's `pi` manifest. There is no build
step or test framework; package dependencies provide pi-tui wrapping utilities,
and dev dependencies provide pi and Node diagnostic types.

```bash
npm test
npx tsc
```

## Architecture

`index.ts` wires pi lifecycle, editor APIs, and fullscreen keybinding overrides.
The non-capturing autocomplete detail overlay and renderer-switch compatibility
live in `src/autocomplete-details.ts`, built-in footer styling in
`src/footer-colors.ts`, pure history merging in `src/history.ts`, submit
interception in `src/recorder.ts`, and the private append-only JSONL store in
`src/store.ts`.

## Conventions

- Keep history scope tied to `ctx.cwd`.
- Recording failures must never break prompt submission.
- Preserve editor composition and repeated `session_start` re-entry.
- Keep autocomplete rows and prompt position stable; render selected
  descriptions in a boxed overlay above the prompt, remove inactive overlay
  entries so TUI mode switching stays available, and leave unrelated modal
  selectors untouched.
- Keep fullscreen Home, End, PageUp, and PageDown assigned to the editor; use
  their Shift variants for transcript navigation and preserve unrelated user
  keybindings.
- Decorate pi's built-in footer in place. Preserve its text and layout, leave
  custom footers untouched, and animate only while `max` or `ultra` is visible.
- Keep pure history and storage logic covered by `node:test` fixtures.
