# Prompt history lifecycle

Each `session_start` rebuilds the editor wrapper and seeds a bounded history assembled for the active working directory.

## Startup sequence

Startup compacts the project store when needed, loads history, unwraps any prior proper-customs wrapper, and installs a new factory around the current editor factory.

If another extension already provides an editor, that factory remains the base. Otherwise proper-customs creates pi's `CustomEditor`. The seeded prompts are added oldest first so the first Up press returns the newest entry.

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

The property descriptor wraps both an existing handler and handlers assigned later by pi. Recording occurs before delegating so a downstream failure cannot lose the prompt. A symbol marker prevents recorder stacking when installation repeats.

## Autocomplete description pane

The installed editor's `render()` is wrapped once per instance. Selected autocomplete descriptions render in a non-capturing pi-tui overlay immediately above the editor instead of adding lines to the editor itself.

The overlay is full-width, square-bordered, and anchored above the editor plus any widgets and footer rows beneath it. It expands upward over transcript content, so descriptions of different lengths never move the prompt, autocomplete list, or footer. Newlines are normalized and text wraps inside the box; descriptions exceeding the terminal area above the prompt end with an ellipsis.

Cursor movement updates the selected item before the next render. The overlay exists only while its editor remains mounted and a selected description exists. Losing either condition calls the overlay handle's `hide()` method, removing the entry rather than merely making it invisible. Unmount detection queues removal after the current overlay-visibility pass so the stack is not mutated while pi iterates it.

This lifecycle matters when pi changes renderers: its regular/fullscreen switch refuses to run while any overlay entry exists, including invisible non-capturing entries. Releasing the detail overlay keeps that switch available, and the next editor render recreates the box against the active renderer. Editors without pi's autocomplete-list state render exactly as before.

This scope covers editor autocomplete, including skills and slash commands. Built-in modal selectors do not pass through the editor factory and are outside the extension API.

## Pinned transcript scrolling

Pinned scrolling comes from pi's native fullscreen renderer; proper-customs keeps that renderer switch available and changes which keys target it.

With `tuiMode` set to `fullscreen`, pi owns transcript scrolling while queued messages, status, widgets, editor, and footer remain fixed at the bottom. proper-customs does not implement a second transcript viewport; it releases inactive overlays so renderer changes remain unblocked.

Pi normally gives fullscreen transcript actions priority on unmodified Home, End, PageUp, and PageDown. The editor factory rewrites those four `tui.altScreen` action bindings on pi's shared keybinding manager to Shift+Home, Shift+End, Shift+PageUp, and Shift+PageDown. The unmodified keys therefore continue to match pi's native editor actions for line and page cursor movement.

Pi reloads `keybindings.json` after extension `session_start` handlers, so proper-customs wraps the manager's `reload()` method once and reapplies its four overrides after the native file load. Unrelated user bindings are preserved, repeated factory installation cannot stack the wrapper or drift values, and these four transcript bindings intentionally override user values while proper-customs is active.

## Footer presentation

The editor factory locates pi's mounted built-in `FooterComponent` and decorates its `render()` output in place. The active model receives a fixed purple truecolor treatment, while off through xhigh use pi's semantic thinking-level theme colors.

`max` and the router-provided `ultra` level render each character with a different rainbow color. A bright highlight crosses the word on a four-second cycle; a 120 ms unref'd timer requests redraws only while either level is active and the footer remains mounted. Changing to another effort stops the timer, and footer disposal clears it.

Decoration replaces only the plain model and effort substrings inside pi's rendered line, so cwd, token statistics, provider labels, extension statuses, truncation, and line count remain native. Components other than the built-in footer are not modified.

`session_shutdown` restores the built-in footer methods and stops the animation before pi invalidates the outgoing extension context. The replacement session can therefore render its native footer during rebinding without touching a stale captured context, then install fresh decoration from its new `session_start`.

## Reload and composition

A global symbol tags the editor factory and remembers the factory it wrapped.

The symbol keys retain their legacy `pi-proper-history` namespace so a running process can unwrap a wrapper installed before the package rename.

Because `session_start` runs on reload, resume, and fork, the next pass unwraps proper-customs' previous factory before wrapping again. This prevents duplicate seeding and an ever-growing wrapper chain. Separate editor, TUI, and footer symbols prevent wrappers, overlays, and timers from stacking; repeated footer installation refreshes its live context, while `session_shutdown` removes it before context invalidation. Extensions loaded later may still replace the editor or footer, so load order controls the final renderer and keybindings.
