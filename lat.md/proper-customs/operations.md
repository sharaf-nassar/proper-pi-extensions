# Runtime operations

Operating proper-customs requires a compatible pi runtime and a package registration; it has no service, credential, or build dependency.

## Package identity and installation

The repository directory and extension identity are `proper-customs`; the package manifest is named `pi-proper-customs`.

Pi's compact startup list derives a local package label from its configured source path, so the directory name matches the `proper-customs` startup label. The former npm package `pi-proper-history` remains a separate history-only release.

Install this checkout with `pi install /path/to/proper-pi-extensions/proper-customs`. Replace local sources pointing at the former standalone or repository `proper-history` paths so pi loads only the renamed package. `package.json` registers `index.ts` through its `pi.extensions` manifest.

## Runtime requirements

Node 22 or newer and the pi coding-agent peer API are required.

The extension uses `CustomEditor`, `SessionManager`, `getAgentDir`, session lifecycle events, editor factory APIs, pi-tui overlays and wrapping, and ANSI truecolor footer decoration. `@earendil-works/pi-tui` is a runtime dependency; package-local dev dependencies pin pi and Node types for diagnostics. Tests use Node's built-in runner.

Pinned prompt scrolling uses pi's native `fullscreen` TUI mode. Users enable it through `/settings` or `tuiMode` in `~/.pi/agent/settings.json`; proper-customs does not replace the transcript renderer. Shift-modified Home, End, PageUp, and PageDown require a terminal that reports modifiers distinctly through Kitty keyboard protocol or compatible legacy sequences.

## Validation

Run the package tests from `proper-customs/`.

```bash
npm test
npx tsc
```

The test command runs every `test/*.test.ts` file through `node:test`. The TypeScript command uses the package's no-emit diagnostic configuration.

## Data lifecycle

Recorded history is local agent state, not repository data.

One JSONL file exists per project under `~/.pi/agent/proper-history/`. The legacy path is retained so the rename does not discard recorded prompts. Removing a file forgets that store without modifying pi sessions; removing the directory forgets all recorded history stores.
