# proper-base

proper-base combines cross-session history and reverse search with focused editor, fullscreen, cancellation, footer, and provider fast-tier customizations.

## Purpose

The package groups local pi behavior in one extension: session naming and listing, model-preserving clearing, cross-session prompt history, autocomplete details, fullscreen compatibility, footer styling, cancellation, and commit-message gating.

Pi session messages contain model-facing expansions rather than trustworthy raw input. The extension records editor submissions in a private append-only store and rejects replayed session messages, while keeping autocomplete descriptions compact and visible above the prompt.

## Architectural boundary

The runtime is split by responsibility.

- `index.ts` wires `session_start`, first-response session naming, model-preserving `/clear`, editor replacement, early-cancel branch recovery, base keybinding overrides, `ask_user_question` cancellation, the commit-guard `tool_call` handler, and the package entry point.
- `src/autocomplete-details.ts` owns overlay lifecycle, boxed rendering, terminal positioning, selected-description updates, descending `/model` argument ordering, argument re-trigger after an accepted command completion, the optional `/model` thinking-level argument and its parser, and Enter submission of accepted `/model` completions.
- `src/startup-defaults.ts` writes the selected provider, model ID, and thinking level into Pi's `settings.json` startup defaults, honoring the `stickyDefaults` opt-out.
- `src/commit-guard.ts` ports the commit-message validator hook: shell tokenization, direct-invocation and literal-message checks, and 72-column, blank-second-line, trailer, and attribution rules.
- `src/clipboard-guard.ts` neutralizes the X-connection leak in pi's bundled native clipboard addon by swapping its Linux read entry points for the platform tools pi already trusts.
- `src/editor-navigation.ts` implements three-stage Ctrl+C clearing and exit, terminal-style Ctrl+R reverse history search, large-paste-registry-preserving text replacement, private-segmenter composition for whole-marker highlighting and native atomic deletion, atomic Left/Right movement across image markers, recalled-history cursor placement, and two-stage Home/End behavior while preserving configured keybindings and custom editor fallback.
- `src/footer-colors.ts` rearranges Pi's built-in footer statistics, applies model and effort colors, and owns the bounded maximum-effort animation timer.
- `src/jump-to-bottom.ts` renders the scrolled-up jump-to-bottom button as an editor row and claims mouse input ahead of the alternate-screen renderer.
- `src/prompt-jump.ts` composites previous/next prompt chips, a scrolled-only position reading, and the faint-resting, hover-expanded session action rail of per-type symbols into the transcript viewport, and scrolls between user prompt blocks or to a clicked action.
- `src/settings.ts` persists proper-base's on/off choices (session action rail, prompt mouse clicks) in the agent directory and splices their toggles into Pi's native settings selector through a guarded container wrapper.
- `src/editor-mouse.ts` wraps the editor's mouse handler so, while the prompt mouse setting is off, a left click on the prompt's text rows is consumed without moving the cursor.
- `src/image-context.ts` replaces prior-turn image blocks in outbound context while leaving current-turn and persisted session content intact.
- `src/image-preview.ts` enables Kitty and OSC 8 hyperlink capabilities for Scribe before renderer startup, replaces clipboard paths with compact markers, animates Pi's native loader during asynchronous cross-platform `sharp` thumbnailing, retransmits active sources on terminal focus return, renders image previews with source-path fallback, and expands markers before submission.
- `src/prompt-display.ts` hashes expanded prompt-template messages, maps them to raw slash invocations, and restores that display-only mapping from custom session entries.
- `src/smart-selection.ts` extends Pi's fullscreen double-click range for common single-line terminal tokens while preserving native fallback and selection mechanics.
- `src/osc8-link-ids.ts` rewrites fullscreen terminal writes so every anonymous OSC 8 open carries a stable URI-derived id, making wrapped transcript links one hover-and-activation unit in id-aware terminals.
- `src/selection-dismiss.ts` drops the fullscreen mouse selection when a keystroke or paste reaches the editor, while mouse, viewport, and terminal-report input leave it standing.
- `src/wheel-scroll.ts` raises the fullscreen renderer's per-wheel-event line step to the 3-line terminal scrolling convention, with a per-terminal environment override and fail-open field detection.
- `src/transcript-cleanup.ts` keeps the active run live, leaves thoughts and settled updates fully rendered, compacts tools and errors behind per-item summaries, records the per-action outline the session action rail consumes, and claims clicks on those summaries ahead of fullscreen selection handling.
- `src/history-guard.ts` blocks Pi's transformed session replay and admits only recorder-trusted prompts.
- `src/history.ts` contains pure recall filtering, timestamp ordering, deduplication, and editor-factory unwrapping.
- `src/recorder.ts` intercepts editor submission while preserving later handler assignments and repeated installation.
- `src/session-list.ts` replaces pi's session listing with byte-prefix scans that read only what the `/resume` picker draws, and refills picker search text in the background.
- `src/store.ts` owns project-key encoding, private JSONL appends, bounded tail reads, and compaction.
- `src/transient-retry.ts` rewrites CLIProxyAPI transient stream errors into pi's retryable form.
- `src/fast-mode.ts` scopes CLIProxyAPI's priority service tier into a session-only `/fast` and a live cross-session `/fast-global` by owning the final `service_tier` on outgoing requests.
- `test/` uses built-in `node:test` against pure logic, real temporary files, and a small editor integration fixture; `tsconfig.json` and package-local dependencies provide no-emit diagnostics and pi-tui wrapping utilities, not a test framework or build step.

