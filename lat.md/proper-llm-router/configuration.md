# Configuration contract

User-facing settings live in `~/.pi/agent/llm-router.json` and are read before every eligible prompt.

## Defaults

Missing files and missing keys use built-in defaults.

| Field | Default | Contract |
| --- | --- | --- |
| `enabled` | `true` | global routing switch; `false` stops automatic activation in every session |
| `judge.model` | `gpt-5.6-terra` | authenticated Pi judge model ID or `provider/model-id` |
| `judge.effort` | `medium` | optional `reasoning_effort`; `null` omits it |
| `judge.fast` | `false` | `true` sends `service_tier: "priority"` on judge requests |
| `fallbackModel` | `gpt-5.6-terra` | model ID or `provider/model-id` used after judged-path failure or for trivial input such as bare commands |
| `cpaBase` | `http://127.0.0.1:8317` | CPA base for optional management requests |
| `exemplarsPath` | `<extension>/exemplars.jsonl` | measured-outcome corpus path |
| `quotaMaxPct` | `null` | threshold gate; `null` disables it |
| `cpaManagementKey` | empty | plaintext management key with priority over the environment |
| `cpaManagementKeyEnv` | `CPA_MANAGEMENT_KEY` | management-key fallback variable |
| `judgeModelOverrides` | empty map | judge arm slot to authenticated model ID or `provider/model-id` |
| `commandPins` | five built-in pins | slash commands that skip judging |

The default exemplar path resolves beside the loaded `llm-router.ts`, so a package move does not break default configuration. An explicit user `exemplarsPath` still overrides it. `fallbackModel` resolves against authenticated Pi models; provider qualification removes duplicate-ID ambiguity.

## Routing switch

Routing is active when the file's `enabled` flag is true and `LLM_ROUTER_OFF` is not `1`, or whenever `LLM_ROUTER_ON=1` is set in the process environment.

`routingEnabled()` gates startup activation, sentinel help, and the pinned-command confirm dialog. It never gates the input handler: a session already on `llm-router/auto` still routes, so the switch prevents activation rather than killing armed sessions.

The file flag is global. Every pi process reads it on `session_start` and `before_agent_start`, so turning it off in one session stops new sessions and spawned children from arming without a restart.

`LLM_ROUTER_ON=1` is a process-scoped override, written into the running process environment by the menu's session switch. pi-subagents children inherit the parent environment, so a session re-enabled this way routes its workers too. The override wins over both the file flag and `LLM_ROUTER_OFF`.

## Merge and error behavior

`loadConfig()` merges user settings over defaults while removing obsolete router-owned authentication fields.

It shallow-merges top-level fields and separately merges `judge`. It drops legacy `cpaKeyEnv`, `judge.baseUrl`, and `judge.apiKeyEnv`. Its optional path argument supports isolated checks; normal runtime calls use `~/.pi/agent/llm-router.json`.

Supplying `commandPins` or `judgeModelOverrides` replaces that entire top-level map; entries are not merged individually. Invalid JSON, read failure, or a non-readable file silently returns all defaults.

The loader validates JSON syntax only. It does not check field types, enum values, URL shape, threshold range, command names, or nested object shape; invalid values can survive loading and fail later at their consumer.

`saveConfig()` writes the complete object with two-space indentation. It expects `~/.pi/agent` to exist and does not create parent directories.

The full JSON editor merges the submitted object over built-in defaults before saving. Deleting a known key in that editor writes its default value back into the file rather than leaving the key absent.

## Hot reload limits

Most config changes affect the next routed prompt without restarting pi.

The lazy exemplar index is loaded once per corpus path, so changing `exemplarsPath` takes effect on the next routed prompt while in-place corpus edits still need a restart. Quota account data may remain cached for 60 seconds as described under `Caches and simulation` in `availability.md`.

Judge model overrides affect the next judged prompt. They do not affect command pins or sentinels, and they do not require a restart.

## Judge model overrides

Judge model overrides replace the execution model attached to a stable arm slot while preserving that slot's calibrated use cases.

`judgeModelOverrides` maps an arm name to a model ID or `provider/model-id`. Keys use `resolveArm()`, so arm keys, default IDs, dated IDs, and unique fragments are accepted. Empty values, unknown keys, and values equal to the arm's default ID have no effect.

`applyJudgeModelOverrides()` rewrites the complete judge system message, including the rubric and exemplar note. Each source arm becomes `<target> [selection key: <source>]`, and a preamble tells the judge that the target inherits the source slot's use cases. Replacement is simultaneous, so one target cannot trigger another configured replacement.

The strict verdict schema still uses the seven stable arm keys. After judging and any slot-level availability swap, `judgeModelName()` maps the final slot to its configured target. The verdict records the resolved provider and model and identifies an overridden source slot.

