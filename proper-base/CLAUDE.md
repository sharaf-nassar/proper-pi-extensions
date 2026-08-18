# proper-base

## Task tracking

Beads (`bd`) is managed from the repository root.

## lat.md

- Before coding: run `lat search "<task>"` from the repository root.
- After changing behavior, architecture, or tests: update
  `../lat.md/proper-base/`, then run `lat check` from the repository root.

## Build & test

Pi loads `index.ts` through this package's `pi` manifest. There is no build
step or test framework; package dependencies provide pi-tui wrapping utilities,
and dev dependencies provide pi and Node diagnostic types.

```bash
npm test
npx tsc
```

## Architecture

`index.ts` wires pi lifecycle, editor APIs, fullscreen keybinding overrides, and
the `ask_user_question` cancellation hook.
The non-capturing autocomplete detail overlay and renderer-switch compatibility
live in `src/autocomplete-details.ts`, two-stage End handling in
`src/editor-navigation.ts`, built-in footer styling in `src/footer-colors.ts`,
clipboard thumbnails in `src/image-preview.ts`, pure
history merging in `src/history.ts`, submit interception in `src/recorder.ts`,
and the private append-only JSONL store in `src/store.ts`.

## Conventions

- Keep history scope tied to `ctx.cwd`.
- Recording failures must never break prompt submission.
- Preserve editor composition and repeated `session_start` re-entry.
- Keep autocomplete rows and prompt position stable. Strictly filter model
  names by every query term, sort every displayed result descending, and make
  Enter or Tab submit model arguments without changing other Tab behavior.
- Keep fullscreen Home, End, PageUp, and PageDown assigned to the editor; use
  their Ctrl+Shift variants for transcript navigation and preserve unrelated
  user keybindings. End is two-stage: line boundary, then prompt boundary. Hot
  reload must replace stale keybinding apply callbacks.
- Decorate pi's built-in footer in place. Move cumulative usage through cost
  to the path row, keep context/model alignment on row two, leave custom
  footers untouched, and animate only while `max` or `ultra` is visible.
- Enable Scribe Kitty capability during extension factory loading, before the
  TUI starts. Render clipboard images in bounded non-capturing overlays, delete
  whole markers on one-character edits, and expand intact markers before Pi.
- Restore and branch away a prompt only when Esc arrives before assistant
  processing; processed turns keep Pi's normal cancellation behavior.
- Abort the turn only for a questionnaire the user actually dismissed; let
  questionnaire failures reach the model.
- Keep pure history and storage logic covered by `node:test` fixtures.