## Core invariants

These rules preserve history and autocomplete details without destabilizing the editor.

1. Only a fresh unnamed session requests a model-generated title; explicit names and branches with a completed assistant response remain unchanged, and title text is bounded and stripped of terminal control characters.
2. `/clear` uses Pi's native new-session replacement without copying conversation state, then restores the exact outgoing provider and model through a command bound to the replacement extension runtime.
3. History scope is the current working directory, matching pi's session bucketing.
4. Only raw prompts captured by the editor submit recorder may enter history; Pi session messages and startup replay are never trusted because they contain expanded skills and templates.
5. Duplicate recorded text keeps its newest timestamp, and at most 200 prompts reach the editor.
6. Recording runs through the editor's `onSubmit` path because pi input events do not see every command.
7. Store read, parse, append, or compaction failures never block startup or submission.
8. Editor wrapping composes with an existing factory and unwraps its own prior wrapper on reload, resume, or fork.
9. Store files remain private, reads are bounded, and oversized prompts are skipped rather than truncated.
10. Autocomplete details use a selected-item-accent, non-capturing overlay above the editor, so selection changes never alter prompt, list, or footer layout; inactive or unmounted boxes are removed from pi's overlay stack so renderer mode changes remain available.
11. Footer styling moves cumulative usage through cost onto the top path row, keeps context and model information aligned on row two with one trailing safety column, assigns stable subtle colors to each metric, escalates context color at 70% and 90%, animates only visible `max` or `ultra`, and leaves custom footers untouched.
12. Fullscreen Home, End, PageUp, and PageDown remain editor keys; only their Ctrl+Shift-modified forms control the transcript viewport, without discarding unrelated user bindings.
13. A dismissed `ask_user_question` aborts the turn, while an answered one and every questionnaire failure reach the model unchanged.
14. Slash-command completion works at command-token boundaries anywhere in the prompt and replaces only the active segment; accepting a command name reopens its argument suggestions immediately while dismissals and completed file paths open nothing; a word or line delete under a still-open list re-requests suggestions so the menu tracks the edited prompt instead of lingering on stale text; every `/model ` result list is descending, searches strictly filter by every term when possible, Tab on a model name submits nothing and instead leaves the name, its separating space, and an open thinking-level menu in the prompt, while Tab on a level submits like Enter because no argument can follow it, and either submits only after Pi produces a runnable `/model` command ending in the selected value.
15. Esc before assistant processing restores the prompt and removes its turn from the active branch; processed turns retain Pi's normal abort behavior, and the append-only session file keeps only an abandoned audit branch.
16. Ctrl+V and Ctrl+Shift+V invoke Pi's clipboard paste action; image paths become `[image N]` markers without moving the cursor away from the replacement, Left and Right cross each complete marker atomically while malformed text stays native, the cursor inverse-highlights the full active marker, Backspace deletes that whole token through Pi's native editor path and leaves the cursor at its start, Scribe enables Kitty and OSC 8 hyperlinks before renderer startup so ctrl+click on a wrapped transcript link opens the full URL, capable terminals show Pi's animated braille loader until cross-platform asynchronous `sharp` produces a pixel-bounded preview, failed or timed-out thumbnail conversion falls back to source-path text, focus return forces active Kitty sources to retransmit, and intact markers expand before history storage and Pi submission. Editor rewrites that pass through pi-tui's `setText()` — marker replacement, marker deletion, and the reverse-search draft restore — re-seed the large-paste registry entries the new text still references, and the run-boundary preview clear spares markers still sitting in the editor while disposal drops every preview.
17. Alt+Enter inserts prompt newlines and is not retained as the follow-up queue shortcut; Pi's own newline defaults are left alone rather than restated.
18. Up recalls history only from an empty prompt, never over a draft, and leaves a recalled prompt at line 0, column 0; Home then moves through the current visible-row and full-prompt starts, while End moves through logical-line and full-prompt ends without taking over Ctrl+Shift+Home/End.
19. The jump-to-bottom button exists only for a viewport renderer that is not following output, occupies an editor row rather than an overlay so scrollbar dragging survives, and consumes only the mouse events landing on its own cells.
20. Transient-error normalization touches only errored assistant messages matching the CPA `empty_stream` wording and never re-prefixes an already retryable message.
21. Assistant and tool completion only makes errors and tools eligible to compact; they stay native until a later transcript component contains non-empty text other than the `Working` indicator, then each renders in original order as its own labeled summary with a distinct semantic theme color; thoughts, tool-calling text, and owned status updates remain fully rendered, with a blank row above and below updates; settlement compacts eligible items in the completed run; output appended while idle, including slash-command UI, remains native; fullscreen clicks on either a compact item's summary or repeated bottom collapse control toggle only that item, while the configured tool-output binding remains the global fallback.
22. Prompt-template expansion remains model-facing: the user transcript shows the raw slash command live and after session restoration, using persisted hashes without duplicating expanded bodies or changing model context.
23. Image blocks remain in model context through the user turn that introduced them; a later user message replaces older image blocks only in the outbound context copy, preserving current-turn tool loops, message order, tool-result structure, and persisted session history.
24. Ctrl+R searches recorder-trusted prompts newest-first by incremental substring; repeated Ctrl+R walks older matches, Ctrl+G restores the draft and cursor, Esc accepts for editing, Enter submits, and modal controls outside the prompt editor keep their native shortcuts.
25. Ctrl+C on non-empty text only clears and disarms exit; the first empty-prompt press shows the exit warning, and only a second empty-prompt press within 500 ms shuts down, making a non-empty prompt require three quick presses.
26. Fullscreen double-click selection expands recognized one-row URLs, paths, flags, qualified identifiers, and quoted values only inside transcript scroll views; every unknown token or incompatible renderer falls back to Pi's native selection unchanged.
27. A `bash` or `quill_execute` command naming `git commit` executes only as one direct invocation whose literal `-m` text passes the 72-column, blank-second-line, and attribution rules; parse failures block fail-safe, and commands not naming git commit are never inspected.
28. The prompt jump chips composite into the finished screen rather than an overlay, carry no background of their own and preserve the covered row's colors, stop only on user prompt blocks, leave a transient flash message on top, do nothing above the first prompt, and scroll to the transcript end past the last one. The position reading counts user prompts from the same scan, appears only while the viewport is scrolled away from output, and is omitted when the transcript holds no prompts. Nothing the chips do may end the session: the whole decoration runs under a guard inside the renderer's frame, a failure drops it for that frame and releases its click region, and its scans terminate on truncated escape sequences. Installation takes over a wrapper left on the reload-surviving renderer, and only the installation that owns the compositor may remove it.
29. Session listing reads only what the `/resume` picker draws: no entry is assembled or decoded beyond its head, an entry near a read boundary is taken exactly once, activity time comes from the last user or assistant entry rather than the file's mtime, and message-body search text refills in the background instead of blocking the picker.
30. A keystroke or bracketed paste reaching the fullscreen editor dismisses the mouse selection without consuming the input; mouse gestures, viewport keys, key releases, terminal reports, and an in-progress drag leave it standing, and renderers without the selection surface install nothing.
31. `/fast` affects only the current session and every new session starts with it off, while `/fast-global` persists the provider's `fast` key and reaches every running session's next request; the overlay adds the priority tier only for catalog-capable models of the configured provider, strips exactly that tier when Fast is off, and never touches other providers' requests or `modelRegistry.complete` side calls.
32. The clipboard guard patches only pi's cached addon object, only on Linux, replaces only `getText` and `hasImage`, installs once per process, and fails open: an unresolvable or unrecognized addon leaves every pi clipboard path unchanged.
33. Anonymous OSC 8 opens in fullscreen terminal output gain a stable URI-derived `id=` parameter so all wrapped rows of one link share one hyperlink identity; closes, opens with explicit params, split sequences, and terminals without a `write` surface are left exactly as Pi produced them.
34. The fullscreen wheel step is raised only on a renderer exposing a numeric `wheelScrollLines`, uses three lines unless `PROPER_WHEEL_SCROLL_LINES` supplies a positive integer, and leaves wheel routing, regular mode, and unrecognized renderer shapes native.
35. The session action rail exists only when the settled-transcript renderer supplies a non-empty outline: bottom-anchored tiles in session order name each prompt, reply, and tool by type with stable per-type colors, shrink and vanish before cutting the transcript's reading width, keep full intensity until pure pointer motion proves hover tracking and then rest faint — yielding any cell holding transcript text until hover lifts the stack back to full intensity — stay clickable in every state, consume only presses on their own cells — never pointer motion — and run inside the chips' frame guard so a failed decoration drops the rail without ending the session.
36. A `set` or `cycle` model selection is written to Pi's `defaultProvider`/`defaultModel` startup keys and a selected thinking level to `defaultThinkingLevel`, the level as clamped to the active model; a `restore` selection, the `llm-router` routing placeholder, a level already set as that model's `modelThinkingLevels` rule, an unchanged value, a missing or damaged `settings.json`, and `"stickyDefaults": false` all write nothing, and no other setting is modified.
37. A `/model <reference> <level>` submission is taken over ahead of Pi only when the level names one of Pi's seven levels and the reference resolves inside the session's model scope; the model is applied before the level, because every model switch recomputes the level from settings. Any other shape, including an unresolvable reference, reaches Pi unchanged.
38. The thinking-level menu opens from a Tab-accepted model name and from a hand-typed separator, never from Pi's own triggers, and only inside a single-line `/model` command whose argument already holds a `provider/id` reference; the level in effect leads the list so its default selection is a no-op.

