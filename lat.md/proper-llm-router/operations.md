# Runtime operations

Operating llm-router requires Pi registration, a placeholder provider, authenticated execution models, and a configured judge; CPA is optional.

## Installation contract

The repository directory and public npm package are both named `proper-llm-router`.

Install the published package with `pi install npm:proper-llm-router`, or install the checkout with `pi install /path/to/proper-pi-extensions/proper-llm-router`. The manifest registers `llm-router.ts`, limits the tarball to runtime source, the exemplar corpus, user documentation, and required license notices, and declares Pi's coding-agent and TUI APIs as host-supplied peers.

Remove any former direct `extensions` entry for `llm-router.ts` so only one package source loads. The extension factory self-registers provider `llm-router` with model `auto` through `pi.registerProvider()`, including a dead port-1 base URL and dummy key, so installation needs no `~/.pi/agent/models.json` edit. Hosts without `registerProvider` fall back to a manual `models.json` placeholder entry with dummy authentication; an existing manual entry composes with the registration and stays harmless.

The model IDs named in [[models]], the configured fallback, and active override targets must resolve among Pi's authenticated models. Values may use unqualified IDs or explicit `provider/model-id`; CPA remains the preferred provider for duplicate unqualified IDs.

There is no build step. Pi loads the TypeScript source directly, while Node uses experimental type stripping for tests. `package.json` and `package-lock.json` pin TypeScript, Node declarations, and development copies of the Pi coding-agent and TUI host packages for strict no-emit diagnostics. Both Pi packages remain peer dependencies at runtime so the host supplies one compatible instance. Package `prepack` runs offline unit tests and type checking; standalone live smoke still uses external CPA contracts.

