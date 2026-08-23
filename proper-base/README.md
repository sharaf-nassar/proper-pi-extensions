# proper-base

Baseline [Pi](https://pi.dev) behavior for quieter transcripts, automatic
session titles, model-preserving `/clear`, project prompt history, prompt
editing, fullscreen navigation, image handling, cancellation, autocomplete,
and footer layout.

## User-facing features

### Sessions and transcript

- Completed tools and errors collapse into separate one-line rows after a run
  settles. Click one row to expand it, use its `collapse` control to close it,
  or use Pi's normal tool-output shortcut, Ctrl+O by default, for all rows.
  Settlement resets Pi's global tool-output state to collapsed. Thoughts,
  tool-calling text, direct replies, and agent status updates remain fully
  visible and in their original order.
- A fresh unnamed session gets a hidden 3 to 7 word title from the first
  successful assistant response. Existing, resumed, and already-named sessions
  keep their names.
- `/clear` starts an empty session but restores the exact provider and model
  selected in the previous one. No messages, name, or branch state carry over.
- Prompt-template expansions remain model-facing, while the transcript shows
  the slash command you typed, such as `/implement-ready epic-1 4`.
- CLIProxyAPI `empty_stream` failures become normal retryable network errors, so
  Pi applies its existing retry budget and backoff.

### Prompt editing and cancellation

| Input | Behavior |
| --- | --- |
| Shift+Enter or Alt+Enter | Insert a newline. Alt+Enter no longer queues a follow-up. |
| Home | Move to the current visible-row start, then the full prompt start. |
| End | Move to the current logical-line end, then the full prompt end. |
| Ctrl+C with text | Clear the prompt without arming exit. |
| Ctrl+C on an empty prompt | Show `Press Ctrl+C again to exit`; repeat within 500 ms to quit. |
| Esc before assistant work starts | Restore the submitted prompt and remove that turn from the active branch. |
| Esc after assistant work starts | Keep Pi's normal abort behavior. |

Dismissing an `ask_user_question` dialog with Esc aborts the run instead of
spending another model turn acknowledging the dismissal. Tool or host failures
still reach the model so it can ask in plain text.

### Project prompt history

proper-base records eligible editor submissions on a best-effort basis, not
transformed Pi session messages. History uses an encoded key derived from the
current working directory.

- Up and Down recall prompts from previous sessions in the same project.
- Ctrl+R starts case-sensitive reverse substring search. Press Ctrl+R again for
  an older match, Backspace or Shift+Backspace to broaden the query, Enter to
  submit, Esc to keep the match for editing, or Ctrl+G to restore the original
  draft.
- Prompt templates and skills remain in their submitted slash form.
- Built-in and extension UI commands such as `/model`, `/new`, and
  `/llm-router-config` are not recallable.
- Duplicate prompts keep their newest timestamp. The editor receives at most
  200 entries.

History lives under `~/.pi/agent/proper-history/`. One private JSONL file is
created per encoded working-directory key. Unusual paths that produce the same
hyphen encoding can share a file. Prompts over 4096 characters are skipped
rather than truncated. Startup reads only the newest 512 KiB; stores above
2 MiB compact to the newest 2000 valid entries. A concurrent append during that
rare compaction can lose one entry. Delete one file to forget one key, or the
directory to forget all proper-base history.

### Autocomplete

- The selected autocomplete description appears in a non-capturing bordered
  panel above the prompt without moving the editor, list, or footer.
- Slash-command completion works after whitespace and on later prompt lines.
  It replaces only the active slash segment and ignores slashes inside paths
  and URLs.
- `/model ` results sort by displayed model ID in descending numeric-aware
  order. Typed terms must all match when strict matches exist.
- Enter or Tab switches immediately only when the complete prompt is a
  single-line `/model ...` command. Inline and multiline slash segments only
  receive the completion. Tab keeps its normal behavior elsewhere.

### Fullscreen navigation and selection

Enable Pi's native fullscreen mode with `/settings` or:

```json
{
  "tuiMode": "fullscreen"
}
```

proper-base keeps the prompt, queued messages, status, widgets, and footer
pinned while Pi scrolls the transcript above them.

| Input | Behavior in fullscreen mode |
| --- | --- |
| Home, End, PageUp, PageDown | Stay assigned to the prompt editor. |
| Ctrl+Shift+Home or End | Jump the transcript to its top or bottom. |
| Ctrl+Shift+PageUp or PageDown | Scroll the transcript by one page. |
| Double-click | Select a complete one-line URL, path, flag, qualified identifier, or quoted value when possible. |

Scrolling away from current output adds a `↓ jump to bottom` row above the
prompt. Clicking it returns to the newest output without disabling scrollbar
dragging.

### Clipboard and model image context

Ctrl+V and Ctrl+Shift+V both use Pi's image-or-text clipboard action. Readable
clipboard image paths appear as short `[image N]` markers, while a text-only
panel shows their source paths. Deleting inside a marker removes the whole
marker. On submit, each marker expands back to the path the agent can read.

proper-base never enables Kitty rendering or changes terminal image
capabilities. Images remain in model context for every tool loop in the turn
that introduced them. A later user message replaces older image blocks only in
the outbound context copy, so saved sessions, exports, resumes, and branches
retain the originals.

### Footer

The built-in footer keeps path, branch, cumulative input, output, cache, cost,
context use, model, and thinking effort visible in two compact rows. Stable
colors separate the metrics; context changes color above 70% and 90%.
Supported `max` and router-provided `ultra` effort levels use a slow rainbow
highlight. Custom replacement footers are not changed.

## Install

Node 22.19 or newer is required. The package is tested against Pi 0.84.2.

From npm:

```bash
pi install npm:proper-base
```

From a local checkout:

```bash
pi install /path/to/proper-pi-extensions/proper-base
```

Pi supplies the core `@earendil-works/pi-coding-agent` and
`@earendil-works/pi-tui` peer packages. The package has no runtime
dependencies, no build step, and no install-time npm scripts, and it does
not modify Pi settings during installation or runtime. `npm install` only
prepares the development checks below.

This package replaces the former local `proper-customs` identity. Keep only one
registration. Existing data under the legacy `proper-history` path remains
compatible.

## Compatibility

- Fullscreen behavior uses Pi's native `tuiMode: "fullscreen"` renderer.
- Questionnaire cancellation activates only when `ask_user_question` is
  installed.
- Editor and footer wrappers compose with existing providers when their Pi
  interfaces are compatible. Private Pi TUI changes or custom renderers may
  disable individual enhancements; later-loaded replacements still win.
- Ctrl+Shift fullscreen keys require a terminal that reports modifiers
  distinctly.
- proper-base has no extension-specific runtime config file or feature toggles.
- Slash commands beginning with `__proper-` are reserved for internal session
  recovery.

## Development

```bash
npm install
npm test
npm run typecheck
npm run test:coverage
npm pack --dry-run
npm publish --dry-run
```

`prepack` runs tests and strict type checking before a tarball or publish. Tests
use Node's built-in runner. There is no build step.

## License

MIT