## Clipboard leak guard

At activation on Linux, the extension replaces the two clipboard read entry points that route through pi's bundled `@mariozechner/clipboard` addon.

The addon constructs a fresh clipboard-rs `ClipboardContext` on every exported call. On X11 each context opens two X connections plus a detached service thread, and the crate defines no `Drop` for the context, so every clipboard read leaks both connections for the life of the pi process. Long-lived sessions accumulate toward Xorg's client limit, after which every X client on the machine — including the `xclip` behind pi's image paste — fails, which presents as paste silently doing nothing. pi already shells out to platform tools for Linux clipboard writes because it distrusts this crate; the guard extends that policy to reads.

`src/clipboard-guard.ts` resolves pi's own cached addon instance with a require rooted at the realpath of pi's entry script, which lands inside the pi package in both the plain and bundled layouts, so Node's CJS module cache returns the exact exports object pi calls through. `getText` becomes an asynchronous `wl-paste`/`xclip`/`xsel` subprocess read mirroring pi's write-side tool order and read bounds — asynchronous because pi awaits it and because of [[lat#Runtime responsiveness]] — and `hasImage` returns false so pi's complete `xclip`/`wl-paste` image path — already positioned as the fallback — runs directly; image paste loses nothing. `setText` and `getImageBinary` stay native because pi never calls them on Linux. A symbol flag on the shared module object makes installation idempotent across `/reload`.

macOS and Windows keep the addon untouched: pi implements no subprocess clipboard there, so the addon is load-bearing rather than redundant. The guard is a local containment for the running process; the durable fix belongs upstream in pi's addon or its Linux read paths.

## Documentation map

Each document owns one runtime concern.

- [lifecycle](./lifecycle.md) — startup, session listing, prompt sources, reverse search, prompt clearing and exit, cursor navigation, image previews and outbound image context, settled transcript detail, early-cancel recovery, editor composition, fullscreen key routing, wheel scroll rate, smart selection, selection dismissal, fast tier scopes, the jump-to-bottom button, the prompt jump chips, the session action rail, prompt mouse clicks, autocomplete details, footer decoration, the sticky startup defaults, the commit message guard, and transient stream retry.
- [storage](./storage.md) — project paths, JSONL format, permissions, bounded reads, limits, and compaction.
- [operations](./operations.md) — package identity, installation, runtime requirements, and data removal.
- [tests](./tests.md) — deterministic history, recorder, autocomplete, fullscreen key routing, footer styling, and real-filesystem store coverage.

<!-- lat-index
- [[lifecycle]] — package index entry
- [[storage]] — package index entry
- [[operations]] — package index entry
- [[tests]] — package index entry
-->
