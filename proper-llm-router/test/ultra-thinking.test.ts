import assert from "node:assert/strict";
import { test } from "node:test";
import {
	installUltraThemePrototype,
	installUltraThinkingPrototype,
	THINKING_LEVELS,
	thinkingLevelsForModel,
	ULTRA_THINKING_SHIM_INSTALLED,
} from "../llm-router.ts";
import {
	AgentSession,
	Theme,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import { stream as streamOpenAIResponses } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js";

class FakeSession {
	model?: { thinkingLevelMap?: Record<string, string | null> };

	getAvailableThinkingLevels(): string[] {
		return ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	}

	_clampThinkingLevel(_level: string, _available: string[]): string {
		return "off";
	}
}

class FakeTheme {
	fg(color: string, text: string): string {
		return `${color}:${text}`;
	}

	getThinkingBorderColor(level: string): (text: string) => string {
		return (text) => `${level}:${text}`;
	}
}

test("ultra is exposed only for models that advertise it", () => {
	assert.equal(THINKING_LEVELS.at(-1), "ultra");
	assert.equal(
		thinkingLevelsForModel({ thinkingLevelMap: { ultra: null } }).includes(
			"ultra",
		),
		false,
	);
	assert.equal(
		thinkingLevelsForModel({ thinkingLevelMap: { ultra: "ultra" } }).at(-1),
		"ultra",
	);
	assert.equal(installUltraThinkingPrototype(FakeSession), true);
	assert.equal(installUltraThinkingPrototype(FakeSession), false);

	const session = new FakeSession();
	session.model = { thinkingLevelMap: { max: "max", ultra: "ultra" } };
	assert.deepEqual(session.getAvailableThinkingLevels(), [
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
		"ultra",
	]);

	session.model = { thinkingLevelMap: { max: "max", ultra: null } };
	assert.equal(session.getAvailableThinkingLevels().includes("ultra"), false);
	assert.equal(
		session._clampThinkingLevel("ultra", ["off", "xhigh", "max"]),
		"max",
	);
});

test("the shim reaches the host classes through the public package export", () => {
	// The bare specifier resolves to the same module instance in this
	// process, so the markers prove the module-load shim patched the real
	// pinned-runtime classes rather than a private dist path.
	const marker = (prototype: object, key: string): unknown =>
		(prototype as unknown as Record<symbol, unknown>)[Symbol.for(key)];
	assert.equal(ULTRA_THINKING_SHIM_INSTALLED, true);
	assert.equal(
		marker(AgentSession.prototype, "proper-llm-router.ultra-session-patch"),
		true,
	);
	assert.equal(
		marker(Theme.prototype, "proper-llm-router.ultra-theme-patch"),
		true,
	);
	// Same class identity: reinstalling is the idempotent no-op path.
	assert.equal(
		installUltraThinkingPrototype(
			AgentSession as unknown as Parameters<
				typeof installUltraThinkingPrototype
			>[0],
		),
		false,
	);
	assert.equal(
		installUltraThemePrototype(
			Theme as unknown as Parameters<typeof installUltraThemePrototype>[0],
		),
		false,
	);
});

test("ultra uses the maximum thinking border color", () => {
	assert.equal(installUltraThemePrototype(FakeTheme), true);
	assert.equal(installUltraThemePrototype(FakeTheme), false);
	const theme = new FakeTheme();
	assert.equal(
		theme.getThinkingBorderColor("ultra")("prompt"),
		"thinkingMax:prompt",
	);
	assert.equal(theme.getThinkingBorderColor("high")("prompt"), "high:prompt");
});

test("OpenAI Responses sends the model's ultra effort mapping", async () => {
	let payload: any;
	const events = streamOpenAIResponses(
		{
			id: "gpt-ultra-test",
			name: "GPT ultra test",
			api: "openai-responses",
			provider: "cliproxyapi",
			baseUrl: "http://127.0.0.1:1/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 10_000,
			thinkingLevelMap: { ultra: "ultra" },
		} as any,
		{
			systemPrompt: "test",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "test" }],
					timestamp: Date.now(),
				},
			],
			tools: [],
		} as any,
		{
			apiKey: "test",
			reasoningEffort: "ultra",
			onPayload(value: any) {
				payload = value;
				throw new Error("payload captured");
			},
		} as any,
	);
	for await (const _event of events) {
		// The deliberate onPayload error ends the stream before network I/O.
	}
	assert.equal(payload.reasoning.effort, "ultra");
});
