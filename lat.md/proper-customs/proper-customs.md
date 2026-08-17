# proper-customs

proper-customs combines cross-session prompts, autocomplete descriptions, native fullscreen compatibility, and model/effort footer colors.

## Purpose

The package groups local pi behavior in one extension: cross-session prompt history, complete autocomplete descriptions, fullscreen renderer compatibility, and model/effort footer styling.

Pi's editor history normally covers only the current session, while session files omit sessions that never receive an assistant message. The extension merges persisted session prompts with a private append-only store without changing pi's session format. Pi's compact autocomplete rows truncate descriptions; proper-customs keeps the list compact and shows the selected description in an overlay above the prompt.

## Architectural boundary

The runtime is split by responsibility.

- `index.ts` wires `session_start`, pi session discovery, editor replacement, fullscreen keybinding overrides, and the package entry point.
- `src/autocomplete-details.ts` owns overlay lifecycle, boxed rendering, terminal positioning, and selected-description updates.
- `src/footer-colors.ts` decorates pi's built-in footer, applies model and effort colors, and owns the bounded maximum-effort animation timer.
- `src/history.ts` contains pure prompt extraction, session ordering, deduplication, exclusion, and merge logic.
- `src/recorder.ts` intercepts editor submission while preserving later handler assignments and repeated installation.
- `src/store.ts` owns project-key encoding, private JSONL appends, bounded tail reads, and compaction.
- `test/` uses built-in `node:test` against pure logic, real temporary files, and a small editor integration fixture; `tsconfig.json` and package-local dependencies provide no-emit diagnostics and pi-tui wrapping utilities, not a test framework or build step.

## Core invariants

These rules preserve history and autocomplete details without destabilizing the editor.

1. History scope is the current working directory, matching pi's session bucketing.
2. Session files and the recorded store merge by timestamp; duplicate text keeps its newest timestamp.
3. Prompts already seeded from the live session are excluded, and at most 200 merged prompts reach the editor.
4. Recording runs through the editor's `onSubmit` path because pi input events do not see every command.
5. Read, parse, append, compaction, or session-list failures degrade to partial history and never block startup or submission.
6. Editor wrapping composes with an existing factory and unwraps its own prior wrapper on reload, resume, or fork.
7. Store files remain private, reads are bounded, and oversized prompts are skipped rather than truncated.
8. Autocomplete details use a non-capturing overlay above the editor, so selection changes never alter prompt, list, or footer layout; inactive or unmounted boxes are removed from pi's overlay stack so renderer mode changes remain available.
9. Footer styling preserves pi's rendered text and layout, uses semantic thinking colors below maximum effort, animates only visible `max` or `ultra`, and leaves custom footers untouched.
10. Fullscreen Home, End, PageUp, and PageDown remain editor keys; only their Shift-modified forms control the transcript viewport, without discarding unrelated user bindings.

## Documentation map

Each document owns one runtime concern.

- [lifecycle](./lifecycle.md) — startup, prompt sources, editor composition, fullscreen key routing, autocomplete details, and footer decoration.
- [storage](./storage.md) — project paths, JSONL format, permissions, bounded reads, limits, and compaction.
- [operations](./operations.md) — package identity, installation, runtime requirements, and data removal.
- [tests](./tests.md) — deterministic history, recorder, autocomplete, fullscreen key routing, footer styling, and real-filesystem store coverage.

<!-- lat-index
- [[lifecycle]] — package index entry
- [[storage]] — package index entry
- [[operations]] — package index entry
- [[tests]] — package index entry
-->