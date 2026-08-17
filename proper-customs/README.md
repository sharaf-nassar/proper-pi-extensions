# proper-customs

Custom behavior for [pi](https://pi.dev): cross-session prompt history, richer autocomplete descriptions, fullscreen-friendly scrolling, and a color-coded footer.

pi's Up/Down history covers the current session only. Start a new session in a project you have worked in for weeks and the editor history is empty. This extension seeds it with the prompts you typed in the other sessions recorded for the same working directory.

## Install

From this repository checkout:

```bash
pi install /path/to/proper-pi-extensions/proper-customs
```

The former history-only package remains available as `npm:pi-proper-history`. Existing recorded history remains compatible.

## Behaviour

### Pinned scrolling

Pi's native `fullscreen` TUI keeps queued messages, status, widgets, the prompt, and the footer pinned to the bottom while the transcript scrolls above them. Enable **TUI mode → fullscreen** in `/settings`, or set `"tuiMode": "fullscreen"` in `~/.pi/agent/settings.json`.

proper-customs does not duplicate Pi's transcript renderer. It removes inactive autocomplete detail overlays from Pi's overlay stack so switching between regular and fullscreen modes remains available.

In fullscreen mode, Home, End, PageUp, and PageDown move within the prompt editor. Hold Shift with those keys to move the transcript above it: Shift+Home/End jump to the top/bottom, and Shift+PageUp/PageDown scroll by a page. Unrelated custom keybindings are preserved.

### Footer colors

The built-in footer shows the active model in purple. Thinking effort uses pi's semantic color ramp: muted for off and minimal, blue through cyan for low and medium, then lavender and bright purple for high and xhigh. `max` and the router-provided `ultra` level become rainbow text with a slow four-second highlight sweep.

The animation requests a lightweight redraw every 120 ms only while `max` or `ultra` is visible, and stops when effort changes or the footer is unmounted. Footer text, spacing, token statistics, provider labels, and truncation remain pi's own. Custom replacement footers are left unchanged.

### Autocomplete descriptions

When editor autocomplete is open, the selected item's description appears in a bordered, non-capturing overlay immediately above the prompt. The box expands upward over terminal history, so changing selections never moves the prompt, autocomplete list, or footer. Text wraps to the terminal width and uses all rows available above the prompt before adding an ellipsis.

This covers skills, slash commands, and other editor autocomplete providers that supply descriptions. Built-in modal selectors such as model and session pickers are outside the editor extension API and remain unchanged.

### Prompt history

Every prompt is recorded the moment you submit it, and the editor is seeded on `session_start` from two sources merged by timestamp:

1. **pi's session files** for the current cwd, which cover history from before you installed this and survive if the store is deleted.
2. **A recorded store** at `~/.pi/agent/proper-history/--<cwd>--.jsonl`, which covers sessions pi never wrote to disk.

The first press of Up gives your most recent prompt, whichever session you typed it in.

### Why a store is needed

pi does not create a session file until the session receives its first assistant message. From `session-manager.js`:

```js
const hasAssistant = this.fileEntries.some(
    (e) => e.type === "message" && e.message.role === "assistant");
if (!hasAssistant) { /* nothing reaches disk */ }
```

This is deliberate, so that opening pi and quitting does not litter `/resume` with empty sessions. The side effect is that a session spent entirely on slash commands leaves no trace. Reading session files alone would lose all of it.

Recording happens on the editor's `onSubmit`, which is the only hook that sees everything. pi's `input` event fires after built-in commands return and after extension commands are dispatched, so `/resume` and `/piolium-help` never reach it.

### Details worth knowing

- Scope is the working directory, matching how pi already buckets sessions. Two projects never see each other's prompts.
- Prompts pi seeds itself from the live session are excluded, so `/resume` does not list everything twice.
- Duplicates collapse onto their most recent timestamp, so a prompt you run often stays near the top instead of filling the list.
- Skill invocations are unwrapped to the prompt you typed. pi stores those as a `<skill>` block wrapping the whole skill body, and recalling that blob is useless.
- 200 prompts is the cap. Sessions are read newest first and reading stops once the cap is met, so a project with hundreds of sessions does not pay to parse all of them at startup.
- A damaged session file or store line is skipped instead of breaking startup.

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
npx tsc
```

`src/history.ts` and `src/recorder.ts` import nothing from pi, so they are testable on their own. `src/store.ts` runs against a temp directory rather than a mocked filesystem. Footer and autocomplete fixtures exercise their editor/TUI integration through small fakes. `index.ts` is the pi wiring.

## Alternatives

- [`pi-input-history`](https://www.npmjs.com/package/pi-input-history) also seeds from sessions in the cwd and adds a Ctrl+R fuzzy reverse search. It reads session files only, so it loses everything pi does not persist. It also does not exclude the live session or unwrap skill blocks, and its editor wrapper stacks on repeated `session_start`.
- [`pi-history`](https://www.npmjs.com/package/pi-history) keeps its own append store, which survives session deletion, and offers a global scope plus ghost completion.
- [`@zigai/pi-prompt-history`](https://www.npmjs.com/package/@zigai/pi-prompt-history) restores current-session history only, deliberately isolated from other sessions in the same project.

## License

MIT
