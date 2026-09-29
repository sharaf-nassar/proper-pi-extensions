# Runtime operations

Operating llm-router requires Pi registration, a virtual placeholder model, and authenticated judge and execution models; CPA quota management is optional.

## Installation contract

The repository directory and public npm package are both named `proper-llm-router`.

Install the published package with `pi install npm:proper-llm-router`, or install the checkout with `pi install /path/to/proper-pi-extensions/proper-llm-router`. The manifest registers `llm-router.ts`, limits the tarball to runtime source, the exemplar corpus, user documentation, and required license notices, and declares Pi's coding-agent, pi-ai, and TUI APIs as host-supplied peers. Coding-agent and pi-ai require 0.99.1 or newer, the first release with the virtual-model API and a built-in catalog listing every default model in [[models#Arm catalog]].

Remove any former direct `extensions` entry for `llm-router.ts` so only one package source loads. The extension factory self-registers `llm-router/auto` through `pi.registerVirtualModel()`, so installation needs no `~/.pi/agent/models.json` edit and no credentials. Pi refuses a virtual model whose ID a physical model of the same provider already uses, so earlier installs' manual `llm-router/auto` entry in Pi's `models.json` would block registration. The factory therefore removes that model from the agent directory's `models.json`, dropping the `llm-router` provider when nothing else remains, with an atomic rename. Pi read the file before the factory ran, so after a removal registration waits for `session_start`, which reloads that provider from disk, registers the virtual model, reselects it when the session held the stale physical entry, and reports the cleanup once. A missing file is ignored, and a file with comments or invalid JSON is left untouched, so Pi's conflict error remains and the entry must be removed by hand.

The model IDs named in [[models]], the configured fallback, and active override targets must resolve among Pi's authenticated models. Values may use unqualified IDs or explicit `provider/model-id`; CPA remains the preferred provider for duplicate unqualified IDs.

There is no build step. Pi loads the TypeScript source directly, while Node uses experimental type stripping for tests. `package.json` follows latest Pi coding-agent, pi-ai, and TUI development packages, while `package-lock.json` records resolved test versions. TypeScript and Node declarations remain pinned for strict no-emit diagnostics; the temporary `@earendil-works/pi-server` pin that Pi 0.85.0's package root needed is gone since 0.85.1 (see the dependency note in `../proper-base/operations.md`). All three Pi packages remain peer dependencies at runtime so the host supplies one compatible instance. Package `prepack`, unit tests, type checking, and the standalone smoke are offline.

