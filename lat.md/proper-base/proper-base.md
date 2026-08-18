# proper-base

proper-base combines cross-session history with focused editor, fullscreen, cancellation, and footer customizations.

## Purpose

The package groups local pi behavior in one extension: cross-session prompt history, autocomplete descriptions, fullscreen renderer compatibility, footer styling, and questionnaire cancellation.

Pi's editor history normally covers only the current session, while session files omit sessions that never receive an assistant message. The extension merges persisted session prompts with a private append-only store without changing pi's session format. Pi's compact autocomplete rows truncate descriptions; proper-base keeps the list compact and shows the selected description in an overlay above the prompt.

## Architectural boundary

The runtime is split by responsibility.

- `index.ts` wires `session_start`, pi session discovery, editor replacement, early-cancel branch recovery, base keybinding overrides, `ask_user_question` cancellation, and the package entry point.
- `src/autocomplete-details.ts` owns overlay lifecycle, boxed rendering, terminal positioning, selected-description updates, descending `/model` argument ordering, and immediate submission of selected model completions.
- `src/editor-navigation.ts` implements two-stage End behavior while preserving configured keybindings and custom editor fallback.
- `src/footer-colors.ts` rearranges Pi's built-in footer statistics, applies model and effort colors, and owns the bounded maximum-effort animation timer.
- `src/image-preview.ts` replaces clipboard paths with compact markers, renders their source paths in a text-only overlay, and expands markers before submission without enabling terminal image protocols.
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
8. Autocomplete details use a selected-item-accent, non-capturing overlay above the editor, so selection changes never alter prompt, list, or footer layout; inactive or unmounted boxes are removed from pi's overlay stack so renderer mode changes remain available.
9. Footer styling moves cumulative usage through cost onto the top path row, keeps context and model information aligned on row two with one trailing safety column, assigns stable subtle colors to each metric, escalates context color at 70% and 90%, animates only visible `max` or `ultra`, and leaves custom footers untouched.
10. Fullscreen Home, End, PageUp, and PageDown remain editor keys; only their Ctrl+Shift-modified forms control the transcript viewport, without discarding unrelated user bindings.
11. A dismissed `ask_user_question` aborts the turn, while an answered one and every questionnaire failure reach the model unchanged.
12. Slash-command completion works at command-token boundaries anywhere in the prompt and replaces only the active segment; every `/model ` result list is descending, searches strictly filter by every term when possible, and Enter or Tab submits only after Pi produces the selected `provider/model` command.
13. Esc before assistant processing restores the prompt and removes its turn from the active branch; processed turns retain Pi's normal abort behavior, and the append-only session file keeps only an abandoned audit branch.
14. Ctrl+V and Ctrl+Shift+V invoke Pi's clipboard paste action; image paths appear as `[image N]` markers with source paths in a text-only overlay, terminal capabilities remain unchanged, and intact markers expand before history storage and Pi submission.
15. Shift+Enter and Alt+Enter insert prompt newlines; Alt+Enter is not retained as the follow-up queue shortcut.
16. Home first reaches the current visible-row start and then the full prompt start; End first reaches the logical-line end and then the full prompt end, without taking over Ctrl+Shift+Home/End.

## Documentation map

Each document owns one runtime concern.

- [lifecycle](./lifecycle.md) — startup, prompt sources, cursor navigation, image previews, early-cancel recovery, editor composition, fullscreen key routing, autocomplete details, and footer decoration.
- [storage](./storage.md) — project paths, JSONL format, permissions, bounded reads, limits, and compaction.
- [operations](./operations.md) — package identity, installation, runtime requirements, and data removal.
- [tests](./tests.md) — deterministic history, recorder, autocomplete, fullscreen key routing, footer styling, and real-filesystem store coverage.

<!-- lat-index
- [[lifecycle]] — package index entry
- [[storage]] — package index entry
- [[operations]] — package index entry
- [[tests]] — package index entry
-->