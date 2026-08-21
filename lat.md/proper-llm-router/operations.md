# Runtime operations

Operating llm-router requires pi registration, a placeholder provider, switchable CPA models, and credentials for the configured endpoints.

## Installation contract

Pi loads `llm-router.ts` from the local `proper-llm-router` package.

Install the package directory with `pi install /path/to/proper-pi-extensions/proper-llm-router`; its `package.json` manifest registers the extension. Remove any former direct `extensions` entry for `llm-router.ts` so only the package source loads. Define provider `llm-router` with model `auto` in `~/.pi/agent/models.json`, and provide pi's required dummy authentication entry.

The CPA models named in the arm catalog in `models.md`, the configured fallback, and every active judge override target must also exist in pi's model registry under provider `cliproxyapi`.

There is no build step. Pi loads the TypeScript source directly, while Node uses experimental type stripping for tests. `package.json` and `package-lock.json` pin TypeScript, Node, and pi declarations for strict no-emit diagnostics; they do not produce runtime artifacts.

## Repository agent tooling

Repository-local agent configuration keeps task context and lat.md workflow consistent across supported clients.

The repository root owns shared agent instructions, hooks, Beads state, and the cross-package `lat.md/` tree. This package has its own `CLAUDE.md`, with `AGENTS.md` symlinked to it, so extension guidance stays local without drifting between clients.

`.claude/settings.json` runs `bd prime --hook-json` on session start. It also invokes `lat hook claude UserPromptSubmit` before prompts and `lat hook claude Stop` when a Claude session stops.

Both `.mcp.json` and `.codex/config.toml` expose `lat mcp`; the Codex configuration also enables hooks. `.gitignore` excludes `.pi`, `node_modules/`, generated lat cache, and local Beads or Dolt state from version control.

## Runtime compatibility

The runtime requires global `fetch`, `AbortController`, `AbortSignal.any`, and `AbortSignal.timeout`; the smoke command also requires Node's experimental TypeScript type stripping.

Pi 0.84.2 does not define `ultra` in its built-in thinking-level list. During module load, proper-llm-router resolves the running pi CLI entrypoint and patches that host process's `AgentSession` and `Theme` prototypes. The patch appends `ultra` only when the active model has a non-empty `thinkingLevelMap.ultra`, uses the existing maximum border color, clamps `ultra` to the next model's highest available level when unsupported, and uses global symbols so `/reload` cannot stack wrappers. This gives Shift+Tab and pi's native thinking selector the extra level without modifying the installed pi package. If the host modules cannot be resolved, routing still works but `ultra` is not added to native controls.

Three pi APIs degrade by feature detection. Without `onTerminalInput`, Esc cannot cancel judging. Without `ui.custom`, management-key input uses a visible editor. Without `setThinkingLevel`, command pins still switch models but leave thinking effort unchanged. Custom TUI components implement the required `invalidate()` method for the installed pi API.

## Network endpoints

The router uses separate judge and CPA contracts even when both point at one local service.

- `<judge.baseUrl>/chat/completions` returns the strict routing verdict.
- `<judge.baseUrl>/models` populates the judge model picker.
- `<cpaBase>/v1/models` reports serving model IDs and populates the judge-override target picker.
- `<cpaBase>/v0/management/auth-files` lists credentials for usage probes.
- `<cpaBase>/v0/management/api-call` proxies upstream Claude and Codex usage requests.

A judge can use another OpenAI-compatible provider. Arm switching and quota probes still depend on CPA.

## Transport and timeout behavior

Network calls use bounded JSON requests and treat non-2xx responses as failures before parsing the body.

Judge attempts have a 60-second timeout and may run twice. Other CPA and provider requests use a 10-second timeout, except management-key validation at 5 seconds. CPA probes are not retried; their failures follow the failure policy in `availability.md`.

## Environment controls

Environment variables provide credentials and test controls.

| Variable | Effect |
| --- | --- |
| variable named by `judge.apiKeyEnv` | bearer token for judge requests |
| variable named by `cpaKeyEnv` | bearer token for CPA model listing |
| variable named by `cpaManagementKeyEnv` | management-key fallback when the config value is empty |
| `LLM_ROUTER_OFF=1` | stops startup from forcing `llm-router/auto` and omits sentinel help; explicit selection of `auto` can still route |
| `JUDGE_EXEMPLARS=0` | disables exemplar retrieval |
| `CPA_SIMULATE_UNAVAILABLE` | comma-separated exact arm keys treated as down |
| `PI_SUBAGENT_CHILD` | identifies child sessions for sentinel-help suppression |
| `PI_SUBAGENT_FANOUT_CHILD` | keeps sentinel help in children allowed to spawn |

`LLM_ROUTER_OFF` is not a global input-handler kill switch. It prevents automatic activation; a session already on `llm-router/auto` still meets the routing condition.

## Placeholder safety

`llm-router/auto` must never handle an inference request in a healthy setup.

The extension switches before the agent loop on a pinned, forced, judged, or fallback path. Extension-origin messages from `sendUserMessage()` follow the same routing path, so command aliases cannot reach the placeholder. Missing CPA registry entries can still break this guarantee.

The judged path reports an error when neither the verdict's effective target nor the fallback resolves. An unpinned bare command returns silently instead, so a missing fallback entry leaves that prompt on the placeholder. The registry-lookup section in `routing.md` covers the dated-ID tolerance applied before declaring a model absent.

Automatic startup activation also fails silently when `llm-router/auto` is absent: the session stays on its current model and no routing occurs. The `/llm-router` command performs the same lookup interactively and reports the missing placeholder.

## User notices

Notices expose routing state without opening logs.

Green indicates an active judge request. Cyan identifies a clean direct or judged selection. Amber marks swaps, skipped quota checks, unknown sentinels, and cancellation. Errors report judge failure, registry failure, or configuration-test failure.

A normal judged notice includes the final model, optional swap origin, optional override source slot, optional skipped-gate warning, elapsed seconds, and a truncated rationale. A pinned-command notice includes the final arm, optional `@effort`, a pinned label, and any quota swap or skipped-check suffix.

A successful verdict whose effective CPA target is missing from the registry may switch to `fallbackModel` after the notice has already been composed. In that case the notice can name the target while pi's footer shows the fallback model actually selected.

## Sensitive data and prompt scope

Judge credentials and CPA keys come from the environment, while a management key entered through the UI is stored as plaintext JSON.

The judge receives the first 4,000 characters of task text. Exemplar retrieval inspects the complete task locally and may add short excerpts from matching corpus prompts to the judge's system message. Image contents are not sent to the routing judge by this extension.

## Smoke command

Run the package harness from `proper-llm-router/` with an optional task string.

```bash
npm run typecheck
npm run test:unit
npm run test:smoke -- ["task text"]
npm run test:coverage
```

Unit fixtures and strict diagnostics are offline. The smoke command runs deterministic assertions before one live route and needs the configured judge and CPA services. Coverage applies repository floors to the unit-test process.
