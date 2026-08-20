# proper-base

proper-base combines cross-session history with focused editor, fullscreen, cancellation, and footer customizations.

## Purpose

The package groups local pi behavior in one extension: automatic session naming, cross-session prompt history, autocomplete details, fullscreen compatibility, footer styling, and cancellation.

Pi session messages contain model-facing expansions rather than trustworthy raw input. The extension records editor submissions in a private append-only store and rejects replayed session messages, while keeping autocomplete descriptions compact and visible above the prompt.

## Architectural boundary

The runtime is split by responsibility.

- `index.ts` wires `session_start`, first-response session naming, editor replacement, early-cancel branch recovery, base keybinding overrides, `ask_user_question` cancellation, and the package entry point.
- `src/autocomplete-details.ts` owns overlay lifecycle, boxed rendering, terminal positioning, selected-description updates, descending `/model` argument ordering, and immediate submission of selected model completions.
- `src/editor-navigation.ts` implements recalled-history cursor placement and two-stage Home/End behavior while preserving configured keybindings and custom editor fallback.
- `src/footer-colors.ts` rearranges Pi's built-in footer statistics, applies model and effort colors, and owns the bounded maximum-effort animation timer.
- `src/jump-to-bottom.ts` renders the scrolled-up jump-to-bottom button as an editor row and claims mouse input ahead of the alternate-screen renderer.
- `src/image-context.ts` replaces prior-turn image blocks in outbound context while leaving current-turn and persisted session content intact.
- `src/image-preview.ts` replaces clipboard paths with compact markers, renders their source paths in a text-only overlay, and expands markers before submission without enabling terminal image protocols.
- `src/prompt-display.ts` hashes expanded prompt-template messages, maps them to raw slash invocations, and restores that display-only mapping from custom session entries.
- `src/transcript-cleanup.ts` keeps the active run live, renders settled non-response detail behind per-item summaries, and claims clicks on those summaries ahead of fullscreen selection handling.
- `src/history-guard.ts` blocks Pi's transformed session replay and admits only recorder-trusted prompts.
- `src/history.ts` contains pure recall filtering, timestamp ordering, deduplication, and editor-factory unwrapping.
- `src/recorder.ts` intercepts editor submission while preserving later handler assignments and repeated installation.
- `src/store.ts` owns project-key encoding, private JSONL appends, bounded tail reads, and compaction.
- `src/transient-retry.ts` rewrites CLIProxyAPI transient stream errors into pi's retryable form.
- `test/` uses built-in `node:test` against pure logic, real temporary files, and a small editor integration fixture; `tsconfig.json` and package-local dependencies provide no-emit diagnostics and pi-tui wrapping utilities, not a test framework or build step.

## Core invariants

These rules preserve history and autocomplete details without destabilizing the editor.

1. Only a fresh unnamed session requests a model-generated title; explicit names and branches with a completed assistant response remain unchanged, and title text is bounded and stripped of terminal control characters.
2. History scope is the current working directory, matching pi's session bucketing.
3. Only raw prompts captured by the editor submit recorder may enter history; Pi session messages and startup replay are never trusted because they contain expanded skills and templates.
4. Duplicate recorded text keeps its newest timestamp, and at most 200 prompts reach the editor.
5. Recording runs through the editor's `onSubmit` path because pi input events do not see every command.
6. Store read, parse, append, or compaction failures never block startup or submission.
7. Editor wrapping composes with an existing factory and unwraps its own prior wrapper on reload, resume, or fork.
8. Store files remain private, reads are bounded, and oversized prompts are skipped rather than truncated.
9. Autocomplete details use a selected-item-accent, non-capturing overlay above the editor, so selection changes never alter prompt, list, or footer layout; inactive or unmounted boxes are removed from pi's overlay stack so renderer mode changes remain available.
10. Footer styling moves cumulative usage through cost onto the top path row, keeps context and model information aligned on row two with one trailing safety column, assigns stable subtle colors to each metric, escalates context color at 70% and 90%, animates only visible `max` or `ultra`, and leaves custom footers untouched.
11. Fullscreen Home, End, PageUp, and PageDown remain editor keys; only their Ctrl+Shift-modified forms control the transcript viewport, without discarding unrelated user bindings.
12. A dismissed `ask_user_question` aborts the turn, while an answered one and every questionnaire failure reach the model unchanged.
13. Slash-command completion works at command-token boundaries anywhere in the prompt and replaces only the active segment; every `/model ` result list is descending, searches strictly filter by every term when possible, and Enter or Tab submits only after Pi produces the selected `provider/model` command.
14. Esc before assistant processing restores the prompt and removes its turn from the active branch; processed turns retain Pi's normal abort behavior, and the append-only session file keeps only an abandoned audit branch.
15. Ctrl+V and Ctrl+Shift+V invoke Pi's clipboard paste action; image paths become `[image N]` markers without moving the cursor away from the replacement, marker deletion leaves the cursor at the removed marker, source paths stay in a text-only overlay, terminal capabilities remain unchanged, and intact markers expand before history storage and Pi submission.
16. Shift+Enter and Alt+Enter insert prompt newlines; Alt+Enter is not retained as the follow-up queue shortcut.
17. Up leaves a recalled prompt at line 0, column 0; Home then moves through the current visible-row and full-prompt starts, while End moves through logical-line and full-prompt ends without taking over Ctrl+Shift+Home/End.
18. The jump-to-bottom button exists only for a viewport renderer that is not following output, occupies an editor row rather than an overlay so scrollbar dragging survives, and consumes only the mouse events landing on its own cells.
19. Transient-error normalization touches only errored assistant messages matching the CPA `empty_stream` wording and never re-prefixes an already retryable message.
20. Assistant steps compact on their own message completion, tools compact independently on their own execution completion, and every agent-owned thought, tool call, error, and update renders in original transcript order as its own labeled summary with a distinct semantic theme color; output appended while idle, including slash-command UI, remains native; fullscreen clicks on either an item's summary or repeated bottom collapse control toggle only that item, while the configured tool-output binding remains the global fallback.
21. Prompt-template expansion remains model-facing: the user transcript shows the raw slash command live and after session restoration, using persisted hashes without duplicating expanded bodies or changing model context.
22. Image blocks remain in model context through the user turn that introduced them; a later user message replaces older image blocks only in the outbound context copy, preserving current-turn tool loops, message order, tool-result structure, and persisted session history.

## Documentation map

Each document owns one runtime concern.

- [lifecycle](./lifecycle.md) — startup, prompt sources, cursor navigation, image previews and outbound image context, settled transcript detail, early-cancel recovery, editor composition, fullscreen key routing, the jump-to-bottom button, autocomplete details, footer decoration, and transient stream retry.
- [storage](./storage.md) — project paths, JSONL format, permissions, bounded reads, limits, and compaction.
- [operations](./operations.md) — package identity, installation, runtime requirements, and data removal.
- [tests](./tests.md) — deterministic history, recorder, autocomplete, fullscreen key routing, footer styling, and real-filesystem store coverage.

<!-- lat-index
- [[lifecycle]] — package index entry
- [[storage]] — package index entry
- [[operations]] — package index entry
- [[tests]] — package index entry
-->
