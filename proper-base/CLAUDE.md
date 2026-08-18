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
clipboard markers and path overlays in `src/image-preview.ts`, history merging
in `src/history.ts`, submit interception in `src/recorder.ts`,
and the private append-only JSONL store in `src/store.ts`.

## Conventions

- Keep history scope tied to `ctx.cwd`.
- Recording failures must never break prompt submission.
- Preserve editor composition and repeated `session_start` re-entry.
- Keep autocomplete rows and prompt position stable. Render description
  overlays with the selected item's accent text. Offer slash-command and
  argument completion after whitespace anywhere in the prompt, replacing only
  the active slash segment. Strictly filter model names by every query term,
  sort every displayed result descending, and make Enter or Tab submit model
  arguments without changing other Tab behavior.
- Keep fullscreen Home, End, PageUp, and PageDown assigned to the editor; use
  their Ctrl+Shift variants for transcript navigation and preserve unrelated
  user keybindings. Bind Shift+Enter and Alt+Enter to prompt newlines, removing
  Alt+Enter from follow-up queueing. Home is two-stage from visible-row start
  to prompt start; End is two-stage from logical-line end to prompt end. Hot
  reload must replace stale keybinding apply callbacks.
- Decorate pi's built-in footer in place. Move cumulative usage through cost
  to the path row, keep context/model alignment on row two, and give path,
  branch, input, output, cache, cost, context, model, and effort stable subtle
  semantic colors. Reserve one right column, leave custom footers untouched,
  and animate only while `max` or `ultra` is visible.
- Bind Pi's clipboard paste action to both Ctrl+V and Ctrl+Shift+V. Replace
  readable clipboard image paths with `[image N]` markers, show source paths
  in a non-capturing text overlay, and expand markers before recording or Pi
  submission. Never enable Kitty rendering or change image capabilities.
- Restore and branch away a prompt only when Esc arrives before assistant
  processing; processed turns keep Pi's normal cancellation behavior.
- Abort the turn only for a questionnaire the user actually dismissed; let
  questionnaire failures reach the model.
- Keep pure history and storage logic covered by `node:test` fixtures.