The interactive picker offers the seven stable arm slots and authenticated models from Pi's registry. It stores `provider/model-id` and removes the override when the default is chosen. A stale JSON target remains unavailable until the matching provider and model become authenticated.

## Default command pins

The built-in map removes judge latency for commands with fixed model needs.

| Command | Arm | Thinking level |
| --- | --- | --- |
| `/file` | `claude-fable-5` | `xhigh` |
| `/triage` | `claude-fable-5` | `xhigh` |
| `/spec` | `claude-fable-5` | `xhigh` |
| `/refine` | `claude-fable-5` | `xhigh` |
| `/implement-ready` | `gpt-5-6-sol` | `xhigh` |

Existing user maps that still pin `backlog` must rename that key to `refine`. The loader does not migrate custom command names because `commandPins` may contain unrelated user-defined commands.

Pin keys may include or omit `/` and match case-insensitively. Matching is exact on the first slash-command token, so `/filet` does not match `/file` and embedded text such as `fix /file` is not a command.

Pin models accept any name handled by the `Deterministic names` contract in `models.md`. The interactive editor offers canonical arm keys, while JSON may use an arm key, default model ID, dated ID, or unique fragment. An invalid model falls through to normal routing.

Pin edits affect the next armed routing decision. They do not repin a session that has already routed; use `/llm-router` or select `llm-router/auto` before invoking the command when a fresh choice is required.

## Interactive command

`/llm-router-config` opens a UI-only configuration loop when the current pi context has a UI.

The first menu entry toggles the global `enabled` flag. When routing is inactive, or a session override is set, a second entry toggles `LLM_ROUTER_ON` for the current process. Either toggle re-arms the session on `llm-router/auto` when routing becomes active, and moves a still-armed session to `fallbackModel` when it becomes inactive; sessions already on a concrete model are left as they are. The summary line reports `on`, `on (this session)`, `off`, or `off (LLM_ROUTER_OFF=1)`.

The menu then has one `Judge` entry for model, effort, and fast settings, plus `Overrides`, pinned commands, JSON editing, and a live route test. Judge and override pickers always use authenticated Pi models. The fast setting requests priority service where supported.

When an authenticated `cliproxyapi` model exists, the menu also shows quota thresholds and masked management-key entry. Without CPA, those actions, summary fields, and CPA-only fields in the JSON editor are omitted. Hidden stored CPA values are preserved.

The menu summary reports current override and pin counts. The pin editor offers canonical arm keys and every session thinking level supported by the selected model, plus a choice that leaves the session default unchanged. `ultra` appears only when that model's `thinkingLevelMap.ultra` is a non-empty string.

The judge model picker reads Pi's authenticated model snapshot and displays `provider/model-id` values. Manual entry remains available for exact registry names that are not in the first 80 displayed entries.

### Picker focus and navigation

Every TUI picker opens on its checked current value; menus without one, including the main menu, open on their first entry.

Up from the first entry wraps to the last, and Down from the last wraps to the first. Non-TUI modes keep Pi's standard selector fallback.

There is no dedicated fallback-model picker. Change `fallbackModel`, optional CPA management settings, or `exemplarsPath` through the full JSON editor.

`Test judge` calls the complete `route()` path. It uses the same authenticated model snapshot and registry judge transport as normal input, applies overrides and swaps, and consults CPA only when the optional quota gate is enabled for CPA-backed targets.

## Thinking levels

Judge effort and session thinking use related but different controls.

Pinned commands can select `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`, plus a choice that leaves the session default unchanged. They can also select `ultra` when the chosen model explicitly maps that level. The judge-effort picker remains `minimal` through `xhigh` plus `none`; it omits `off`, `max`, and `ultra`.

A non-null judge effort is sent as `reasoning_effort`, while a pin effort is passed to pi after the final model switch. Pi clamps a saved `ultra` pin to the final model's highest available level if quota swapping or later catalog changes select a model without `ultra` support.

## Management key handling

The config summary reports whether the management key comes from the config file, the configured environment variable, or is unset. Runtime quota probes report unusable keys through the visible skipped-gate notice.

Custom UI support masks typed characters and handles paste, backspace, Enter, Esc, and Ctrl-C. Older pi versions fall back to a visible editor.

A key entered in the UI is stored as plaintext in `llm-router.json`. An empty entry clears the file value and restores the environment fallback.

## Rearming command

`/llm-router` switches the session to `llm-router/auto`, whose provider identity re-arms the next eligible input.

The next eligible prompt runs the normal `Input precedence` contract in `routing.md`. The command reports an error if the placeholder model is absent from pi's registry.
