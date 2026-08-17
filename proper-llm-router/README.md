# proper-llm-router

A [pi](https://github.com/badlogic/pi-mono) extension that routes each coding
task to the right model. A judge LLM reads the first prompt of a session,
picks an arm from a measured rubric (4 Claude tiers + 3 GPT tiers via
CPA/CLIProxyAPI), and the extension switches the session to it — later turns
pay nothing. Subagent children load the extension too, so each spawned task
gets its own verdict; the spawner can pin a model on one spawn by prefixing
its task with `[[llm-router: <model>]]` (see below).

Everything is self-contained in `llm-router.ts`: judge call, quota checks,
swap fallback, exemplar few-shot. No local services beyond CPA itself.

## How a prompt gets routed

1. First input of a session (typed or slash command) is intercepted. A
   pinned slash command (see below) skips straight to step 4.
2. The judge (default: CPA + `gpt-5.6-terra` @ medium reasoning effort,
   strict JSON schema) picks an arm from the full 7-arm menu using the
   embedded rubric plus TF-IDF-matched measured outcomes from
   `exemplars.jsonl`. Esc during the call aborts it and discards the prompt.
3. Concurrently, availability is probed: CPA's `/v1/models` listing, plus
   the quota-threshold gate when configured.
4. An out-of-quota pick swaps to its fixed cross-harness partner:
   fable↔sol, opus↔terra, sonnet→luna, haiku↔luna. Both sides dead →
   fallback model. Any judge failure → fallback model, visibly.
5. The session switches to the result; the notice shows model, latency,
   rationale (green = judging, cyan = clean pick, amber = swapped/warnings).

## Judge model overrides

`judgeModelOverrides` replaces the CPA model occupying one judge arm slot while
keeping that slot's measured use cases. The judge prompt shows the target as
`<target> [selection key: <arm>]`, returns the stable arm key, then routing
switches to the target after quota swapping.

Configure overrides in `/llm-router-config` → *Judge* → *Overrides*. Pick one
of the seven arm slots, then any model currently enabled by CPA. Choosing the
slot's default removes the override. Pins and sentinels are unaffected.

## Pinned slash commands

Some commands always want the same model, so there is nothing for a judge to
decide. `commandPins` maps a command to an arm and a thinking level; the
router switches directly, with no judge call and no latency:

| Command | Arm | Effort |
| --- | --- | --- |
| `/file`, `/triage`, `/spec` | `claude-fable-5` | `xhigh` |
| `/implement-ready` | `gpt-5-6-sol` | `xhigh` |

The quota gate still applies — a pinned arm that is out of quota swaps to its
partner (fable→sol, sol→fable, …) and the notice says so. Effort is applied
after the model switch, so pi clamps it to what the final arm supports;
`ultra` is offered only when the selected model explicitly advertises it, and
`null` leaves the session's thinking level alone. Edit pins in
`/llm-router-config` → *Pinned commands* (add, repoint, change effort,
remove), or directly in the config JSON. Keys match with or without the
leading `/`, case-insensitively; a pin naming an unknown model falls through
to the judge.

## Ultra effort compatibility

CLIProxyAPI already publishes `thinkingLevelMap.ultra` for supported GPT
models, but Pi 0.84.2 stops its native effort controls at `max`. On load, this
extension applies a reload-safe compatibility patch to the running Pi host.
Shift+Tab and Pi's native thinking selector gain a distinct `ultra` choice only
for models whose map contains a non-empty `ultra` value. Unsupported model
switches clamp it to their highest available effort, and the prompt border
reuses Pi's maximum-effort color. No installed Pi files are modified.

## Subagents and the sentinel override

pi-subagents children load this extension like any session: `session_start`
forces them back to `llm-router/auto` (overriding the `--model` the spawner
resolved) and their first input — the task — gets its own judge verdict. So
per-child routing is the default, and `runs.run` `model=` has no effect.

To force a model on one spawn (e.g. an agent failed and the session retries
on a stronger arm), prefix that task string with `[[llm-router: <model>]]`:

```js
runs.run("retry", { agent: "worker", task: "[[llm-router: claude-opus-5]] Fix the race in …" })
```

The router skips the judge, pins the named arm (quota swap still applies —
a dead arm degrades to its partner), and strips the marker before the model
sees it. Names are matched loosely: arm key, CPA id, or any unique fragment
("sol", "opus"). Unknown names fall through to the judge with a notice. The
convention is self-advertised: a short system-prompt suffix in every
orchestrating session (skipped in leaf children, which cannot spawn)
documents it, so the main-session LLM knows the escape hatch exists. The
same marker works in a typed prompt to bypass the judge manually.

## Install

- Install this local package: `pi install /path/to/proper-pi-extensions/proper-llm-router`.
  Its package manifest registers `llm-router.ts`.
- Define placeholder provider `llm-router` (model `auto`) in
  `~/.pi/agent/models.json` + a dummy key in `auth.json` — sessions start
  on `llm-router/auto` and are switched before any request reaches it.
- Provide `ANTHROPIC_AUTH_TOKEN` (CPA key) in pi's environment.
- Run `npm install` here for local type diagnostics and the `npm test` shortcut.

## Router configuration

`~/.pi/agent/llm-router.json` — missing file/keys fall back to defaults.
Re-read on every routed prompt; no restart needed.

| Field | Default | Meaning |
| --- | --- | --- |
| `judge.baseUrl` | `http://127.0.0.1:8317/v1` | any OpenAI-compatible `/chat/completions` with strict `json_schema` |
| `judge.apiKeyEnv` | `ANTHROPIC_AUTH_TOKEN` | env var holding the judge API key |
| `judge.model` | `gpt-5.6-terra` | judge model id |
| `judge.effort` | `medium` | `reasoning_effort`; `null` for non-reasoning judges |
| `fallbackModel` | `gpt-5.6-terra` | used when the judge fails or both swap partners are dead |
| `cpaBase` | `http://127.0.0.1:8317` | CPA base for availability + quota probes |
| `cpaKeyEnv` | `ANTHROPIC_AUTH_TOKEN` | env var holding the CPA key |
| `exemplarsPath` | `<extension>/exemplars.jsonl` | measured-outcome few-shot corpus (optional) |
| `quotaMaxPct` | `null` (off) | block arms whose average usage across accounts ≥ this % |
| `cpaManagementKey` | `""` | CPA management key (plaintext); enables the quota gate |
| `cpaManagementKeyEnv` | `CPA_MANAGEMENT_KEY` | env fallback for the management key |
| `judgeModelOverrides` | `{}` | arm slot to enabled CPA model ID; judged routes only |
| `commandPins` | `/file`,`/triage`,`/spec` → fable @xhigh; `/implement-ready` → sol @xhigh | slash commands routed without the judge: `{ "<cmd>": { "model": "<arm>", "effort": "xhigh"\|"ultra"\|null } }`; ultra requires model support |

## Commands

- `/llm-router` — switch the session back to `llm-router/auto`; the next
  prompt gets routed again.
- `/llm-router-config` — interactive settings: one judge submenu for the
  live model picker, effort picker, and CPA-backed overrides; pinned commands,
  quota threshold,
  masked management-key entry with live validity status, full-config JSON
  editor, and a live judge test.

## Quota gate

With `quotaMaxPct` set and a valid management key, every routing pass reads
per-account usage through CPA's management `api-call` passthrough — Claude:
`api.anthropic.com/api/oauth/usage` (`five_hour`/`seven_day` utilization
plus per-model `limits[]` percentages); Codex: `chatgpt.com` wham usage
(`rate_limit` window `used_percent`). An arm is blocked when the average
across its lane's accounts is at/over the threshold (per-model windows
count for Claude arms). 60s cache; probe failures skip the gate and say so
in the notice rather than blocking routing.

## Smoke test

```bash
npm test -- ["task text"]
```

Runs offline `node:test` compatibility fixtures, the pure routing fixtures
(swaps, quota averaging, model overrides, command pins, and config menus), then
one live routing verdict.

## Escape hatches

- `LLM_ROUTER_OFF=1` — don't force sessions onto `llm-router/auto`.
- `CPA_SIMULATE_UNAVAILABLE="arm1,arm2"` — test hook: treat arms as dead.
- `JUDGE_EXEMPLARS=0` — skip the few-shot exemplar note.
