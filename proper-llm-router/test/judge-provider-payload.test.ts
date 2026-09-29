import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import { stream as anthropicStream } from "@earendil-works/pi-ai/api/anthropic-messages";
import { stream as bedrockStream } from "@earendil-works/pi-ai/api/bedrock-converse-stream";
import { stream as googleStream } from "@earendil-works/pi-ai/api/google-generative-ai";
import { stream as openAICompletionsStream } from "@earendil-works/pi-ai/api/openai-completions";
import { stream as openAIResponsesStream } from "@earendil-works/pi-ai/api/openai-responses";

const originalHome = process.env.HOME;
const testHome = mkdtempSync(join(tmpdir(), "proper-llm-router-payload-test-"));
process.env.HOME = testHome;
delete process.env.PI_CODING_AGENT_DIR; // keep models.json migration in the temp home
// Clear inherited routing env overrides so they cannot disable routing during tests.
const originalRouterOff = process.env.LLM_ROUTER_OFF;
const originalRouterOn = process.env.LLM_ROUTER_ON;
delete process.env.LLM_ROUTER_OFF;
delete process.env.LLM_ROUTER_ON;
const {
	default: llmRouter,
	loadConfig,
	saveConfig,
} = await import("../llm-router.ts");
after(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	if (originalRouterOff === undefined) delete process.env.LLM_ROUTER_OFF;
	else process.env.LLM_ROUTER_OFF = originalRouterOff;
	if (originalRouterOn === undefined) delete process.env.LLM_ROUTER_ON;
	else process.env.LLM_ROUTER_ON = originalRouterOn;
	rmSync(testHome, { recursive: true, force: true });
});

const baseModel = {
	provider: "openai",
	id: "gpt-5.6-terra",
	name: "gpt-5.6-terra",
	api: "openai-responses",
	baseUrl: "https://example.invalid/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 16384,
	compat: { supportsStrictMode: true },
};

async function judgePayload(model: any): Promise<unknown[]> {
	let inputHandler:
		| ((event: any, ctx: any) => Promise<{ action: string }>)
		| undefined;
	const payloads: unknown[] = [];
	const notices: string[] = [];
	llmRouter({
		on(name: string, handler: typeof inputHandler) {
			if (name === "input") inputHandler = handler;
		},
		registerVirtualModel() {},
		registerCommand() {},
		async setModel() {
			return true;
		},
	} as unknown as Parameters<typeof llmRouter>[0]);
	assert.ok(inputHandler);

	mkdirSync(join(testHome, ".pi", "agent"), { recursive: true });
	const defaults = loadConfig("/__proper-llm-router-missing-config__.json");
	saveConfig({
		...defaults,
		judge: {
			...defaults.judge,
			model: `${model.provider}/${model.id}`,
			effort: "medium",
		},
		fallbackModel: `${model.provider}/${model.id}`,
	});
	await inputHandler(
		{ text: "implement a specified parser", images: [] },
		{
			model: { provider: "llm-router", id: "auto" },
			modelRegistry: {
				getAvailable: () => [model],
				find: (provider: string, id: string) =>
					provider === model.provider && id === model.id ? model : undefined,
				async complete(requestModel: any, context: any, options: any) {
					const stream =
						requestModel.api === "anthropic-messages"
							? anthropicStream
							: requestModel.api === "google-generative-ai"
								? googleStream
								: requestModel.api === "bedrock-converse-stream"
									? bedrockStream
									: requestModel.api === "openai-completions"
										? openAICompletionsStream
										: openAIResponsesStream;
					const response = await stream(
						requestModel,
						normalizeContext(context),
						{
							...options,
							apiKey: "test-key",
							region: "us-east-1",
							bearerToken: "offline-test",
							onPayload(payload: unknown) {
								payloads.push(payload);
								throw new Error("stop before network");
							},
						},
					).result();
					if (response.stopReason === "error")
						throw new Error(response.errorMessage);
					return response;
				},
			},
			ui: {
				notify(message: string) {
					notices.push(message);
				},
				onTerminalInput: undefined,
			},
		},
	);
	if (!payloads.length) throw new Error(notices.join("\n"));
	return payloads;
}

// @lat: [[lat.md/proper-llm-router/tests#Verification#Provider payload fixtures]]
test("raw OpenAI Responses judge serializes a flat forced function", async () => {
	const payloads = await judgePayload({ ...baseModel });
	assert.equal(payloads.length, 2);
	for (const payload of payloads) {
		assert.ok(
			(payload as { tools: Array<{ name: string }> }).tools.some(
				(tool) => tool.name === "route_model",
			),
		);
		assert.deepEqual((payload as { tool_choice: unknown }).tool_choice, {
			type: "function",
			name: "route_model",
		});
	}
});