Releases run from the repository root with `./tools/release-me/release.sh bump <major|minor|patch> proper-llm-router`. The script commits the manifest version and creates `proper-llm-router-vMAJOR.MINOR.PATCH`; [[lat#Package releases]] verifies and publishes that exact tarball through npm trusted publishing after the maintainer-authenticated initial release establishes the package.

## Repository agent tooling

Repository-local agent configuration keeps task context and lat.md workflow consistent across supported clients.

The repository root owns shared agent instructions, hooks, Beads state, and the cross-package `lat.md/` tree. This package has its own `AGENTS.md`, with `CLAUDE.md` symlinked to it, so extension guidance stays local without drifting between clients.

`.claude/settings.json` runs `bd prime --hook-json` on session start. It also invokes `lat hook claude UserPromptSubmit` before prompts and `lat hook claude Stop` when a Claude session stops.

Both `.mcp.json` and `.codex/config.toml` expose `lat mcp`; the Codex configuration also enables hooks. `.gitignore` excludes `.pi`, `node_modules/`, generated lat cache, and local Beads or Dolt state from version control.

## Runtime compatibility

The runtime requires global `fetch`, `AbortController`, `AbortSignal.any`, and `AbortSignal.timeout`; the smoke command also requires Node's experimental TypeScript type stripping.

Pi 0.85.1 does not define `ultra` in its built-in thinking-level list. During module load, proper-llm-router imports pi's public `AgentSession` and `Theme` exports through the bare `@earendil-works/pi-coding-agent` specifier and patches those prototypes. The extension loader resolves that specifier to the running host tree in both layouts — a jiti alias on unbundled entries and virtual modules under the bundled npm `dist/bundle/cli.js` bin — so the patch lands on the classes the live process uses; the former CLI-entrypoint dist probe found no `core/` beside the bundled bin and silently skipped `ultra` on standard npm installs. The patch appends `ultra` only when the active model has a non-empty `thinkingLevelMap.ultra`, uses the existing maximum border color, clamps `ultra` to the next model's highest available level when unsupported, and uses global symbols so `/reload` cannot stack wrappers. This gives Shift+Tab and pi's native thinking selector the extra level without modifying the installed pi package. If the exports or their thinking-level patch points are missing, routing still works but `ultra` is not added to native controls.

Three pi APIs degrade by feature detection. Without `onTerminalInput`, Esc cannot cancel judging. Without `ui.custom`, management-key input uses a visible editor. Without `setThinkingLevel`, command pins still switch models but leave thinking effort unchanged. Custom TUI components implement the required `invalidate()` method for the installed pi API.

## Network endpoints

The router has one Pi judge contract plus optional CPA management contracts.

- Pi's `modelRegistry.complete()` returns a strict `route_model` tool call for the authenticated judge model.
- Pi's authenticated model snapshot supplies judge choices and execution targets; provider extensions own discovery, credentials, endpoints, and catalogue refresh policy. A provider may serve that snapshot from a cache, so it reflects configured authentication rather than live capacity.
- `<cpaBase>/v0/management/auth-files` lists credentials for optional usage probes.
- `<cpaBase>/v0/management/api-call` proxies upstream Claude and Codex usage requests.

Judging and execution switching always use Pi's registry. The router never reads or stores provider API keys. Non-CPA targets make no CPA management request.

## Transport and timeout behavior

Management network calls use bounded JSON requests and treat non-2xx responses as failures before parsing the body.

Judge attempts use Pi's provider runtime with a 60-second timeout and may run twice. CPA management requests use a 10-second timeout and are not retried. Their failure skips only the optional quota gate, as defined by [[availability#Failure policy]].

## Environment controls

Environment variables provide credentials and test controls.

| Variable | Effect |
| --- | --- |
| variable named by `cpaManagementKeyEnv` | management-key fallback when the config value is empty |
| `LLM_ROUTER_OFF=1` | same effect as `"enabled": false` in the config file: stops startup from forcing `llm-router/auto` and omits sentinel help; explicit selection of `auto` can still route; pinned workflow commands run unrouted without prompting |
| `LLM_ROUTER_ON=1` | overrides both `LLM_ROUTER_OFF` and a disabled config file for one process tree; set by the config menu's session switch and inherited by spawned children |
| `JUDGE_EXEMPLARS=0` | disables exemplar retrieval |
| `CPA_SIMULATE_UNAVAILABLE` | comma-separated exact arm keys treated as down |
| `PI_SUBAGENT_CHILD` | identifies child sessions for sentinel-help suppression |
| `PI_SUBAGENT_FANOUT_CHILD` | keeps sentinel help in children allowed to spawn |

Neither `LLM_ROUTER_OFF` nor the config flag is an input-handler kill switch. They prevent automatic activation; a session already on `llm-router/auto` still meets the routing condition. The combined rule is defined in [[configuration#Routing switch]].

Routing state stays an infrastructure concern: when routing is inactive, a pinned workflow command simply runs unrouted with no dialog, since disabling the router is a deliberate choice. Prompts and models never probe the environment or the system prompt for routing state.

## Placeholder safety

`llm-router/auto` is a Pi virtual model that never reaches a provider; a request that still arrives there runs on `fallbackModel`.

The extension switches the session to a real model before the agent loop on a pinned, forced, judged, or fallback path. Extension-origin messages from `sendUserMessage()` follow the same routing path, so command aliases leave the placeholder too. The session therefore normally never sends a request while `llm-router/auto` is selected.

Some requests have no input event to route: a custom message that triggers a turn, a compaction summary, or an extension's direct registry call. Pi then asks the virtual model's router, which returns the authenticated `fallbackModel` at the selected thinking level without switching the session. The placeholder offers every Pi thinking level through `max` so that level passes through; `ultra` is not offered because Pi builds virtual models from its own level list.

When the fallback does not resolve, the router throws and Pi ends that request with a named error response rather than contacting any endpoint. The judged path also reports an error when neither the verdict's effective target nor the fallback resolves; trivial input returns silently and its request meets the same named error. The registry-lookup section in `routing.md` covers the dated-ID tolerance applied before declaring a model absent.

Automatic startup activation fails silently when `llm-router/auto` is absent: the session stays on its current model and no routing occurs. Self-registration makes this state reachable only when registration failed, for example against a conflicting manual entry. The `/llm-router` command performs the same lookup interactively and reports the missing placeholder.

## User notices

Notices expose routing state without opening logs.

Green indicates an active judge request. Cyan identifies a clean direct or judged selection. Amber marks swaps, skipped quota checks, unknown sentinels, and cancellation. Errors report judge failure, registry failure, or configuration-test failure.

A normal judged notice includes the final model, optional swap origin, optional override source slot, optional skipped-gate warning, elapsed seconds, and a truncated rationale. A pinned-command notice includes the final arm, optional `@effort`, a pinned label, and any quota swap or skipped-check suffix.

A successful verdict notice names the resolved `provider/model-id`. If that target disappears or cannot be selected, the handler tries `fallbackModel` before reporting that no switchable model exists.

## Sensitive data and prompt scope

Judge and execution credentials stay inside Pi's provider runtime and are never read by llm-router. A separate CPA management key entered through the UI is stored as plaintext JSON only for optional quota probes.

The judge receives the first 4,000 characters of task text. Exemplar retrieval inspects the complete task locally and may add short excerpts from matching corpus prompts to the judge's system message. Image contents are not sent to the routing judge by this extension.

## Smoke command

Run the package harness from `proper-llm-router/` with an optional task string.

```bash
npm run typecheck
npm run test:unit
npm run test:smoke -- ["task text"]
npm run test:coverage
```

Unit fixtures, strict diagnostics, and the standalone smoke are offline. They inject authenticated model snapshots and judge runners where Pi would supply them, and they keep quota-management HTTP behind focused stubs. Coverage applies repository floors to unit tests.