Releases run from the repository root with `./tools/release-me/release.sh bump <major|minor|patch> proper-llm-router`. The script commits the manifest version and creates `proper-llm-router-vMAJOR.MINOR.PATCH`; [[lat#Package releases]] verifies and publishes that exact tarball through npm trusted publishing after the maintainer-authenticated initial release establishes the package.

## Repository agent tooling

Repository-local agent configuration keeps task context and lat.md workflow consistent across supported clients.

The repository root owns shared agent instructions, hooks, Beads state, and the cross-package `lat.md/` tree. This package has its own `AGENTS.md`, with `CLAUDE.md` symlinked to it, so extension guidance stays local without drifting between clients.

`.claude/settings.json` runs `bd prime --hook-json` on session start. It also invokes `lat hook claude UserPromptSubmit` before prompts and `lat hook claude Stop` when a Claude session stops.

Both `.mcp.json` and `.codex/config.toml` expose `lat mcp`; the Codex configuration also enables hooks. `.gitignore` excludes `.pi`, `node_modules/`, generated lat cache, and local Beads or Dolt state from version control.

## Runtime compatibility

The runtime requires global `fetch`, `AbortController`, `AbortSignal.any`, and `AbortSignal.timeout`; the smoke command also requires Node's experimental TypeScript type stripping.

Pi 0.84.2 does not define `ultra` in its built-in thinking-level list. During module load, proper-llm-router resolves the running pi CLI entrypoint and patches that host process's `AgentSession` and `Theme` prototypes. The patch appends `ultra` only when the active model has a non-empty `thinkingLevelMap.ultra`, uses the existing maximum border color, clamps `ultra` to the next model's highest available level when unsupported, and uses global symbols so `/reload` cannot stack wrappers. This gives Shift+Tab and pi's native thinking selector the extra level without modifying the installed pi package. If the host modules cannot be resolved, routing still works but `ultra` is not added to native controls.

Three pi APIs degrade by feature detection. Without `onTerminalInput`, Esc cannot cancel judging. Without `ui.custom`, management-key input uses a visible editor. Without `setThinkingLevel`, command pins still switch models but leave thinking effort unchanged. Custom TUI components implement the required `invalidate()` method for the installed pi API.

## Network endpoints

The router has one judge contract plus optional CPA contracts.

- Pi's `modelRegistry.complete()` returns a strict `route_model` tool call when the judge resolves to an authenticated Pi model.
- `<judge.baseUrl>/chat/completions` returns the strict JSON verdict for raw endpoint judging.
- `<judge.baseUrl>/models` populates the judge model picker while CPA mode is active.
- `<cpaBase>/v1/models` reports serving CPA model IDs when any routed target uses `cliproxyapi`.
- `<cpaBase>/v0/management/auth-files` lists credentials for usage probes.
- `<cpaBase>/v0/management/api-call` proxies upstream Claude and Codex usage requests.

Execution switching always uses Pi's registry. Non-CPA targets make no CPA request. Provider-qualified judge models use Pi's provider runtime; raw OpenAI-compatible judge endpoints remain supported.

## Transport and timeout behavior

Network calls use bounded JSON requests and treat non-2xx responses as failures before parsing the body.

Judge attempts have a 60-second timeout and may run twice. CPA requests use a 10-second timeout and are not retried. CPA catalog failure marks only CPA-backed targets unavailable, as defined by [[availability#Failure policy]].

## Environment controls

Environment variables provide credentials and test controls.

| Variable | Effect |
| --- | --- |
| variable named by `judge.apiKeyEnv` | bearer token for judge requests |
| variable named by `cpaKeyEnv` | bearer token for CPA model listing |
| variable named by `cpaManagementKeyEnv` | management-key fallback when the config value is empty |
| `LLM_ROUTER_OFF=1` | stops startup from forcing `llm-router/auto` and omits sentinel help; explicit selection of `auto` can still route; pinned workflow commands gate through a confirm dialog in dialog-capable sessions |
| `JUDGE_EXEMPLARS=0` | disables exemplar retrieval |
| `CPA_SIMULATE_UNAVAILABLE` | comma-separated exact arm keys treated as down |
| `PI_SUBAGENT_CHILD` | identifies child sessions for sentinel-help suppression |
| `PI_SUBAGENT_FANOUT_CHILD` | keeps sentinel help in children allowed to spawn |

`LLM_ROUTER_OFF` is not a global input-handler kill switch. It prevents automatic activation; a session already on `llm-router/auto` still meets the routing condition.

Routing state stays an infrastructure concern: when the variable is set and a pinned workflow command arrives in an interactive session, the extension shows a confirmation dialog — continuing runs the command unrouted, declining stops the input before the agent starts. Sessions without a dialog surface proceed unrouted. Prompts and models never probe the environment or the system prompt for routing state.

## Placeholder safety

`llm-router/auto` must never handle an inference request in a healthy setup.

The extension switches before the agent loop on a pinned, forced, judged, or fallback path. Extension-origin messages from `sendUserMessage()` follow the same routing path, so command aliases cannot reach the placeholder. Missing authenticated targets can still break this guarantee.

The judged path reports an error when neither the verdict's effective target nor the fallback resolves. An unpinned bare command returns silently instead, so a missing fallback entry leaves that prompt on the placeholder. The registry-lookup section in `routing.md` covers the dated-ID tolerance applied before declaring a model absent.

Automatic startup activation also fails silently when `llm-router/auto` is absent: the session stays on its current model and no routing occurs. Self-registration makes this state reachable only on hosts without `pi.registerProvider()` and no manual entry. The `/llm-router` command performs the same lookup interactively and reports the missing placeholder.

## User notices

Notices expose routing state without opening logs.

Green indicates an active judge request. Cyan identifies a clean direct or judged selection. Amber marks swaps, skipped quota checks, unknown sentinels, and cancellation. Errors report judge failure, registry failure, or configuration-test failure.

A normal judged notice includes the final model, optional swap origin, optional override source slot, optional skipped-gate warning, elapsed seconds, and a truncated rationale. A pinned-command notice includes the final arm, optional `@effort`, a pinned label, and any quota swap or skipped-check suffix.

A successful verdict notice names the resolved `provider/model-id`. If that target disappears or cannot be selected, the handler tries `fallbackModel` before reporting that no switchable model exists.

## Sensitive data and prompt scope

Raw judge and CPA credentials come from configured environment variables. Registry judge and execution credentials use Pi's provider runtime. A CPA management key entered through the UI is stored as plaintext JSON.

The judge receives the first 4,000 characters of task text. Exemplar retrieval inspects the complete task locally and may add short excerpts from matching corpus prompts to the judge's system message. Image contents are not sent to the routing judge by this extension.

## Smoke command

Run the package harness from `proper-llm-router/` with an optional task string.

```bash
npm run typecheck
npm run test:unit
npm run test:smoke -- ["task text"]
npm run test:coverage
```

Unit fixtures and strict diagnostics are offline, including a direct-provider route with no CPA network access. The standalone smoke runs deterministic assertions before one legacy live route and still needs configured judge and CPA services because it has no Pi registry context. Coverage applies repository floors to unit tests.