// @lat: [[lat.md/proper-llm-router/tests#Verification#Provider payload fixtures]]
test("raw Anthropic judge preserves thinking with compatible tool choice", async () => {
	const budgetPayloads = await judgePayload({
		...baseModel,
		provider: "anthropic",
		id: "claude-budget",
		api: "anthropic-messages",
		compat: { supportsStrictTools: true },
	});
	const budget = budgetPayloads[0] as {
		thinking: { type: string; budget_tokens: number };
		tools: Array<{ name: string }>;
		max_tokens: number;
		tool_choice: unknown;
	};
	assert.ok(budget.tools.some((tool) => tool.name === "route_model"));
	assert.equal(budget.thinking.type, "enabled");
	assert.equal(budget.thinking.budget_tokens, 7680);
	assert.equal(budget.max_tokens, 8704);
	assert.deepEqual(budget.tool_choice, { type: "auto" });

	const adaptivePayloads = await judgePayload({
		...baseModel,
		provider: "anthropic",
		id: "claude-adaptive",
		api: "anthropic-messages",
		compat: { forceAdaptiveThinking: true, supportsStrictTools: true },
		thinkingLevelMap: { medium: "low" },
	});
	const adaptive = adaptivePayloads[0] as {
		thinking: { type: string };
		output_config: { effort: string };
	};
	assert.equal(adaptive.thinking.type, "adaptive");
	assert.equal(adaptive.output_config.effort, "low");

	const managedPayloads = await judgePayload({
		...baseModel,
		provider: "anthropic",
		id: "claude-managed",
		api: "anthropic-messages",
		compat: { supportsMidConvoEffort: true, supportsStrictTools: true },
	});
	const managed = managedPayloads[0] as {
		thinking: { type: string };
		output_config: { effort: string };
	};
	assert.equal(managed.thinking.type, "adaptive");
	assert.equal(managed.output_config.effort, "high");
	assert.match(JSON.stringify(managed), /medium/);
});

test("Bedrock budget thinking uses automatic tools and reserves answer room", async () => {
	const payloads = await judgePayload({
		...baseModel,
		provider: "amazon-bedrock",
		id: "anthropic.claude-sonnet-4-20250514-v1:0",
		api: "bedrock-converse-stream",
	});
	const payload = payloads[0] as {
		additionalModelRequestFields: {
			thinking: { type: string; budget_tokens: number };
		};
		inferenceConfig: { maxTokens: number };
		toolConfig: { toolChoice: unknown };
	};
	assert.equal(payload.additionalModelRequestFields.thinking.type, "enabled");
	assert.ok(
		payload.inferenceConfig.maxTokens >=
			payload.additionalModelRequestFields.thinking.budget_tokens + 1024,
	);
	assert.deepEqual(payload.toolConfig.toolChoice, { auto: {} });
});

test("Google judge sends supported raw levels and leaves reasoning headroom", async () => {
	for (const [id, level] of [
		["gemini-3.1-pro-preview", "HIGH"],
		["gemini-3-flash-preview", "MEDIUM"],
	]) {
		const payloads = await judgePayload({
			...baseModel,
			provider: "google",
			id,
			api: "google-generative-ai",
		});
		const payload = payloads[0] as {
			config: { thinkingConfig: unknown; maxOutputTokens: number };
		};
		assert.deepEqual(payload.config.thinkingConfig, {
			includeThoughts: true,
			thinkingLevel: level,
		});
		assert.ok(payload.config.maxOutputTokens >= 9216);
	}
});

// @lat: [[lat.md/proper-llm-router/tests#Verification#Provider payload fixtures]]
// Pi 0.87 openai-completions defaults supportsStrictMode to false for unknown endpoints.
// route_model carries strict:"require", so absent or false capability fails before any
// payload is produced. The router falls back visibly.
test("openai-completions judge without supportsStrictMode fails before payload", async () => {
	const base = {
		...baseModel,
		provider: "custom",
		id: "custom-chat-model",
		name: "custom-chat-model",
		api: "openai-completions",
	};
	// absent compat: supportsStrictMode defaults false, strict require throws
	await assert.rejects(
		() => judgePayload({ ...base, compat: undefined }),
		/requires JSON-schema constrained sampling/,
	);
	// explicit false: same result
	await assert.rejects(
		() => judgePayload({ ...base, compat: { supportsStrictMode: false } }),
		/requires JSON-schema constrained sampling/,
	);
});

// @lat: [[lat.md/proper-llm-router/tests#Verification#Provider payload fixtures]]
// Endpoints that explicitly advertise supportsStrictMode:true produce the nested
// Chat Completions function shape, distinct from the flat Responses form.
test("openai-completions judge with supportsStrictMode:true reaches payload with nested function", async () => {
	// A non-Claude ID: Claude judges never force the tool (see judge-fast).
	const payloads = await judgePayload({
		...baseModel,
		provider: "custom",
		id: "custom-chat-model",
		name: "custom-chat-model",
		api: "openai-completions",
		compat: { supportsStrictMode: true },
	});
	assert.ok(payloads.length >= 1);
	const payload = payloads[0] as {
		tools: Array<{
			type: string;
			function: { name: string; strict?: boolean };
		}>;
		tool_choice: unknown;
	};
	const routeTool = payload.tools.find(
		(tool) => tool.type === "function" && tool.function.name === "route_model",
	);
	assert.ok(routeTool);
	assert.equal(routeTool.function.strict, true);
	// Nested Chat Completions form, not the flat Responses form.
	assert.deepEqual(payload.tool_choice, {
		type: "function",
		function: { name: "route_model" },
	});
});
