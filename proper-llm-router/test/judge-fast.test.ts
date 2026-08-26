import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const originalHome = process.env.HOME;
const testHome = mkdtempSync(join(tmpdir(), "proper-llm-router-judge-test-"));
process.env.HOME = testHome;
const {
	default: llmRouter,
	loadConfig,
	saveConfig,
} = await import("../llm-router.ts");
after(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	rmSync(testHome, { recursive: true, force: true });
});

const models = [
	"claude-haiku-4-5",
	"claude-sonnet-5",
	"claude-opus-5",
	"claude-fable-5",
	"gpt-5.6-luna",
	"gpt-5.6-terra",
	"gpt-5.6-sol",
].map((id) => ({
	provider: "cliproxyapi",
	id,
	api: "cliproxyapi-codex-responses",
}));

function inputHandler() {
	let handler:
		| ((event: any, ctx: any) => Promise<{ action: string }>)
		| undefined;
	llmRouter({
		on(name: string, candidate: typeof handler) {
			if (name === "input") handler = candidate;
		},
		registerCommand() {},
		async setModel() {
			return true;
		},
	} as unknown as Parameters<typeof llmRouter>[0]);
	assert.ok(handler);
	return handler;
}

// @lat: [[lat.md/proper-llm-router/tests#Verification#Command pin fixtures]]
test("defaults pin refine to the high-judgment arm", () => {
	const defaults = loadConfig("/__proper-llm-router-missing-config__.json");
	assert.deepEqual(defaults.commandPins.refine, {
		model: "claude-fable-5",
		effort: "xhigh",
	});
});

// @lat: [[lat.md/proper-llm-router/tests#Verification#Judge fast fixture]]
test("CPA judge uses Pi registry auth and forwards fast mode", async () => {
	const defaults = loadConfig("/__proper-llm-router-missing-config__.json");
	assert.equal(defaults.judge.fast, false);
	mkdirSync(join(testHome, ".pi", "agent"), { recursive: true });
	const handler = inputHandler();
	const captured: Array<{ model: any; options: Record<string, unknown> }> = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input) => {
		throw new Error(`unexpected raw network request: ${input}`);
	};

	// both CPA- and OpenAI-flavoured Codex Responses ids must take the
	// "required" toolChoice branch, so the judge entry's api varies per run
	const judgeEntry = models.find((model) => model.id === "gpt-5.6-terra");
	assert.ok(judgeEntry);
	const run = async (fast: boolean, api = "cliproxyapi-codex-responses") => {
		judgeEntry.api = api;
		saveConfig({
			...defaults,
			judge: { ...defaults.judge, fast },
		});
		await handler(
			{ text: "implement a specified parser", images: [] },
			{
				model: { provider: "llm-router", id: "auto" },
				modelRegistry: {
					getAvailable: () => models,
					find: (provider: string, id: string) =>
						models.find(
							(model) => model.provider === provider && model.id === id,
						),
					async complete(model: any, _context: unknown, options: any) {
						captured.push({ model, options });
						return {
							content: [
								{
									type: "toolCall",
									name: "route_model",
									arguments: {
										model: "gpt-5-6-terra",
										rationale: "fixture",
									},
								},
							],
						};
					},
				},
				ui: { notify() {}, onTerminalInput: undefined },
			},
		);
	};

	try {
		await run(true);
		await run(false);
		await run(false, "openai-codex-responses");
	} finally {
		globalThis.fetch = originalFetch;
	}

	assert.equal(captured.length, 3);
	assert.equal(captured[0]?.model.provider, "cliproxyapi");
	assert.equal(captured[0]?.model.id, "gpt-5.6-terra");
	assert.equal(captured[0]?.options.serviceTier, "priority");
	assert.equal(captured[0]?.options.toolChoice, "required");
	assert.equal("serviceTier" in (captured[1]?.options ?? {}), false);
	assert.equal(captured[1]?.options.toolChoice, "required");
	assert.equal(captured[2]?.options.toolChoice, "required");
});

// @lat: [[lat.md/proper-llm-router/tests#Verification#Legacy auth config migration]]
test("obsolete router auth fields are ignored", () => {
	const configPath = join(testHome, "legacy.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			judge: {
				baseUrl: "http://cpa.test/v1",
				apiKeyEnv: "OLD_KEY",
				model: "gpt-5.6-terra",
			},
			cpaKeyEnv: "OLD_KEY",
		}),
	);
	const config = loadConfig(configPath);
	assert.equal("baseUrl" in config.judge, false);
	assert.equal("apiKeyEnv" in config.judge, false);
	assert.equal("cpaKeyEnv" in config, false);
});
