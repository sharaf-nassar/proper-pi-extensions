# Model arms and rubric

The router exposes seven stable arm keys and maps each key to a default model identifier resolved through Pi's authenticated model registry.

## Arm catalog

Arm keys are internal routing names; default identifiers may resolve under CPA or another configured Pi provider.

| Arm key | Default model ID | Lane | Intended tier |
| --- | --- | --- | --- |
| `claude-haiku-4-5` | `claude-haiku-4-5` | repository and agentic | narrow fixes and mechanical edits |
| `claude-sonnet-5` | `claude-sonnet-5` | repository and agentic | routine multi-file work and test suites |
| `claude-opus-5-5` | `claude-opus-5-5` | repository and agentic | cross-component diagnosis and high-impact changes |
| `claude-fable-5-1` | `claude-fable-5-1` | repository and agentic | ambiguous architecture and protocol-level work |
| `gpt-6-luna` | `gpt-6-luna` | self-contained | trivial or mechanical standalone edits |
| `gpt-6-1-sol` | `gpt-6.1-sol` | self-contained | well-specified functions, subtle algorithms, performance work, and tricky local logic |
| `gpt-6-astra` | `gpt-6-astra` | self-contained | novel algorithms, proof- or math-heavy reasoning, and work beyond Sol |

`resolveArm()` accepts an arm key, its default model ID, a dated variant, a retired arm name, or a unique fragment. Unknown and ambiguous names return no arm rather than guessing.

## Catalog generations

The September 2026 catalog moved each slot to the newest model in its tier, following the vendors' own tier guidance and published benchmarks.

Claude Opus 5.5 replaced Opus 5: Anthropic reports Fable 5.1-level results on most work at 40% lower cost than Opus 5. Fable 5.1 replaced Fable 5 at the same price, and Anthropic still recommends Fable over Opus for demanding reasoning and long-horizon work. Sonnet 5 and Haiku 4.5 remain the newest models in their tiers.

GPT-6 Luna replaced GPT-5.6 Luna at about half its price. GPT-6 Sol costs slightly less than GPT-5.6 Terra and lands level with GPT-5.6 Sol on independent indexes, so one slot inherits both roles and Terra retires. GPT-6.1 Sol, which Pi 0.99.1 made its OpenAI Codex default, then replaced GPT-6 Sol in that slot under the key `gpt-6-1-sol`. GPT-6 Astra, OpenAI's strongest model at Fable's price, fills the new top Codex tier. The lane rule and the rubric's measured percentages still come from the previous generation, as described in [[exemplars#Corpus snapshot]].

The package requires Pi 0.99.1, the first release whose built-in catalog lists GPT-6.1 Sol alongside Opus 5.5 and GPT-6 Luna, and whose virtual-model API backs the placeholder described in [[lat.md/proper-llm-router/operations#Placeholder safety]], so every default resolves on a direct provider without extra configuration.

## Lane decision

Lane selection depends on where the missing information lives.

Any task that requires repository inspection, named project files, tests, integration work, or agentic tool use goes to the Claude lane. The Codex lane is limited to standalone tasks whose code and specification are already present in the prompt.

This distinction comes before model strength. A mechanically specified repository edit still belongs to the Claude lane because repository navigation was the measured reliability separator.

## Tier decision

The judge chooses the cheapest tier expected to finish without quality loss.

- Concurrency, distributed correctness, protocol or migration design, and unclear scope route to `claude-fable-5-1`.
- Cross-component diagnosis, authentication, data-loss risk, and hot-path changes route to `claude-opus-5-5`.
- Routine multi-file repository work routes to `claude-sonnet-5`.
- Localized, well-reproduced repository work routes to `claude-haiku-4-5`.
- Standalone work needing a novel algorithm, a proof, or a math-heavy derivation routes to `gpt-6-astra`, as does work whose similar measured tasks show `gpt-6-1-sol` failing.
- Subtle standalone correctness, performance work, and fully specified standalone implementation route to `gpt-6-1-sol`.
- Trivial standalone edits route to `gpt-6-luna`.

When two adjacent tiers both look plausible, the rubric chooses the stronger tier. Quality protection wins the tie.

## Deterministic names

Overrides use the same arm resolver as the judge output checks.

`commandPin()` matches slash-command names case-insensitively and ignores an optional leading slash in config keys. `parseSentinel()` extracts the task-text override before the model switch.

The resolver normalizes dots and spaces to hyphens. It also accepts dated CPA IDs when they contain one complete arm key. Broad fragments such as `claude` or `gpt-6` remain invalid because they match several arms.

Retired arm keys and their model IDs resolve to the slot that inherited their role: `claude-opus-5` to `claude-opus-5-5`, `claude-fable-5` to `claude-fable-5-1`, `gpt-5-6-luna` to `gpt-6-luna`, and `gpt-5-6-terra`, `gpt-5-6-sol`, and `gpt-6-sol` to `gpt-6-1-sol`. Saved overrides, pins, and subagent sentinels written for the previous catalog therefore keep working. The mapping is exact; a bare `terra` fragment matches nothing.

## Judge model overrides

Overrides replace the execution model occupying a semantic arm slot without changing that slot's calibrated lane or tier. Values may be model IDs or explicit `provider/model-id` references.

The judge prompt shows the configured target model in every rubric and exemplar position owned by the source arm. A stable selection key remains beside the target because the strict verdict schema still returns one of the seven arm keys. Several slots may point to the same target.

Overrides apply only to judged routes. Command pins and sentinels continue to name and execute their configured arms directly. An availability swap moves between semantic slots first, then applies the target configured for the final slot.

## Availability does not change the rubric

The judge reasons about capability slots, not current provider or subscription state.

The seven semantic arm slots remain fixed. The swap-resolution contract in `availability.md` applies registry availability and optional CPA quota after the verdict, using each slot's effective target model when overrides are configured. This keeps the rubric stable while providers change.

The lane rule constrains the source slot, not necessarily the final execution model. Fixed swaps cross providers, and an arbitrary override target can belong to either provider without changing the source slot's rubric role.

## Changing the arm catalog

Adding, renaming, or retiring an arm requires coordinated changes because the catalog is repeated in routing policy, fallback policy, fixtures, and measured data.

Update the `ARMS` mapping, Claude lane membership, fixed `SWAP` graph, rubric menu and tier text, Claude usage-window mappings, sentinel help text, smoke fixture arm list and expectations, exemplar `rates` keys, and the catalog and swap tables in `lat.md/`. Every arm needs a registry-resolvable default ID and a deliberate one-hop swap target.

A retired key moves into `RETIRED_ARMS` with its successor so saved configuration keeps resolving. Its exemplar rates move to the successor or are dropped, and [[exemplars#Corpus snapshot]] records which models were actually measured.
