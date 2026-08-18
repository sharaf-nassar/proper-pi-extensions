# Prompt history lifecycle

Each `session_start` rebuilds the editor wrapper and seeds a bounded history assembled for the active working directory.

## Startup sequence

Startup compacts the project store when needed, loads history, unwraps any prior proper-base wrapper, and installs a new factory around the current editor factory.

If another extension already provides an editor, that factory remains the base. Otherwise proper-base creates pi's `CustomEditor`. The seeded prompts are added oldest first so the first Up press returns the newest entry.

## Prompt sources

History combines the private store with pi session files for the current working directory.

The store covers prompts from sessions pi never persisted. Session files preserve prompts from before installation and remain a fallback if the store is deleted. Sessions are read newest first, the live session file is skipped, and scanning stops after collecting 200 prompts.

Failure to list or open sessions leaves store history available. Damaged sessions contribute no prompts instead of failing startup.

## Prompt normalization

Only user messages produce history entries.

String content is used directly. Text parts are concatenated the same way pi builds live editor history, while non-text parts are ignored. Whitespace-only prompts are dropped. Skill-wrapper messages are reduced to the trailing text the user typed; a wrapper without trailing text is omitted.

## Merge contract

Sources merge by prompt text and timestamp rather than by source order.

A duplicate collapses onto its newest timestamp. Same-timestamp entries retain encounter order. Prompts already present in pi's live-session history are excluded, the newest 200 survive the limit, and the result is returned oldest first for `addToHistory()`.

## Submission interception

Recording wraps the editor instance's `onSubmit` property rather than relying on pi's input event.

The property descriptor wraps both an existing handler and handlers assigned later by pi. An optional preparation step expands display-only image markers before recording and delegation, so history and Pi receive real paths. Recording occurs before delegating so a downstream failure cannot lose the prompt. A symbol marker prevents recorder stacking when installation repeats.

## Clipboard image previews

Clipboard image paths render as compact prompt thumbnails instead of raw temporary paths.

The editor's `onChange` property is wrapped so every insertion route, including bracketed paste and Pi's clipboard helper, detects absolute `pi-clipboard-*` GIF, JPEG, PNG, or WebP paths. Each image is read once and replaced by a short `[image N]` marker.

Active markers render in a 26-column non-capturing overlay anchored above the editor, with each image capped at 24 columns by 6 rows. Multiple images stack vertically, and an autocomplete description temporarily hides the image overlay to avoid overlap. Overlay entries are removed when inactive so renderer switching remains available.

pi-tui treats unknown terminals as text-only. During extension factory loading, before interactive TUI construction, proper-base upgrades `TERM_PROGRAM=Scribe` capability to Kitty. The fullscreen renderer therefore captures Kitty support during its normal startup and owns image placement/cache state without private post-start mutation. Other unsupported terminals retain pi-tui's fallback.

A one-character deletion is compared with the prior editor text. If the deletion lands anywhere inside an intact marker, the remaining fragment and its preview are removed atomically. Submission preparation expands intact markers back to source paths before recorder storage and Pi dispatch.

Preview data remains available across an unprocessed early cancellation so the restored marker redraws its thumbnail, then clears once assistant processing begins or a normal turn settles. Reload and shutdown restore editor methods, hide the overlay, and release buffered image data.

## Autocomplete description pane

The installed editor's `render()` is wrapped once per instance. Selected autocomplete descriptions render in a non-capturing pi-tui overlay immediately above the editor instead of adding lines to the editor itself.

The overlay is full-width, square-bordered, and anchored above the editor plus any widgets and footer rows beneath it. It expands upward over transcript content, so descriptions of different lengths never move the prompt, autocomplete list, or footer. Newlines are normalized and text wraps inside the box; descriptions exceeding the terminal area above the prompt end with an ellipsis.

Cursor movement updates the selected item before the next render. The overlay exists only while its editor remains mounted and a selected description exists. Losing either condition calls the overlay handle's `hide()` method, removing the entry rather than merely making it invisible. Unmount detection queues removal after the current overlay-visibility pass so the stack is not mutated while pi iterates it.

This lifecycle matters when pi changes renderers: its regular/fullscreen switch refuses to run while any overlay entry exists, including invisible non-capturing entries. Releasing the detail overlay keeps that switch available, and the next editor render recreates the box against the active renderer. Editors without pi's autocomplete-list state render exactly as before.

This scope covers editor autocomplete, including skills and slash commands. A provider wrapper sorts every `/model ` result by displayed model ID descending using case-insensitive, numeric-aware comparison. For a non-empty query, whitespace-delimited terms must each occur in the candidate's label, value, or description; when strict matches exist, unrelated fuzzy candidates are removed before sorting. If strict matching finds nothing, Pi's fuzzy candidate set remains available but is still sorted descending. Non-model suggestions retain provider order. When Enter or Tab accepts a model completion, the editor wrapper verifies that Pi produced the exact selected `provider/model` command and immediately invokes Pi's submission path. Enter reuses its confirm key; Tab calls the editor's native submit routine, with an Enter fallback for compatible custom editors. Tab remains completion-only outside `/model ` arguments, and editors without Pi's autocomplete internals are untouched. Built-in modal selectors do not pass through the editor factory and are outside the extension API.

## Prompt cursor navigation

End moves through multiline prompts in two stages.

The editor wrapper intercepts the configured `tui.editor.cursorLineEnd` action. If the cursor is before the current logical line end, native Pi handling performs the first move. If the cursor is already at that boundary and later prompt lines exist, proper-base moves pi-tui's cursor state to the final column of the final line. End at the full prompt end delegates to native no-op behavior. Autocomplete keeps native handling, custom editors without Pi's state object use a bounded Down-key fallback, and Ctrl+Shift+End remains the fullscreen transcript action.

