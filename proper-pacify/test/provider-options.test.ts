import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import { stream } from "@earendil-works/pi-ai/api/anthropic-messages";
import { stream as streamBedrock } from "@earendil-works/pi-ai/api/bedrock-converse-stream";
import { stream as streamGoogle } from "@earendil-works/pi-ai/api/google-generative-ai";
import { completionOptions, DEFAULTS, pacifyText } from "../pacify.ts";

// @lat: [[proper-pacify/tests#Verification#Provider payload fixture]]
test("raw Anthropic payloads carry adaptive effort, budgeted thinking and explicit off", async () => {
	for (const variant of ["adaptive", "budget", "managed", "off"] as const) {
		const model: any = {
			provider: "anthropic",
			id: "claude-sonnet-4-6",
			api: "anthropic-messages",
			reasoning: true,
			maxTokens: 16384,
			contextWindow: 200000,
			baseUrl: "https://unused.invalid",
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			compat:
				variant === "budget"
					? {}
					: {
							forceAdaptiveThinking: true,
							supportsMidConvoEffort: variant === "managed",
						},
		};
		let payload: any;
		let requests = 0;
		const ctx: any = {
			scopedModels: [],
			model,
			modelRegistry: {
				getAvailable: () => [model],
				async complete(selected: any, context: any, options: any) {
					requests++;
					const response = await stream(selected, normalizeContext(context), {
						...options,
						client: {} as any,
						onPayload(value) {
							payload = value;
							throw new Error("payload captured before networking");
						},
					}).result();
					assert.match(response.errorMessage ?? "", /payload captured/);
					return {
						stopReason: "stop",
						content: [
							{ type: "text", text: "<rewrite>fix the parser now</rewrite>" },
						],
					};
				},
			},
		};
		await pacifyText(
			ctx,
			{
				...DEFAULTS,
				model: "anthropic/claude-sonnet-4-6",
				effort: variant === "off" ? null : "medium",
			},
			"fix the stupid parser now",
			new AbortController().signal,
		);
		assert.equal(requests, 1);
		assert.match(JSON.stringify(payload.system), /you have no tools/);
		assert.match(JSON.stringify(payload.messages), /Change tone only/);
		if (variant === "budget") {
			assert.equal(payload.thinking.type, "enabled");
			assert.equal(payload.thinking.budget_tokens, 8192);
			assert.ok(payload.max_tokens >= payload.thinking.budget_tokens + 1024);
		} else if (variant === "off") {
			assert.equal(payload.thinking.type, "disabled");
		} else {
			assert.equal(payload.thinking.type, "adaptive");
			// Pi 1.5.0 pins managed-effort models to a cap-safe top-level "low";
			// the requested level travels in the effort marker messages.
			assert.equal(
				payload.output_config.effort,
				variant === "managed" ? "low" : "medium",
			);
			if (variant === "managed")
				assert.match(JSON.stringify(payload.messages), /medium/);
		}
	}
});

test("budgeted thinking leaves answer room below the model ceiling", () => {
	const model: any = {
		api: "anthropic-messages",
		reasoning: true,
		maxTokens: 8192,
		contextWindow: 200000,
	};
	const options = completionOptions(
		model,
		DEFAULTS,
		new AbortController().signal,
		{ messages: [] },
		40,
	);
	assert.equal(options.maxTokens, 8192);
	assert.equal(
		"thinkingBudgetTokens" in options && options.thinkingBudgetTokens,
		7168,
	);
	assert.throws(
		() =>
			completionOptions(
				{ ...model, maxTokens: 1024 },
				DEFAULTS,
				new AbortController().signal,
				{ messages: [] },
				40,
			),
		/not enough token capacity/,
	);
});

test("raw Google payloads use model-supported levels or token budgets", async () => {
	for (const [id, expected] of [
		["gemini-3.1-pro-preview", { thinkingLevel: "HIGH" }],
		["gemini-3-flash-preview", { thinkingLevel: "MEDIUM" }],
		["gemini-2.5-pro", { thinkingBudget: 8192 }],
	] as const) {
		const model: any = {
			provider: "google",
			id,
			api: "google-generative-ai",
			reasoning: true,
			maxTokens: 32768,
			contextWindow: 200000,
			baseUrl: "https://unused.invalid",
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
		const context = {
			messages: [
				{ role: "user" as const, content: "fix the parser", timestamp: 0 },
			],
		};
		const options = completionOptions(
			model,
			DEFAULTS,
			new AbortController().signal,
			context,
			40,
		);
		let payload: any;
		const response = await streamGoogle(model, normalizeContext(context), {
			...options,
			apiKey: "offline-test",
			onPayload(value) {
				payload = value;
				throw new Error("payload captured before networking");
			},
		}).result();
		assert.match(response.errorMessage ?? "", /payload captured/);
		assert.deepEqual(payload.config.thinkingConfig, {
			includeThoughts: true,
			...expected,
		});
		assert.ok(payload.config.maxOutputTokens >= 9216);
	}
});

test("raw Bedrock thinking reserves answer tokens on budget and adaptive Claude", async () => {
	for (const id of [
		"anthropic.claude-sonnet-4-20250514-v1:0",
		"anthropic.claude-sonnet-4-6",
	]) {
		const model: any = {
			provider: "amazon-bedrock",
			id,
			name: id,
			api: "bedrock-converse-stream",
			reasoning: true,
			maxTokens: 16384,
			contextWindow: 200000,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
		const context = {
			messages: [
				{ role: "user" as const, content: "fix the parser", timestamp: 0 },
			],
		};
		const options = completionOptions(
			model,
			DEFAULTS,
			new AbortController().signal,
			context,
			40,
		);
		let payload: any;
		const response = await streamBedrock(model, normalizeContext(context), {
			...options,
			region: "us-east-1",
			bearerToken: "offline-test",
			onPayload(value) {
				payload = value;
				throw new Error("payload captured before networking");
			},
		}).result();
		assert.match(response.errorMessage ?? "", /payload captured/);
		const thinking = payload.additionalModelRequestFields.thinking;
		assert.equal(thinking.type, id.endsWith("4-6") ? "adaptive" : "enabled");
		if (thinking.type === "enabled")
			assert.ok(
				payload.inferenceConfig.maxTokens >= thinking.budget_tokens + 1024,
			);
	}
});
