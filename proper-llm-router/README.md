# proper-llm-router

A [Pi](https://pi.dev) extension that chooses a model for the first task in a
session, switches before generation starts, and leaves later turns on that
model. Each pi-subagents child is a separate session and gets its own route.

The router uses one measured judge decision per task, optional account quota
data, and fixed cross-provider swaps. It has no project-local service; the
judge and model catalog come from CPA/CLIProxyAPI or another compatible judge
endpoint.

## Routing behavior

Fresh and new sessions move to the placeholder `llm-router/auto`. Resumed
sessions keep their current model. Routing runs only while the selected provider
is `llm-router`; `/llm-router` or manually selecting `llm-router/auto` re-arms
the next prompt.

The first eligible input follows this order:

1. A configured slash-command pin switches directly and skips the judge.
2. An unpinned bare slash command uses `fallbackModel` because it has no task
   text to judge.
3. `[[llm-router: <model>]]` forces one arm and removes the marker.
4. Every other prompt goes to the judge.

A command pin takes precedence over a sentinel. Slash commands with arguments
are normal task text unless pinned.

### Judged routes

- The judge receives the first 4000 characters of text, not attached image
  contents.
- It selects one of seven stable capability slots through strict JSON schema.
- Up to three related measured tasks from `exemplars.jsonl` are added as
  evidence when TF-IDF similarity is useful.
- Judge model overrides can replace the model occupying a slot without changing
  that slot's calibrated use cases.
- The judge makes at most two 60-second attempts. Pressing Esc cancels judging,
  discards the prompt, and leaves routing armed.
- Later turns make no judge call.

### Model slots

| Slot | Intended use |
| --- | --- |
| `claude-fable-5` | Ambiguous architecture, protocol work, concurrency, migrations, and unclear scope. |
| `claude-opus-5` | Cross-component diagnosis, authentication, data-loss risk, and high-impact changes. |
| `claude-sonnet-5` | Routine multi-file repository work and test suites. |
| `claude-haiku-4-5` | Localized repository fixes and mechanical edits. |
| `gpt-5-6-sol` | Subtle standalone correctness, algorithms, and performance work. |
| `gpt-5-6-terra` | Fully specified standalone functions, endpoints, or classes. |
| `gpt-5-6-luna` | Trivial or mechanical standalone edits. |

Repository inspection and agentic tool use belong to the Claude lane.
Self-contained work whose code and specification are already in the prompt can
use the GPT lane. When two adjacent tiers fit, the judge chooses the stronger
one.

### Availability, quota, and fallback

The router checks CPA's `/v1/models` catalog while the judge runs. When
`quotaMaxPct` and a CPA management key are configured, it also averages Claude
or Codex account usage and treats slots at or above the threshold as down.
Usage is cached for 60 seconds.

A down slot swaps once to a fixed partner:

- Fable and Sol swap with each other.
- Opus and Terra swap with each other.
- Sonnet swaps to Luna.
- Haiku swaps to Luna; Luna swaps to Haiku.

If both judged choices are down, or judging fails, the router uses
`fallbackModel` without quota-checking that fallback. Quota data failures skip
only the percentage gate and produce a visible warning. Direct pins and
sentinels fail open: if availability cannot produce a usable swap, they keep
the requested arm rather than block the prompt. If a direct target is missing
from Pi's registry, routing falls through to the remaining precedence rules.

Notices show judging state, selected model, latency, rationale, command pins,
forced routes, swaps, overrides, skipped quota checks, and fallback errors.

## Direct model overrides

Use a sentinel in a typed prompt or subagent task:

```text
[[llm-router: claude-opus-5]] Fix the race in the session cache
```

Names can be an arm key, CPA model ID, or unique fragment such as `opus` or
`sol`. Unknown names are removed and sent to the judge with a warning.

pi-subagents spawn-time `model` options are overwritten when the child starts
on `llm-router/auto`. The sentinel is the supported per-child override:

```js
runs.run("retry", {
  agent: "worker",
  task: "[[llm-router: claude-fable-5]] Diagnose the failed migration",
})
```

## Default command pins

| Command | Model | Thinking effort |
| --- | --- | --- |
| `/file` | `claude-fable-5` | `xhigh` |
| `/triage` | `claude-fable-5` | `xhigh` |
| `/spec` | `claude-fable-5` | `xhigh` |
| `/backlog` | `claude-fable-5` | `xhigh` |
| `/implement-ready` | `gpt-5-6-sol` | `xhigh` |

Pins still use the quota swap. Their effort is applied after the final model
switch and is clamped to that model's supported levels. A `null` effort leaves
the current session effort unchanged.

## Commands

| Command | Behavior |
| --- | --- |
| `/llm-router` | Select `llm-router/auto` so the next prompt routes again. |
| `/llm-router-config` | Open the interactive configuration menu. |

The configuration menu can:

- Choose judge model, reasoning effort, and priority service tier.
- Replace judged model slots with models currently enabled by CPA.
- Add, repoint, remove, and set effort for command pins.
- Enable a quota threshold at 50%, 75%, 80%, 90%, or 95%.
- Store or clear the CPA management key through masked input.
- Edit the complete JSON config.
- Run a live end-to-end route test.

## Ultra thinking support

Pi 0.84.2 stops its native thinking controls at `max`. When the running Pi
host exposes the expected compatibility points, this extension adds `ultra` to
Shift+Tab and Pi's thinking selector only for models whose
`thinkingLevelMap.ultra` contains a value. Switching to an unsupported model
clamps effort to its highest available level. If the host layout differs, model
routing still works without the extra native control. No installed Pi files are
modified.

## Install

Use Node 22.19 or newer. The extension and `ultra` compatibility layer are
tested against Pi 0.84.2.

Install the package:

```bash
pi install /path/to/proper-pi-extensions/proper-llm-router
```

Add a placeholder provider and model to `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "llm-router": {
      "baseUrl": "http://127.0.0.1:1/v1",
      "api": "openai-completions",
      "apiKey": "unused",
      "models": [{ "id": "auto" }]
    }
  }
}
```

The placeholder must be available in `/model`, but a healthy route switches
away before any request reaches its URL. If you omit the inline dummy key,
configure equivalent placeholder authentication through Pi. Missing execution
or fallback registry models can leave the placeholder selected; fix the model
registry before retrying.

The seven execution models, `fallbackModel`, and every active override target
must exist in Pi's model registry under provider `cliproxyapi`. Provide the CPA
key through the environment variable configured by `cpaKeyEnv`,
`ANTHROPIC_AUTH_TOKEN` by default.

Remove any older direct `llm-router.ts` extension registration so the package
loads once.

## Configuration file

Settings live at `~/.pi/agent/llm-router.json`. The file is read before every
routed prompt. Most edits need no restart; exemplar path changes need a restart
after the corpus has loaded, and quota data may remain cached for 60 seconds.

| Field | Default | Behavior |
| --- | --- | --- |
| `judge.baseUrl` | `http://127.0.0.1:8317/v1` | OpenAI-compatible judge API base. |
| `judge.apiKeyEnv` | `ANTHROPIC_AUTH_TOKEN` | Environment variable containing the judge key. |
| `judge.model` | `gpt-5.6-terra` | Model used for routing decisions. |
| `judge.effort` | `medium` | Judge `reasoning_effort`; `null` omits it. |
| `judge.fast` | `false` | Sends `service_tier: "priority"` when enabled. |
| `fallbackModel` | `gpt-5.6-terra` | CPA model ID used after judged failure and for bare commands. |
| `cpaBase` | `http://127.0.0.1:8317` | CPA base for model and quota requests. |
| `cpaKeyEnv` | `ANTHROPIC_AUTH_TOKEN` | Environment variable containing the CPA API key. |
| `exemplarsPath` | package `exemplars.jsonl` | Optional measured-outcome corpus. |
| `quotaMaxPct` | `null` | Average lane usage threshold; `null` disables it. |
| `cpaManagementKey` | empty | Plaintext management key, preferred over the environment. |
| `cpaManagementKeyEnv` | `CPA_MANAGEMENT_KEY` | Management-key environment fallback. |
| `judgeModelOverrides` | `{}` | Stable slot to enabled CPA model ID for judged routes. |
| `commandPins` | five defaults above | Slash command to model and effort mapping. |

`commandPins` and `judgeModelOverrides` replace their whole default maps when
present. Invalid or unreadable JSON falls back to defaults. The loader does not
validate field types or URL shapes, so use `/llm-router-config` when possible.
The full JSON editor writes a complete merged config.

## Environment controls

| Variable | Effect |
| --- | --- |
| `LLM_ROUTER_OFF=1` | Stops automatic startup activation and sentinel help. A session already on `llm-router/auto` can still route. |
| `JUDGE_EXEMPLARS=0` | Skips measured exemplar retrieval. |
| `CPA_SIMULATE_UNAVAILABLE="arm1,arm2"` | Treats exact arm keys as down for swap testing. |
| `CPA_MANAGEMENT_KEY` | Default management-key fallback. |

## Development

```bash
npm install
npm run typecheck
npm run test:unit
npm run test:coverage
npm run test:smoke -- ["task text"]
```

Type checks and unit tests are offline. The smoke command runs deterministic
checks followed by one live judge, CPA availability, quota, exemplar, and swap
route.
