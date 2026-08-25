# proper-pacify

## Task tracking

Beads (`bd`) is managed from the repository root.

## lat.md

- Before coding: run `lat search "<task>"` from the repository root.
- After changing behavior, architecture, or tests: update
  `../lat.md/proper-pacify/`, then run `lat check` from the repository root.

## Build and test

Pi loads `pacify.ts` through this package's `pi` manifest. There is no build
step. Pi supplies coding-agent and pi-tui as peer packages.

```bash
npm test
npm run typecheck
npm run test:coverage
```

## Commands

`/pacify <prompt>`, `/pacify-session`, `/pacify-config`.

## Invariants

- Pacification changes tone only. The immutable system instruction always wins
  over configurable tone guidance. Use exactly one rewrite model call: no
  verifier, no second pass, no model-as-judge.
- Pacification runs above Pi's handler chain by wrapping the host `emitInput`
  funnel, so no other extension can observe an unpacified prompt. Never solve
  ordering by naming another package or prescribing install order.
- Automatic mode is off, on, or a daily local-time window, held as one union
  value so on and scheduled stay mutually exclusive by construction. An
  unusable window loads as off; never fail open to pacifying every prompt.
- `/pacify-session` overrides automatic mode for the current session only. It
  never writes to disk, is cleared by a replacement session, and survives a
  reload.
- Auto mode fails open to the original prompt on model or transport errors.
- Esc cancels and discards an in-flight auto prompt.
- Progress, cancellation, and failure messages go to the transcript through
  `ctx.ui.notify()`. Never take a footer status slot.
- Before and after prompts are custom session entries, never LLM context.
- Only `/pacify`'s own emitted message bypasses auto mode; other extension
  messages remain eligible.
- Keep the default effort at `medium`. The default tone prompt measurably
  degrades at `low`.
- Releases go through `./tools/release-me/release.sh bump <part> proper-pacify`
  from the repository root, never a direct `npm publish`.
