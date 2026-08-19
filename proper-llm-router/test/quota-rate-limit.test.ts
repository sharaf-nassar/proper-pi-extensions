import assert from "node:assert/strict";
import { test } from "node:test";

import { armAvailability, loadConfig } from "../llm-router.ts";

// @lat: [[lat.md/proper-llm-router/tests#Verification#Usage rate-limit fixture]]
test("upstream usage 429 blocks that account's lane at the quota threshold", async () => {
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
					"claude-haiku-4-5-20251001",
					"claude-sonnet-5",
					"claude-opus-5",
					"claude-fable-5",
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
						auth_index: "claude-account",
						provider: "claude",
						disabled: false,
						unavailable: false,
					},
				],
			});
		}
		if (url.endsWith("/v0/management/api-call")) {
			return Response.json({
				status_code: 429,
				body: {
					type: "error",
					error: { type: "rate_limit_error" },
				},
			});
		}
		throw new Error(`unexpected fetch: ${url}`);
	};

	try {
		const availability = await armAvailability(cfg);
		assert.equal(availability["claude-haiku-4-5"]?.available, false);
		assert.equal(availability["claude-fable-5"]?.available, false);
		assert.equal(availability["gpt-5-6-sol"]?.available, true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
