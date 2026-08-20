import assert from "node:assert/strict";
import { test } from "node:test";

import { armAvailability, loadConfig } from "../llm-router.ts";

// Separate file from quota-rate-limit.test.ts: armAvailability caches
// account usages in module state, and each test file gets its own process.
// @lat: [[lat.md/proper-llm-router/tests#Verification#Usage rate-limit fixture]]
test("codex limit_reached blocks the lane while used_percent is low", async () => {
	const cfg = {
		...loadConfig("/__proper-llm-router-missing-config__.json"),
		cpaBase: "http://cpa.test",
		cpaManagementKey: "test-management-key",
		quotaMaxPct: 80,
	};
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.endsWith("/v1/models")) {
			return Response.json({
				data: [
					"claude-sonnet-5",
					"claude-opus-5",
					"gpt-5.6-luna",
					"gpt-5.6-terra",
					"gpt-5.6-sol",
				].map((id) => ({ id })),
			});
		}
		if (url.endsWith("/v0/management/auth-files/models")) {
			return Response.json({ error: "name is required" }, { status: 400 });
		}
		if (url.endsWith("/v0/management/auth-files")) {
			return Response.json({
				files: [
					{
						auth_index: "codex-account",
						provider: "codex",
						disabled: false,
						unavailable: false,
					},
				],
			});
		}
		if (url.endsWith("/v0/management/api-call")) {
			// live wham/usage shape during a burst throttle: window percent
			// low, throttle expressed only through the booleans
			return Response.json({
				status_code: 200,
				body: {
					rate_limit: {
						allowed: false,
						limit_reached: true,
						primary_window: { used_percent: 70 },
						secondary_window: null,
					},
				},
			});
		}
		throw new Error(`unexpected fetch: ${url}`);
	};

	try {
		const availability = await armAvailability(cfg);
		assert.equal(availability["gpt-5-6-sol"]?.available, false);
		assert.equal(availability["gpt-5-6-terra"]?.available, false);
		assert.equal(availability["claude-sonnet-5"]?.available, true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
