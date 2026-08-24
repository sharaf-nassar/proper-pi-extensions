# Configuration contract

User-facing settings live in `~/.pi/agent/llm-router.json` and are read before every eligible prompt.

## Defaults

Missing files and missing keys use built-in defaults.

| Field | Default | Contract |
| --- | --- | --- |
| `judge.baseUrl` | `http://127.0.0.1:8317/v1` | OpenAI-compatible judge API base |
| `judge.apiKeyEnv` | `ANTHROPIC_AUTH_TOKEN` | environment variable holding the judge key |
| `judge.model` | `gpt-5.6-terra` | judge model ID or `provider/model-id` |
| `judge.effort` | `medium` | optional `reasoning_effort`; `null` omits it |
| `judge.fast` | `false` | `true` sends `service_tier: "priority"` on judge requests |
| `fallbackModel` | `gpt-5.6-terra` | model ID or `provider/model-id` used after judged-path failure or for bare commands |
| `cpaBase` | `http://127.0.0.1:8317` | CPA base for model and management requests |
| `cpaKeyEnv` | `ANTHROPIC_AUTH_TOKEN` | environment variable holding the CPA API key |
| `exemplarsPath` | `<extension>/exemplars.jsonl` | measured-outcome corpus path |
| `quotaMaxPct` | `null` | threshold gate; `null` disables it |
| `cpaManagementKey` | empty | plaintext management key with priority over the environment |
| `cpaManagementKeyEnv` | `CPA_MANAGEMENT_KEY` | management-key fallback variable |
| `judgeModelOverrides` | empty map | judge arm slot to authenticated model ID or `provider/model-id` |
| `commandPins` | five built-in pins | slash commands that skip judging |

The default exemplar path resolves beside the loaded `llm-router.ts`, so a package move does not break default configuration. An explicit user `exemplarsPath` still overrides it. `fallbackModel` resolves against authenticated Pi models; provider qualification removes duplicate-ID ambiguity.

## Merge and error behavior

`loadConfig()` shallow-merges top-level user fields over defaults and separately merges `judge` fields. Its optional path argument exists for isolated default-config checks; normal runtime calls use `~/.pi/agent/llm-router.json`.

Supplying `commandPins` or `judgeModelOverrides` replaces that entire top-level map; entries are not merged individually. Invalid JSON, read failure, or a non-readable file silently returns all defaults.

The loader validates JSON syntax only. It does not check field types, enum values, URL shape, threshold range, command names, or nested object shape; invalid values can survive loading and fail later at their consumer.

`saveConfig()` writes the complete object with two-space indentation. It expects `~/.pi/agent` to exist and does not create parent directories.

The full JSON editor merges the submitted object over built-in defaults before saving. Deleting a known key in that editor writes its default value back into the file rather than leaving the key absent.

## Hot reload limits

Most config changes affect the next routed prompt without restarting pi.

The lazy exemplar index is loaded once per process. Changing `exemplarsPath` after first use needs a process restart to take effect. Quota account data may remain cached for 60 seconds as described under `Caches and simulation` in `availability.md`.

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

The menu has one `Judge` entry for model, effort, and fast settings, plus `Overrides`, pinned commands, JSON editing, and a live route test. Judge and override pickers use authenticated Pi models when CPA is absent. The fast setting requests priority service where supported.

When an authenticated `cliproxyapi` model exists, the menu also shows quota thresholds and masked management-key entry. Without CPA, those actions, summary fields, and CPA-only fields in the JSON editor are omitted. Hidden stored CPA values are preserved.

The menu summary reports current override and pin counts. The pin editor offers canonical arm keys and every session thinking level supported by the selected model, plus a choice that leaves the session default unchanged. `ultra` appears only when that model's `thinkingLevelMap.ultra` is a non-empty string.

With CPA active, the judge model picker reads `<judge.baseUrl>/models` and preserves the existing endpoint workflow. Without CPA it shows authenticated Pi models as `provider/model-id`. Manual entry remains available in both modes.

### Picker focus and navigation

Every TUI picker opens on its checked current value; menus without one open on their first entry. Up from the first entry wraps to the last, and Down from the last wraps to the first. Non-TUI modes keep Pi's standard selector fallback.

There is no dedicated fallback-model picker. Change `fallbackModel`, endpoint fields, environment-variable names, or `exemplarsPath` through the full JSON editor.

`Test judge` calls the complete `route()` path. It uses the same authenticated model snapshot and judge transport as normal input, applies overrides and swaps, and consults CPA only for CPA-backed targets.

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
