# Runtime operations

Operating proper-base requires a compatible pi runtime and a package registration; it has no service, credential, or build dependency.

## Package identity and installation

The repository directory, extension identity, and public npm package are all named `proper-base`.

Pi's compact startup list derives a local package label from its configured source path, so the directory and npm names match the `proper-base` startup label. The prior local directory was `proper-customs` and its unpublished manifest identity was `pi-proper-customs`; both are superseded by `proper-base`. The former npm package `pi-proper-history` remains a separate history-only release.

Install the published package with `pi install npm:proper-base`, or install this checkout with `pi install /path/to/proper-pi-extensions/proper-base`. Replace settings entries pointing at `proper-customs`, the former standalone `proper-history`, or repository `proper-history` paths so Pi loads only the renamed package.

`package.json` registers `index.ts` through `pi.extensions`, uses the `pi-package` discovery keyword, limits the tarball to runtime source and documentation, and points npm metadata at the `proper-base` monorepo directory. Its public-registry publish configuration and `prepack` test-plus-typecheck gate apply to npm tarballs and publishes.

Runtime `Symbol.for` keys and private process links retain their `pi-proper-base` namespace so existing reload guards and clickable transcript targets stay compatible; that internal namespace is not the npm package name.

## Seeded user settings

Pi has no package install hook, so a default that another extension reads only from `~/.pi/agent/settings.json` is written by the npm `postinstall` script. No session ever writes it.

One default is seeded: `subagents.agentOverrides.worker.defaultContext` becomes `fresh`. pi-subagents ships its packaged `worker` agent with `defaultContext: fork`, which replays the parent transcript into every child; when the router resolves a child to the parent's own provider, api, and model, pi keeps the inherited signed thinking blocks and Anthropic rejects the request. Forked workers also carry the parent's whole token cost for a task whose prompt already states everything it needs.

Pi installs npm sources with scripts enabled and runs `npm install` inside a cloned git source, so both fire the hook. A local path is only recorded in settings, so that checkout seeds when its own `npm install` runs. The target directory comes from `PI_CODING_AGENT_DIR` and falls back to `~/.pi/agent`, matching pi's own resolution.

Seeding is skipped whenever a `worker` key already exists under `subagents.agentOverrides`, regardless of its value, so a deliberate `fork` is never reverted. A missing or unparseable settings file is left untouched rather than replaced, and every other key is preserved because the file is re-read, merged, and renamed into place. Pi merges only its own modified fields when it saves, so an added key survives later settings writes. A write that fails prints a warning and still exits zero: a convenience default must not fail an install.

## Runtime requirements

Node 22.19 or newer and the Pi coding-agent peer API are required.

The extension uses `CustomEditor`, `SessionManager`, `getAgentDir`, session lifecycle events, editor factory APIs, pi-tui overlays and wrapping, and ANSI truecolor footer decoration. The Pi host supplies both imported core packages through `peerDependencies` with `*` ranges, while package-local dev dependencies pin Pi, pi-tui, TypeScript, and Node types for diagnostics. Tests use Node's built-in runner.

Pinned prompt scrolling uses pi's native `fullscreen` TUI mode. Users enable it through `/settings` or `tuiMode` in `~/.pi/agent/settings.json`; proper-base does not replace the transcript renderer. Ctrl+Shift-modified Home, End, PageUp, and PageDown require a terminal that reports modifiers distinctly through Kitty keyboard protocol or compatible xterm sequences.

## Validation

Run the package tests from `proper-base/`.

```bash
npm test
npm run typecheck
npm run test:coverage
npm pack --dry-run
npm publish --dry-run
```

The test command runs every `test/*.test.ts` file through `node:test`. Type checking uses the package's no-emit strict configuration. Coverage enforces the repository's current line, branch, and function floors. `prepack` reruns tests and type checking before npm packs or publishes.

## Data lifecycle

Recorded history is local agent state, not repository data.

One JSONL file exists per project under `~/.pi/agent/proper-history/`. The legacy path is retained so the rename does not discard recorded prompts. Removing a file forgets that store without modifying pi sessions; removing the directory forgets all recorded history stores.
