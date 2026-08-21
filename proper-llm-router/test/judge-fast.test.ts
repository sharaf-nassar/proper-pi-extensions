import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig, route } from "../llm-router.ts";

const ARM_IDS = [
	"claude-haiku-4-5-20251001",
	"claude-sonnet-5",
	"claude-opus-5",
	"claude-fable-5",
	"gpt-5.6-luna",
	"gpt-5.6-terra",
	"gpt-5.6-sol",
];

// @lat: [[lat.md/proper-llm-router/tests#Verification#Judge fast fixture]]
test("judge.fast controls service_tier on the judge request", async () => {
	const defaults = loadConfig("/__proper-llm-router-missing-config__.json");
	assert.equal(defaults.judge.fast, false);

	const originalFetch = globalThis.fetch;
	let judgeBody: Record<string, unknown> = {};
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		if (url.endsWith("/v1/models")) {
			return Response.json({ data: ARM_IDS.map((id) => ({ id })) });
		}
		if (url.endsWith("/chat/completions")) {
			judgeBody = JSON.parse(String(init?.body));
			return Response.json({
				choices: [
					{
						message: {
							content: JSON.stringify({
								model: "gpt-5-6-terra",
								rationale: "fixture",
							}),
						},
					},
				],
			});
		}
		throw new Error(`unexpected fetch: ${url}`);
	};

	try {
		const verdict = await route(
			{ ...defaults, judge: { ...defaults.judge, fast: true } },
			"t",
		);
		assert.equal(judgeBody.service_tier, "priority");
		assert.equal("harness" in verdict, false);

		await route(defaults, "t");
		assert.equal("service_tier" in judgeBody, false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
