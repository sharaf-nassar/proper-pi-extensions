# proper-llm-router

proper-llm-router is a pi package whose llm-router extension chooses one model for a session's first task, switches before generation starts, and leaves later turns on that model.

## Purpose

The router spends one judge decision per routed task to reduce model cost without accepting a known quality loss. A failed judge request may be retried once.

It separates seven semantic model slots into a repository-oriented Claude lane and a self-contained Codex lane. The judge follows a measured rubric, while configuration can substitute execution models or bypass judging with deterministic pins.

## Architectural boundary

The runtime is intentionally small and local to pi.

- `llm-router.ts` contains configuration, model selection, judge calls, quota probes, swaps, pi event handlers, notices, configuration UI, and the capability-gated `ultra` compatibility patch for Pi 0.84.2.
- `exemplars.jsonl` contains measured verifier outcomes used as optional few-shot evidence.
- `test/ultra-thinking.test.ts` contains offline compatibility fixtures; `smoke.ts` contains deterministic routing checks followed by one live judge and CPA route.
- `package.json` names the public npm package, registers `llm-router.ts`, limits published files, and keeps release-time validation offline; `package-lock.json` pins diagnostic-only Node and Pi types.
- Runtime, corpus, tests, package metadata, README, and package-specific agent guidance are co-located under `proper-llm-router/`; architecture documentation stays under root `lat.md/proper-llm-router/` so repository hooks validate every extension together.
- The OpenAI-compatible judge endpoint and CPA are the network dependencies. They may be the same local service, but their contracts remain separate. There is no build step or project-local service.

## Core invariants

These rules define the behavior that other sections preserve.

1. The `llm-router/auto` model is a placeholder. A routed input must switch to a CPA model before the agent loop sends a request.
2. Only the first eligible input is routed. Selecting `llm-router/auto` re-arms the session.
3. The judge always chooses among seven stable semantic slots. Model overrides may replace a slot's prompt label and execution target, while availability and quota still apply after judging.
4. Repository work is judged in the Claude lane. A fixed post-verdict swap may still execute it on a Codex arm when the chosen Claude arm is unavailable.
5. Quota failures must not block a session. Judged routes fall back; direct command and sentinel overrides keep their requested arm when the probe fails or both fixed partners are down.
6. User configuration is read again for every routed prompt. Process-level exemplar and quota caches are the documented exceptions.
7. Subagent children receive their own verdict. A task-text sentinel is the supported per-child override because a spawn-time `model` choice is overwritten during session startup.

## Documentation map

Each file owns one part of the contract to avoid turning this directory into a source walkthrough.

- [models](./models.md) — model arm catalog, lane policy, tier rubric, deterministic names, and judge model overrides.
- [routing](./routing.md) — session state, input precedence, direct pins, judging, cancellation, and fallback.
- [availability](./availability.md) — CPA probes, account aggregation, swap rules, caching, and fail-open behavior.
- [configuration](./configuration.md) — JSON defaults, merge rules, commands, hot reload, and interactive editing.
- [exemplars](./exemplars.md) — measured corpus format, retrieval, labels, statistics, and cache behavior.
- [operations](./operations.md) — installation assumptions, repository agent tooling, environment controls, endpoints, notices, and sensitive data.
- [tests](./tests.md) — smoke harness, deterministic assertions, live check, and known coverage gaps.

<!-- lat-index
- [[models]] — package index entry
- [[routing]] — package index entry
- [[availability]] — package index entry
- [[configuration]] — package index entry
- [[exemplars]] — package index entry
- [[operations]] — package index entry
- [[tests]] — package index entry
-->
