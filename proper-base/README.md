# proper-base

Baseline behavior for [pi](https://pi.dev): a quiet settled transcript, automatic session titles, cross-session prompt history, richer autocomplete, editable cancellation, fullscreen navigation, clipboard markers, and a compact color-coded footer.

pi's Up/Down history covers the current session only. Start a new session in a project you have worked in for weeks and the editor history is empty. This extension seeds it with the prompts you typed in the other sessions recorded for the same working directory.

## Install

From this repository checkout:

```bash
pi install /path/to/proper-pi-extensions/proper-base
```

This package was renamed from the local `proper-customs` directory and the unpublished `pi-proper-customs` package identity. Update existing local installs to the `proper-base` path and keep only one registration. The former history-only package remains available as `npm:pi-proper-history`; existing `proper-history` recorded data remains compatible.

## Behaviour

### Quiet settled transcript

While the model is working, earlier turns remain compact and each current action uses Pi's normal live output only until that action finishes. Assistant steps compact on message completion, and each tool compacts on its own completion, so parallel tools remain visible independently while they run. Completed rows stay at the action's original position, before any later assistant response.

After processing settles, proper-base leaves only direct tool-free model replies visible. Every thought, tool call, error, and update becomes its own descriptive one-line row, such as `tool · read · src/index.ts` or `thought · inspect the renderer`. Thoughts are violet, tools blue, updates teal, and errors red; labels preserve the distinction without relying on color. Click any row to expand or collapse only that item. Expanded items also end with a compact left-aligned `collapse` button. Pi's normal tool-output shortcut, Ctrl+O by default, remains the global expand/collapse control.

This applies only to agent-owned output. Slash-command UI such as `/session`, extension notifications, and other text produced while Pi is idle keep their native rendering. Session history and model context keep the original messages, and removing the extension restores Pi's native transcript renderer.

### Automatic session titles

For a fresh unnamed session, proper-base asks the model to include a concise 3–7 word title in hidden metadata at the end of its first completed response. The extension applies it with Pi's native session-name API, so the terminal tab changes from `π - <directory>` to `π - <title> - <directory>` and `/resume` shows the same name.

The metadata is hidden while streaming. Existing names and sessions that already contain an assistant response are never renamed. If the first response is aborted or errors, the next completed response gets the same title request.

### Prompt editing

Shift+Enter and Alt+Enter both insert a new line in the prompt; Ctrl+J remains available too. proper-base removes Alt+Enter from Pi's follow-up queue action so the editor receives it.

Home uses two-stage navigation in multiline or soft-wrapped prompts: the first press moves to the beginning of the current visible row, and the second moves to the beginning of the entire prompt. End first reaches the current logical line end, then the full prompt end. Either key at its full-prompt boundary is a no-op.

### Pinned scrolling

Pi's native `fullscreen` TUI keeps queued messages, status, widgets, the prompt, and the footer pinned to the bottom while the transcript scrolls above them. Enable **TUI mode → fullscreen** in `/settings`, or set `"tuiMode": "fullscreen"` in `~/.pi/agent/settings.json`.

proper-base does not duplicate Pi's transcript renderer. It removes inactive autocomplete detail overlays from Pi's overlay stack so switching between regular and fullscreen modes remains available.

In fullscreen mode, Home, End, PageUp, and PageDown move within the prompt editor. Hold Ctrl+Shift with those keys to move the transcript above it: Ctrl+Shift+Home/End jump to the top/bottom, and Ctrl+Shift+PageUp/PageDown scroll by a page. Unrelated custom keybindings are preserved. Mouse selection, wheel scrolling, scrollbar dragging, and link clicks remain Pi's native behavior.

Scrolling the transcript away from its end reveals a `↓ jump to bottom` button on the row directly above the prompt, right-aligned and drawn in inverse video. Clicking it returns the viewport to the newest output; it disappears again once the transcript follows output. The button is a rendered editor row rather than an overlay, so scrollbar dragging keeps working while it is visible.

### Footer colors

The built-in footer moves cumulative input/output/cache statistics through the dollar cost onto the right side of the top path row. Context usage stays left on the second row, with provider, model, and thinking level kept right-aligned.

A restrained semantic spectrum makes dense metrics scannable: input is steel blue, output sage, cache read lavender, cache write clay, cache hit teal, cost ochre, and normal context usage dusty rose. Context shifts to amber above 70% and muted red above 90%. The path stays slate, the branch is sage, and the active model remains purple.

Thinking effort uses pi's semantic color ramp: muted for off and minimal, blue through cyan for low and medium, then lavender and bright purple for high and xhigh. `max` and the router-provided `ultra` level become rainbow text with a slow four-second highlight sweep.

The animation requests a lightweight redraw every 120 ms only while `max` or `ultra` is visible, and stops when effort changes or the footer is unmounted. Rearranged rows keep a trailing safety column for edge legibility. Native labels and layout remain intact, so color supplements the symbols and positions rather than replacing them. Custom replacement footers are left unchanged.

### Early prompt cancellation

Pressing Esc before an assistant response starts restores the submitted prompt to the editor immediately and removes that turn from the active session branch. The next prompt therefore does not inherit the cancelled text. Once assistant processing has started, normal Pi cancellation remains unchanged.

Pi sessions are append-only trees, so the cancelled entries remain only as an abandoned branch in the JSONL file; they disappear from the active transcript and model context. Cancelling during the initial llm-router judge also restores the discarded prompt for editing.

### Questionnaire cancellation

Pressing Esc on an [`ask_user_question`](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question) questionnaire normally returns "User declined to answer questions" to the model, which then spends a turn acknowledging it. proper-base aborts the run instead, exactly as Esc does during streaming, so you get the prompt back and can type.

Questionnaires that fail before you see them — no UI, an RPC host that cannot render the dialog, rejected parameters — still reach the model, so it can fall back to asking in plain text. This does nothing if the tool is not installed.

### Subagent worker context

pi-subagents ships its packaged `worker` agent with `defaultContext: fork`, so every worker child replays the parent transcript. When the child resolves to the parent's own provider, api, and model, pi keeps the inherited signed thinking blocks and Anthropic rejects the request with "`thinking` blocks in the latest assistant message cannot be modified" — the worker dies on its first turn.

Pi has no install hook of its own, so proper-base's npm `postinstall` script writes `subagents.agentOverrides.worker.defaultContext: "fresh"` into `~/.pi/agent/settings.json` once, at install time, and prints one line saying so. Nothing touches your settings while pi is running.

If a `worker` override already exists it is left alone, whatever it says: set `"defaultContext": "fork"` to keep forking deliberately, or delete the key and reinstall to be seeded again. Installing with `--ignore-scripts` skips this entirely.

### Autocomplete descriptions

When editor autocomplete is open, the selected item's description appears in a bordered, non-capturing overlay immediately above the prompt. Its text uses the same teal accent as the selected autocomplete item for stronger readability and visual continuity. The box expands upward over terminal history, so changing selections never moves the prompt, autocomplete list, or footer. Text wraps to the terminal width and uses all rows available above the prompt before adding an ellipsis.

This covers skills, slash commands, and other editor autocomplete providers that supply descriptions. Slash-command completion opens at the start of the prompt, after whitespace anywhere on a line, and at the start of later prompt lines. Filtering and argument completion run against that active slash segment; accepting a command replaces only the segment and leaves surrounding text intact. Slashes inside paths and URLs do not trigger it.

`/model ` results always sort displayed model IDs descending with numeric-aware comparison. Typed queries first retain only names matching every case-insensitive search term, then sort that filtered subset descending. If strict matching finds nothing, Pi's fuzzy candidates remain available but are still descending. Pressing Enter or Tab on a highlighted model accepts it and switches immediately. Built-in modal selectors such as model and session pickers are outside the editor extension API and remain unchanged.

### Clipboard images

Ctrl+V and Ctrl+Shift+V both invoke Pi's image-or-text clipboard paste action when the terminal forwards the chord. Pasting an image inserts a short `[image N]` marker at the cursor and shows its source path in a full-width, non-capturing overlay above the prompt. Deleting any character inside a marker removes that marker and leaves the cursor where it was. Multiple paths stack vertically, and the overlay yields to autocomplete descriptions.

Kitty image rendering is intentionally disabled, including under Scribe, so proper-base never changes terminal image capabilities. On submit, every intact marker expands back to its source path before Pi's handler and prompt-history recorder receive it; agents therefore see the usable image path rather than the display-only marker.

### Model image context

Images remain available throughout the user turn that introduced them, including every follow-up model call while tools run. Once a newer user message begins, proper-base replaces image blocks from earlier turns with a short text marker in the outbound context. The saved session remains unchanged, so transcript rendering, export, resume, and branching retain the original images.

This prevents old image bytes from being resent on every later turn. Re-read or resend an earlier image when the model needs to inspect it again.

### Prompt-template display

Pi expands file-based prompt templates before creating the user session message. proper-base keeps that expansion for the model but renders the exact slash invocation in the user transcript instead. `/implement-ready epic-1 4` therefore stays `/implement-ready epic-1 4`; it never becomes the full orchestration template on screen.

The display mapping persists as a small hash-to-command custom entry, so reload, resume, and fork preserve the raw command without storing a second copy of the expanded body. Plain prompts and model context are unchanged.

### Prompt history

Every recallable prompt is recorded when you submit it. On `session_start`, the editor is seeded only from the private raw-input store at `~/.pi/agent/proper-history/--<cwd>--.jsonl`.

Pi session messages are deliberately never used as history. Pi persists expanded skill bodies and prompt-template bodies there, not the slash command the user typed. proper-base also blocks Pi's startup replay from adding those transformed messages to the editor. The first press of Up therefore returns raw user input, with the cursor at its beginning.

### Why a store is needed

The editor's `onSubmit` is the only source that sees the exact outgoing text before Pi expands skills and prompt templates. Pi's `input` event fires too late for built-in and extension commands, while session messages contain transformed model input. The private store records the trusted pre-expansion text immediately.

### Details worth knowing

- Scope is the working directory, matching how pi already buckets sessions. Two projects never see each other's prompts.
- Pi's startup history replay is ignored; only entries captured by proper-base's submit recorder can enter history.
- Duplicates collapse onto their most recent timestamp, so a prompt you run often stays near the top instead of filling the list.
- Skill and prompt-template invocations remain exactly as submitted, such as `/skill:unslop clean this up` or `/implement-ready task-name`.
- 200 prompts is the cap.
- A damaged store line is skipped instead of breaking startup.

### The store

Append-only JSONL, one file per project, created `0600` inside a `0700` directory. Concurrent pi sessions in the same project append to the same file, so entries are written one small line at a time and never rewritten in place.

Only the last 512 KB is read at startup, so a store that has grown for months costs nothing. Past 2 MB it is trimmed to the newest 2000 entries by writing a temporary file and renaming it.

Prompts over 4096 characters are skipped rather than truncated. A truncated command that looks complete is dangerous to submit again.

Delete the file to forget a project's history. Nothing else depends on it.

## Composing with other editor extensions

The extension wraps whatever editor factory is already installed rather than replacing it, so it works alongside extensions that customise the editor. Autocomplete details activate when that editor exposes pi's autocomplete list and otherwise leave its rendering unchanged. The overlay does not capture keyboard focus and is removed when the editor or selected description disappears, so invisible entries cannot block Pi from switching TUI modes. Re-entry is handled too. `session_start` fires again on reload, resume, and fork, and the wrapper unwraps its own previous install instead of stacking a new layer on it.

Load order still matters for keybindings. If another extension replaces the editor after this one, its editor is the one that renders.

The footer decorator wraps pi's existing `FooterComponent` rather than rebuilding it, preserving all native statistics and extension statuses. A custom footer is not modified.

## Development

Tests use built-in `node:test` with no test framework. Package-local dev dependencies provide pi and Node types for diagnostics; Node 23 or newer runs the TypeScript directly.

```bash
npm test
npm run typecheck
npm run test:coverage
```

`src/history.ts` and `src/recorder.ts` import nothing from pi, so they are testable on their own. `src/store.ts` runs against a temp directory rather than a mocked filesystem. Footer and autocomplete fixtures exercise their editor/TUI integration through small fakes. `index.ts` is the pi wiring.

## Alternatives

- [`pi-input-history`](https://www.npmjs.com/package/pi-input-history) also seeds from sessions in the cwd and adds a Ctrl+R fuzzy reverse search. Reading session messages can surface expanded skill and prompt-template bodies instead of raw user input; proper-base deliberately refuses that source.
- [`pi-history`](https://www.npmjs.com/package/pi-history) keeps its own append store, which survives session deletion, and offers a global scope plus ghost completion.
- [`@zigai/pi-prompt-history`](https://www.npmjs.com/package/@zigai/pi-prompt-history) restores current-session history only, deliberately isolated from other sessions in the same project.

## License

MIT
