# proper-base

## Task tracking

Beads (`bd`) is managed from the repository root.

## lat.md

- Before coding: run `lat search "<task>"` from the repository root.
- After changing behavior, architecture, or tests: update
  `../lat.md/proper-base/`, then run `lat check` from the repository root.

## Build & test

Pi loads `index.ts` through this package's `pi` manifest. There is no build
step or test framework. Pi supplies coding-agent and pi-tui as core peer
packages; dev dependencies pin both APIs plus TypeScript and Node diagnostics.

```bash
npm test
npm run typecheck
npm run test:coverage
```

## Architecture

`index.ts` wires pi lifecycle, first-response session naming, editor APIs,
fullscreen keybinding overrides, and the `ask_user_question` cancellation hook.
The non-capturing autocomplete detail overlay and renderer-switch compatibility
live in `src/autocomplete-details.ts`, history and Home/End cursor handling in
`src/editor-navigation.ts`, built-in footer styling in `src/footer-colors.ts`,
clipboard markers and path overlays in `src/image-preview.ts`,
the scrolled-up jump-to-bottom button in `src/jump-to-bottom.ts`, history
filtering in `src/history-guard.ts`, ordering in `src/history.ts`, submit
interception in `src/recorder.ts`, and the private append-only JSONL store in
`src/store.ts`.
`install.mjs` is the npm `postinstall` hook and is not loaded by the extension.

## Conventions

- Name only fresh unnamed sessions. Ask the first successful response for a
  concise `<session_title>` marker, hide it from rendering, strip terminal
  control characters, and let explicit or established session names win.
- Keep history scope tied to `ctx.cwd`. Only the editor submit recorder and its
  raw-input store may populate history; never derive it from Pi session messages
  or accept Pi's replay of expanded skill and prompt-template bodies.
- Recording failures must never break prompt submission.
- Preserve editor composition and repeated `session_start` re-entry.
- Keep autocomplete rows and prompt position stable. Render description
  overlays with the selected item's accent text. Offer slash-command and
  argument completion after whitespace anywhere in the prompt, replacing only
  the active slash segment. Strictly filter model names by every query term,
  sort every displayed result descending, and make Enter or Tab submit model
  arguments without changing other Tab behavior.
- Render the jump-to-bottom button as an editor row, never an overlay: a
  visible overlay disables Pi's scrollbar dragging. Install it only for a
  viewport renderer, and consume only mouse events on the button's own cells.
- Keep fullscreen Home, End, PageUp, and PageDown assigned to the editor; use
  their Ctrl+Shift variants for transcript navigation and preserve unrelated
  user keybindings. Bind Shift+Enter and Alt+Enter to prompt newlines, removing
  Alt+Enter from follow-up queueing. Up places recalled history at prompt start.
  Home is two-stage from visible-row start to prompt start; End is two-stage
  from logical-line end to prompt end. Hot
  reload must replace stale keybinding apply callbacks.
- Decorate pi's built-in footer in place. Move cumulative usage through cost
  to the path row, keep context/model alignment on row two, and give path,
  branch, input, output, cache, cost, context, model, and effort stable subtle
  semantic colors. Reserve one right column, leave custom footers untouched,
  and animate only while `max` or `ultra` is visible.
- Bind Pi's clipboard paste action to both Ctrl+V and Ctrl+Shift+V. Replace
  readable clipboard image paths with `[image N]` markers without moving the
  cursor away from the replacement; deleting inside a marker removes it and
  keeps the cursor at that location. Show source paths in a non-capturing text
  overlay, and expand markers before recording or Pi submission. Never enable
  Kitty rendering or change image capabilities.
- Restore and branch away a prompt only when Esc arrives before assistant
  processing; processed turns keep Pi's normal cancellation behavior.
- Abort the turn only for a questionnaire the user actually dismissed; let
  questionnaire failures reach the model.
- Never write user settings from a running session. Install-time defaults
  belong in `install.mjs`, only when the key is absent, and an unreadable
  settings file is left alone.
- Keep pure history and storage logic covered by `node:test` fixtures.
