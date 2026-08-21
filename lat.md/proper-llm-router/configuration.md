# Configuration contract

User-facing settings live in `~/.pi/agent/llm-router.json` and are read before every eligible prompt.

## Defaults

Missing files and missing keys use built-in defaults.

| Field | Default | Contract |
| --- | --- | --- |
| `judge.baseUrl` | `http://127.0.0.1:8317/v1` | OpenAI-compatible judge API base |
| `judge.apiKeyEnv` | `ANTHROPIC_AUTH_TOKEN` | environment variable holding the judge key |
| `judge.model` | `gpt-5.6-terra` | model ID sent to the judge endpoint |
| `judge.effort` | `medium` | optional `reasoning_effort`; `null` omits it |
| `judge.fast` | `false` | `true` sends `service_tier: "priority"` on judge requests |
| `fallbackModel` | `gpt-5.6-terra` | CPA model ID used after judged-path failure or for bare commands |
| `cpaBase` | `http://127.0.0.1:8317` | CPA base for model and management requests |
| `cpaKeyEnv` | `ANTHROPIC_AUTH_TOKEN` | environment variable holding the CPA API key |
| `exemplarsPath` | `<extension>/exemplars.jsonl` | measured-outcome corpus path |
| `quotaMaxPct` | `null` | threshold gate; `null` disables it |
| `cpaManagementKey` | empty | plaintext management key with priority over the environment |
| `cpaManagementKeyEnv` | `CPA_MANAGEMENT_KEY` | management-key fallback variable |
| `judgeModelOverrides` | empty map | judge arm slot to enabled CPA model ID |
| `commandPins` | four built-in pins | slash commands that skip judging |

The default exemplar path resolves beside the loaded `llm-router.ts`, so a package move does not break default configuration. An explicit user `exemplarsPath` still overrides the default and must be updated if it names the former checkout. `fallbackModel` is looked up as a CPA model ID, so `gpt-5.6-terra` is valid while arm key `gpt-5-6-terra` is not.

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

`judgeModelOverrides` maps an arm name to an exact CPA model ID. Keys use `resolveArm()`, so arm keys, CPA IDs, and unique fragments are accepted. Empty values, unknown keys, and values equal to the arm's default CPA ID have no effect.

`applyJudgeModelOverrides()` rewrites the complete judge system message, including the rubric and exemplar note. Each source arm becomes `<target> [selection key: <source>]`, and a preamble tells the judge that the target inherits the source slot's use cases. Replacement is simultaneous, so one target cannot trigger another configured replacement.

The strict verdict schema still uses the seven stable arm keys. After judging and any slot-level quota swap, `judgeCpaModel()` maps the final slot to its configured target. The returned verdict and user notice show the target model and identify the source slot.

The interactive picker offers the seven stable arm slots, then reads enabled target IDs from `<cpaBase>/v1/models`. Choosing the slot's default removes its override. The picker has no manual-target entry; an unreachable or empty CPA catalog leaves the config unchanged, and a stale configured target can only be replaced by a currently listed model or reset to default.

JSON can contain a stale or arbitrary target, but routing then depends on that ID being present in both CPA's live listing and pi's `cliproxyapi` registry.

## Default command pins

The built-in map removes judge latency for commands with fixed model needs.

| Command | Arm | Thinking level |
| --- | --- | --- |
| `/file` | `claude-fable-5` | `xhigh` |
| `/triage` | `claude-fable-5` | `xhigh` |
| `/spec` | `claude-fable-5` | `xhigh` |
| `/implement-ready` | `gpt-5-6-sol` | `xhigh` |

Pin keys may include or omit `/` and match case-insensitively. Matching is exact on the first slash-command token, so `/filet` does not match `/file` and embedded text such as `fix /file` is not a command.

Pin models accept any name handled by the `Deterministic names` contract in `models.md`. The interactive editor offers canonical arm keys, while JSON may use an arm key, CPA ID, or unique fragment. An invalid model falls through to normal routing.

Pin edits affect the next armed routing decision. They do not repin a session that has already routed; use `/llm-router` or select `llm-router/auto` before invoking the command when a fresh choice is required.

## Interactive command

`/llm-router-config` opens a UI-only configuration loop when the current pi context has a UI.

The menu has one `Judge` entry that opens model, effort, and fast pickers, plus a top-level `Overrides` entry for judge model overrides. The fast picker is an on/off toggle that saves whether judge requests send `service_tier: "priority"`; unsupported endpoints may ignore it. The menu can also add, repoint, or remove command pins, set a quota threshold from `off`, `50%`, `75%`, `80%`, `90%`, or `95%`, enter a masked management key, edit the full JSON object, and run a live route test.

The menu summary reports current override and pin counts. The pin editor offers canonical arm keys and every session thinking level supported by the selected model, plus a choice that leaves the session default unchanged. `ultra` appears only when that model's `thinkingLevelMap.ultra` is a non-empty string.

The judge model picker reads `<judge.baseUrl>/models`. If that catalog contains router arm IDs, the picker shows only those arms; otherwise it shows up to 40 provider models. Manual entry remains available.

There is no dedicated fallback-model picker. Change `fallbackModel`, endpoint fields, environment-variable names, or `exemplarsPath` through the full JSON editor.

`Test judge` calls the complete `route()` path, not the judge endpoint alone. The check also applies judge model overrides and depends on CPA model listing, optional quota data, exemplar loading, and swap resolution.

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
