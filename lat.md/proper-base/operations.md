# Runtime operations

Operating proper-base requires a compatible pi runtime and a package registration; it has no service, credential, or build dependency.

## Package identity and installation

The repository directory, extension identity, and public npm package are all named `proper-base`.

Pi's compact startup list derives a local package label from its configured source path, so the directory and npm names match the `proper-base` startup label. The prior local directory was `proper-customs` and its unpublished manifest identity was `pi-proper-customs`; both are superseded by `proper-base`. The former npm package `pi-proper-history` remains a separate history-only release.

Install the published package with `pi install npm:proper-base`, or install this checkout with `pi install /path/to/proper-pi-extensions/proper-base`. Replace settings entries pointing at `proper-customs`, the former standalone `proper-history`, or repository `proper-history` paths so Pi loads only the renamed package.

`package.json` registers `index.ts` through `pi.extensions`, uses the `pi-package` discovery keyword, limits the tarball to runtime source and documentation, and points npm metadata at the `proper-base` monorepo directory. Its public-registry publish configuration and `prepack` test-plus-typecheck gate apply to npm tarballs and publishes.

Runtime `Symbol.for` keys and private process links retain their `pi-proper-base` namespace so existing reload guards and clickable transcript targets stay compatible; that internal namespace is not the npm package name.

Releases run from the repository root with `./tools/release-me/release.sh bump <major|minor|patch> proper-base`. The script commits the manifest version and creates `proper-base-vMAJOR.MINOR.PATCH`; [[lat#Package releases]] verifies and publishes that exact tarball through npm trusted publishing.

## User settings boundary

proper-base does not write Pi settings during package installation or runtime, and its npm package has no install-time scripts; only the `prepack` validation gate remains.

The complete environment setup in [PI_SETUP.md](../../PI_SETUP.md) asks the setup agent to merge `subagents.agentOverrides.worker.defaultContext: fresh` when no worker override exists. Existing worker overrides remain user-owned because they may deliberately select forked context.

Fresh worker context avoids replaying the parent transcript and its token cost for self-contained tasks. Current pi-subagents versions sanitize signed Anthropic thinking blocks in forked sessions, so this preference is setup policy rather than a proper-base correctness dependency.

## Runtime requirements

Node 22.19 or newer and the Pi coding-agent peer API are required.

Kitty previews use the declared `sharp` 0.35.3 runtime dependency when a source exceeds the 24-by-6-cell pixel envelope. `sharp` requires Node 20.9+ and publishes prebuilt binaries for macOS arm64, macOS x64 10.15+, and supported glibc/musl Linux targets; proper-base's Node 22.19+ floor satisfies its runtime contract. The package lock retains both Darwin architecture artifacts plus their matching libvips packages, so npm selects the host artifact during production installation. Conversion runs asynchronously with a five-second pipeline timeout; failure leaves the safe marker-and-path text fallback instead of sending the full source image.

The extension uses `CustomEditor`, `SessionManager`, `getAgentDir`, session lifecycle events, editor factory APIs, pi-tui overlays and wrapping, and ANSI truecolor footer decoration. The Pi host supplies both imported core packages through `peerDependencies` with `*` ranges, while package-local dev dependencies pin Pi, pi-tui, TypeScript, and Node types for diagnostics. The dev pins also carry `@earendil-works/pi-server`: Pi 0.85.0's package root imports it from `dist/experimental/server.js` without declaring the dependency (upstream issues 9132, 9140, 9171, 9173), so a bare `import "@earendil-works/pi-coding-agent"` fails in a fresh checkout without it. The live Pi CLI is unaffected because its bundled loader serves extension imports from in-memory virtual modules; only tests and typechecks that load the SDK entry need the extra pin, and it can be dropped once upstream declares the dependency. Tests use Node's built-in runner.

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