## Pinned transcript scrolling

Pinned scrolling comes from pi's native fullscreen renderer; proper-base keeps that renderer switch available and changes which keys target it.

With `tuiMode` set to `fullscreen`, pi owns transcript scrolling while queued messages, status, widgets, editor, and footer remain fixed at the bottom. proper-base does not implement a second transcript viewport; it releases inactive overlays so renderer changes remain unblocked. Mouse selection, wheel scrolling, scrollbar dragging, and link clicks remain under Pi's native fullscreen renderer.

Pi normally gives fullscreen transcript actions priority on unmodified Home, End, PageUp, and PageDown. The editor factory rewrites those four `tui.altScreen` action bindings on pi's shared keybinding manager to Ctrl+Shift+Home, Ctrl+Shift+End, Ctrl+Shift+PageUp, and Ctrl+Shift+PageDown. The unmodified and Shift-only keys therefore remain available to the terminal and pi's native editor actions.

Pi reloads `keybindings.json` after extension `session_start` handlers, so proper-base wraps the manager's `reload()` method once and reapplies its four overrides after the native file load. The wrapper delegates through a symbol-stored mutable controller: hot reload replaces the controller's apply callback, preventing a closure from an older extension version from restoring obsolete bindings after the new `session_start`. A legacy boolean marker is upgraded by wrapping its stale reload handler so the newest apply pass runs last. Unrelated user bindings are preserved, repeated factory installation cannot stack current wrappers or drift values, and these four transcript bindings intentionally override user values while proper-base is active.

## Footer presentation

The editor factory locates pi's mounted built-in `FooterComponent` and decorates its `render()` output in place.

When the stats row contains a dollar cost, cumulative input, output, cache, cache-hit, and cost fields move to the right side of the top path row. The path truncates to make room. Context usage remains left on the second row, while the existing provider/model/thinking segment is re-padded to the right edge. Narrow layouts that cannot retain a useful path keep Pi's native arrangement.

`max` and the router-provided `ultra` level render each character with a different rainbow color. A bright highlight crosses the word on a four-second cycle; a 120 ms unref'd timer requests redraws only while either level is active and the footer remains mounted. Changing to another effort stops the timer, and footer disposal clears it.

After layout, the active model receives fixed purple truecolor. Off through xhigh use pi's semantic thinking-level colors; maximum effort uses the animation above. Footer text, provider labels, extension statuses, and line count remain native, and components other than the built-in footer are not modified.

`session_shutdown` restores the built-in footer methods and stops the animation before pi invalidates the outgoing extension context. The replacement session can therefore render its native footer during rebinding without touching a stale captured context, then install fresh decoration from its new `session_start`.

## Early prompt cancellation

proper-base tracks each submitted plain prompt until assistant processing begins.

Editor submission captures text before Pi's input pipeline, while input and message events attach the accepted user-message timestamp and processing state. A terminal-input listener watches Esc only while the editor is focused and autocomplete is closed.

If Esc arrives before assistant processing, the prompt text is restored to the editor immediately. After the aborted run settles, proper-base invokes an internal extension command with command-context access and navigates to the cancelled user entry. Navigating to a user entry moves the active leaf to its parent, rebuilds agent context, and rerenders the transcript; when the user entry is already the leaf, a hidden custom anchor first makes navigation non-no-op. The append-only JSONL retains the abandoned branch, but the active transcript and future model context exclude it.

The pre-input submission capture also covers cancellation during llm-router judging, when no Pi user entry exists yet: the router discards the prompt, and proper-base restores its text without branch navigation. Streaming steering or follow-up submissions clear this early capture and remain owned by Pi's native queue restoration. Once an assistant message starts, cancellation keeps Pi's normal behavior and does not remove the turn. Escape used by autocomplete or another focused component is ignored.

## Questionnaire cancellation

A `tool_result` handler aborts the agent when the `ask_user_question` tool reports a dismissed questionnaire.

The tool is provided by `@juicesharp/rpiv-ask-user-question`, which resolves Esc as an ordinary result carrying `cancelled: true` and the text `User declined to answer questions`. Without intervention the turn continues and the model responds to a decline the user did not ask it to acknowledge. `ctx.abort()` reaches the same handler pi binds to Esc during streaming, so the run ends and the prompt accepts typing immediately.

The same result also reports `cancelled` for host and validation failures, which additionally set `error`: no UI, an RPC host without custom rendering, rejected parameters, and questionnaire module-load failures. Those keep their normal delivery so the model can fall back to asking in plain text. Results from other tools and answered questionnaires are untouched.

The handler is registered once at extension load rather than per `session_start`, so reload, resume, and fork cannot stack it.

## Reload and composition

A global symbol tags the editor factory and remembers the factory it wrapped.

The editor and recorder symbol keys retain their legacy `pi-proper-history` namespace so recorded behavior survives both package renames. The fullscreen keybinding installer also recognizes the prior `pi-proper-customs.fullscreen-keybindings` marker and migrates its mutable controller to the `pi-proper-base` namespace.

Because `session_start` runs on reload, resume, and fork, the next pass unwraps proper-base's previous factory before wrapping again. This prevents duplicate seeding and an ever-growing wrapper chain. Separate editor, TUI, and footer symbols prevent wrappers, overlays, and timers from stacking; repeated footer installation refreshes its live context, while `session_shutdown` removes it before context invalidation. Extensions loaded later may still replace the editor or footer, so load order controls the final renderer and keybindings.
