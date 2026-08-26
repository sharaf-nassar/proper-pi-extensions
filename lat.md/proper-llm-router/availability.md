# Availability and quota

Availability comes from Pi's authenticated model registry; the opt-in CPA quota gate is the only exhaustion signal for targets resolved under `cliproxyapi`.

## Registry availability

Every routed prompt reads `ctx.modelRegistry.getAvailable()`, excluding the `llm-router` placeholder provider.

That call reports models with valid configured authentication, not live upstream capacity, and providers may serve it from a cached catalogue. Registry availability therefore answers "is this model configured and authenticated", never "does it have quota right now".

A configured target may be a model ID or `provider/model-id`. Unqualified IDs prefer `cliproxyapi` for backward compatibility, then the direct provider for that model family. Exact IDs beat dated `-suffix` or `@suffix` variants. Provider-qualified values never fall across providers.

Judged routes resolve overrides for each semantic slot. Command pins and sentinels resolve the arm's default model instead, preserving the override scope in [[configuration#Judge model overrides]]. A missing target marks that arm unavailable before the verdict is applied.

## CPA checks

Targets resolved under `cliproxyapi` receive an optional quota check; non-CPA targets do not call CPA.

`armAvailability()` treats a resolved registry target as available without a catalog request. CPA's `/v1/models` was never an exhaustion signal to begin with: its registry deliberately keeps a model listed while every account for it sits in quota cooldown, so a listing could not distinguish spare quota from an exhausted lane.

When `quotaMaxPct` is set and a management key is available, CPA-backed targets use the account aggregation below. Leaving `quotaMaxPct` at its `null` default means CPA arms are assumed available, no swap fires for an exhausted account, and exhaustion surfaces as a failed request on the routed model instead. The management key comes from `cpaManagementKey`, then from the environment variable named by `cpaManagementKeyEnv`.

## Usage collection

The threshold gate reads active Claude and Codex credentials through CPA's management API passthrough.

For Claude, the router calls `api.anthropic.com/api/oauth/usage`. It records the maximum account-wide percentage and maps weekly model windows from named fields and `limits[]` entries to Claude arms. Unscoped `limits[]` values can raise the account-wide figure; Haiku depends on display-name mapping when no named window exists.

For Codex, the router calls `chatgpt.com/backend-api/wham/usage`. It records the maximum `used_percent` or `usedPercent` across `rate_limit`, with `rate_limits` accepted as a compatibility fallback. `allowed: false` or `limit_reached: true` counts as 100% because burst throttles can reject chat requests while window percentages remain low.

An upstream 429 is definitive exhaustion, so that credential contributes 100% account-wide usage. Other failed credential probes are dropped. A successful response with no recognized usage fields becomes a zero-valued account. If no credential returns parsed data, the threshold gate has no data and does not block an arm.

## Threshold aggregation

`quotaBlockedArms()` blocks an arm when average effective usage across accounts in its lane is greater than or equal to `quotaMaxPct`.

An account's effective usage for one arm is the larger of its account-wide usage and that arm's model-specific usage. Claude and Codex accounts are averaged separately. A lane with no parsed accounts cannot block any arms.

Only CPA-backed targets apply this blocked set. A non-CPA model occupying the same semantic slot remains governed by Pi registry availability, not CPA account usage.

This is lane averaging, not a minimum-free-account rule. Two accounts at 100% and 80% produce 90%; they are blocked at an 85% threshold and allowed at 95%.

## Swap resolution

A down verdict moves once to a fixed cross-lane target.

| Requested arm | Swap target |
| --- | --- |
| `claude-fable-5` | `gpt-5-6-sol` |
| `gpt-5-6-sol` | `claude-fable-5` |
| `claude-opus-5` | `gpt-5-6-terra` |
| `gpt-5-6-terra` | `claude-opus-5` |
| `claude-sonnet-5` | `gpt-5-6-luna` |
| `claude-haiku-4-5` | `gpt-5-6-luna` |
| `gpt-5-6-luna` | `claude-haiku-4-5` |

The graph is intentionally asymmetric at the lower tiers. Luna returns to Haiku, while both Haiku and Sonnet can fall to Luna.

Every swap crosses the Claude/Codex lane boundary. Availability does not alter the judge's rubric, but it can change the provider and model that execute the task.

A judged route swaps semantic slots first, then resolves the override configured for the final slot. It throws when both slots are unavailable, then the input handler uses `fallbackModel`. A direct command or sentinel keeps its requested arm when no usable swap exists, as defined by [[routing#Direct routes]].

## Failure policy

Availability should reduce avoidable failures, not create a new outage mode.

- A missing authenticated registry target marks only that arm unavailable.
- An unreachable CPA leaves arms available; the judge and `fallbackModel` route through the same provider, so the request fails rather than swapping.
- An account usage call returning upstream 429 counts as 100% usage.
- Other failures of one account usage call drop that account.
- Failure of all usage calls skips only the threshold gate.
- Direct routes keep their requested target when no usable swap exists.
- `fallbackModel` resolves through Pi's authenticated registry and is not quota-checked before selection.

When a threshold is configured but no usage data is available, CPA-backed judged verdicts set `quota_gate_skipped` so the user sees that the management key or API needs attention.

## Caches and simulation

Account usage is cached in process memory for 60 seconds to avoid several upstream calls on every CPA-backed prompt.

The cache is global rather than keyed by CPA URL, management key, or threshold. Config changes involving those fields may therefore use old usage data for up to 60 seconds.

A failed or no-data usage probe is cached as `null` for the same interval. Fixing a management key or recovering CPA can therefore leave the gate visibly skipped until the entry expires.

`CPA_SIMULATE_UNAVAILABLE` adds exact arm keys to the down set after registry and quota checks. It is a deterministic test hook for swaps and fallback, not a substitute for the management quota gate.
