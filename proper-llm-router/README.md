# proper-llm-router

A [Pi](https://pi.dev) extension that chooses a model for the first task in a
session, switches before generation starts, and leaves later turns on that
model. Each pi-subagents child is a separate session and gets its own route.

The router uses one measured judge decision per task, Pi's authenticated model
registry, optional CPA account quota data, and fixed cross-provider swaps. It
has no project-local service. CPA/CLIProxyAPI is optional.

## Routing behavior

Fresh and new sessions move to the placeholder `llm-router/auto`. Resumed
sessions keep their current model. Routing runs only while the selected provider
is `llm-router`; `/llm-router` or manually selecting `llm-router/auto` re-arms
the next prompt.

The first eligible input follows this order:

1. A configured slash-command pin switches directly and skips the judge.
2. `[[llm-router: <model>]]` forces one arm and removes the marker.
3. Trivial input uses `fallbackModel` because it has no task text to judge:
   a bare slash command, a choice such as `A` or `1B 2C`, `yes`, `no`, an
   alias, a URL, or any prompt of at most two words.
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
- The judge model must resolve through Pi's authenticated model registry.
  Qualified and unqualified IDs both use Pi's provider runtime, credentials,
  endpoint, serialization, and one strict `route_model` tool call.
- Claude judges are told to call `route_model` instead of being forced to,
  because Claude Fable 5.1 and Opus 5.5 reject forced tool calls on every
  provider, including CLIProxyAPI. GPT judges are still forced.
- Custom `openai-completions` judge endpoints must support strict JSON-schema
  tools. Pi's `openai-completions` adapter defaults to `supportsStrictMode:
  false` for unknown endpoints; the router's `route_model` tool requires strict
  mode and fails visibly rather than relaxing the schema silently. Use a
  supported judge endpoint (such as the default Codex Responses models) or
  explicitly add `"compat": { "supportsStrictMode": true }` to the endpoint's
  model entry in Pi's registry -- only for endpoints that have been verified to
  accept strict JSON-schema tool calls. The default Responses and Codex judges
  are unaffected.
- The judge makes at most two 60-second attempts. Pressing Esc cancels judging,
  discards the prompt, and leaves routing armed.
- Later turns make no judge call.

### Model slots

| Slot | Intended use |
| --- | --- |
| `claude-fable-5-1` | Ambiguous architecture, protocol work, concurrency, migrations, and unclear scope. |
| `claude-opus-5-5` | Cross-component diagnosis, authentication, data-loss risk, and high-impact changes. |
| `claude-sonnet-5` | Routine multi-file repository work and test suites. |
| `claude-haiku-4-5` | Localized repository fixes and mechanical edits. |
| `gpt-6-astra` | Novel algorithms, proofs, math-heavy reasoning, and standalone work beyond Sol. |
| `gpt-6-1-sol` | Fully specified standalone code, plus subtle correctness, algorithms, and performance work. |
| `gpt-6-luna` | Trivial or mechanical standalone edits. |

Repository inspection and agentic tool use belong to the Claude lane.
Self-contained work whose code and specification are already in the prompt can
use the GPT lane. When two adjacent tiers fit, the judge chooses the stronger
one.

The September 2026 catalog moves each slot to the newest model in its tier.
Opus 5.5 replaced Opus 5 at a lower price, and Fable 5.1 replaced Fable 5 at
the same price. GPT-6 Luna replaced GPT-5.6 Luna. GPT-6 Sol costs slightly
less than GPT-5.6 Terra and scores about the same as GPT-5.6 Sol, so it takes
over both of their roles, and GPT-6 Astra adds a stronger GPT tier above it.
GPT-6.1 Sol, Pi 0.99.1's OpenAI Codex default, then replaced GPT-6 Sol in
the `gpt-6-1-sol` slot. Sonnet 5 and Haiku 4.5 are still Anthropic's newest
models in their tiers.

Names of the retired slots (`claude-opus-5`, `claude-fable-5`,
`gpt-5-6-luna`, `gpt-5-6-terra`, `gpt-5-6-sol`, `gpt-6-sol`, and their model
IDs) still
work in overrides, pins, and sentinels and select the slot that replaced them.
The measured exemplars for the new slots come from the models they replaced,
except `gpt-6-astra`, which has none yet.

### Availability, quota, and fallback

The router resolves each arm against Pi's authenticated models. Unqualified
model IDs prefer `cliproxyapi` for backward compatibility, then the direct
provider for that model family. Use `provider/model-id` in overrides or
`fallbackModel` when the same ID exists under several providers.

The provider registry is the model-availability source. The CLIProxyAPI provider
owns its `/v1/models` discovery, authentication, caching, and refresh. When
`quotaMaxPct` and a separate CPA management key are configured, the router
averages Claude or Codex account usage and treats CPA-backed slots at or above
the threshold as down. Usage is cached for 60 seconds. Without an available
`cliproxyapi` model, no CPA quota request runs.

A down slot swaps once to a fixed partner:

- Fable and Astra swap with each other.
- Opus and Sol swap with each other.
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
[[llm-router: claude-opus-5-5]] Fix the race in the session cache
```

Names can be an arm key, its default model ID, a retired slot name, or a unique
fragment such as `opus`, `sol`, or `astra`. Unknown names are removed and sent
to the judge with a warning.

pi-subagents spawn-time `model` options are overwritten when the child starts
on `llm-router/auto`. The sentinel is the supported per-child override:

```js
runs.run("retry", {
  agent: "worker",
  task: "[[llm-router: claude-fable-5-1]] Diagnose the failed migration",
})
```

## Default command pins

| Command | Model | Thinking effort |
| --- | --- | --- |
| `/file` | `claude-fable-5-1` | `xhigh` |
| `/triage` | `claude-fable-5-1` | `xhigh` |
| `/spec` | `claude-fable-5-1` | `xhigh` |
| `/refine` | `claude-fable-5-1` | `xhigh` |
| `/implement-ready` | `gpt-6-1-sol` | `xhigh` |

Existing `llm-router.json` files that replace `commandPins` must rename a
custom `backlog` key to `refine`; custom maps are not merged with defaults.

Pins still use the quota swap. Their effort is applied after the final model
switch and is clamped to that model's supported levels. A `null` effort leaves
the current session effort unchanged.

## Commands

| Command | Behavior |
| --- | --- |
| `/llm-router` | Select `llm-router/auto` so the next prompt routes again. |
| `/llm-router-config` | Open the interactive configuration menu. |

The configuration menu can:

- Turn routing off or on for all sessions (`enabled` in the config file), and
  while it is off, turn it back on for the current session only
  (`LLM_ROUTER_ON=1` in the process environment, inherited by spawned
  workers). Turning routing off moves an armed session to `fallbackModel`;
  turning it on re-arms the session on `llm-router/auto`.
- Choose judge model, reasoning effort, and priority service tier.
- Replace judged model slots with any authenticated Pi model.
- Add, repoint, remove, and set effort for command pins.
- Edit the complete JSON config.
- Run a live end-to-end route test.

When `cliproxyapi` is available, the menu also shows the CPA quota threshold
and management key. Without CPA, those actions and CPA-only JSON fields are
hidden.

## Ultra thinking support

Pi 0.85.1 stops its native thinking controls at `max`. When the running Pi
host exposes the expected compatibility points, this extension adds `ultra` to
Shift+Tab and Pi's thinking selector only for models whose
`thinkingLevelMap.ultra` contains a value. Switching to an unsupported model
clamps effort to its highest available level. If the host layout differs, model
routing still works without the extra native control. No installed Pi files are
modified.

## Install

Use Node 22.19 or newer and Pi 0.99.1 or newer, the first release with
virtual models and a built-in catalog listing every default model. The
extension and `ultra` compatibility layer are tested against Pi 0.99.1.

Install the published package:

```bash
pi install npm:proper-llm-router
```

For extension development, install a local checkout instead:

```bash
pi install /path/to/proper-pi-extensions/proper-llm-router
```

The package has no runtime dependencies and no build step, so a local
install needs no `npm install`; that command only prepares the development
checks below.

The extension registers `llm-router/auto` itself at load as a Pi virtual
model, so no `~/.pi/agent/models.json` edit or credential is needed. Pi
refuses to register a virtual model over a physical model with the same ID,
so on the first launch after updating, the extension removes an older manual
`llm-router/auto` entry from `models.json` and reports the cleanup. If
`models.json` contains comments, it is left untouched; remove that entry by
hand.

The placeholder appears in `/model`, and a healthy route switches away before
the first request. A request that still reaches it, such as a compaction
summary or an extension message sent without typed input, runs on
`fallbackModel` at the selected thinking level. If the fallback is missing
from the model registry, that request fails with a named error; fix the
model registry before retrying.

The seven execution model IDs, `fallbackModel`, and active override targets
must resolve to authenticated models in Pi's registry. They may come from
built-in providers, `models.json`, or extension-registered providers. Exact
`provider/model-id` values remove ambiguity.

When authenticated `cliproxyapi` models are available, unqualified IDs prefer
them and optional CPA quota checks apply. The router never reads or stores the
provider API key; `/login CLIProxyAPI` and Pi's model registry own model auth.

A direct-provider setup can keep the defaults when the same model IDs are
available, or qualify ambiguous choices:

```json
{
  "judge": {
    "model": "openai-codex/gpt-6.1-sol"
  },
  "fallbackModel": "anthropic/claude-opus-5-5",
  "judgeModelOverrides": {
    "claude-fable-5-1": "anthropic/claude-fable-5-1"
  }
}
```

Remove any older direct `llm-router.ts` extension registration so the package
loads once.

## Configuration file

Settings live at `~/.pi/agent/llm-router.json`. The file is read before every
routed prompt. Most edits need no restart; exemplar path changes need a restart
after the corpus has loaded, and quota data may remain cached for 60 seconds.

| Field | Default | Behavior |
| --- | --- | --- |
| `enabled` | `true` | `false` stops automatic startup activation and sentinel help in every session. A session already on `llm-router/auto` can still route. |
| `judge.model` | `gpt-6.1-sol` | Authenticated Pi model ID or `provider/model-id` used for the judge. |
| `judge.effort` | `medium` | Judge `reasoning_effort`; `null` omits it. |
| `judge.fast` | `false` | Sends `service_tier: "priority"` when enabled. |
| `fallbackModel` | `gpt-6.1-sol` | Model ID or `provider/model-id` used after judged failure and for trivial input such as bare commands. |
| `cpaBase` | `http://127.0.0.1:8317` | CPA base for optional quota-management requests. |
| `exemplarsPath` | package `exemplars.jsonl` | Optional measured-outcome corpus. |
| `quotaMaxPct` | `null` | Average lane usage threshold; `null` disables it. |
| `cpaManagementKey` | empty | Plaintext management key, preferred over the environment. |
| `cpaManagementKeyEnv` | `CPA_MANAGEMENT_KEY` | Management-key environment fallback. |
| `judgeModelOverrides` | `{}` | Stable slot to authenticated model ID or `provider/model-id` for judged routes. |
| `commandPins` | five defaults above | Slash command to model and effort mapping. |

`commandPins` and `judgeModelOverrides` replace their whole default maps when
present. Legacy `judge.baseUrl`, `judge.apiKeyEnv`, and `cpaKeyEnv` fields are
ignored. Invalid or unreadable JSON falls back to defaults. The loader does not
validate field types or URL shapes, so use `/llm-router-config` when possible.
The full JSON editor writes a complete merged config.

## Environment controls

| Variable | Effect |
| --- | --- |
| `LLM_ROUTER_OFF=1` | Same as `"enabled": false`: stops automatic startup activation and sentinel help. A session already on `llm-router/auto` can still route. Pinned workflow commands run unrouted without prompting. |
| `LLM_ROUTER_ON=1` | Overrides `LLM_ROUTER_OFF` and a disabled config file for one process tree. The config menu's session switch sets it. |
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

Type checks, unit tests, and the smoke command are offline. They include direct
and CPA-backed routes through injected Pi model snapshots, registry judge
behavior, quota aggregation, exemplars, and swaps without owning provider auth.
