import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const originalHome = process.env.HOME;
const testHome = mkdtempSync(join(tmpdir(), "proper-llm-router-test-"));
process.env.HOME = testHome;
const { default: llmRouter, resolveModelTarget } = await import(
	"../llm-router.ts"
);
after(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	rmSync(testHome, { recursive: true, force: true });
});

const directModels = [
	{
		provider: "openai-codex",
		id: "gpt-5.6-terra",
		api: "openai-codex-responses",
	},
	{
		provider: "anthropic",
		id: "claude-haiku-4-5",
		api: "anthropic-messages",
	},
	{
		provider: "anthropic",
		id: "claude-sonnet-5",
		api: "anthropic-messages",
	},
	{
		provider: "anthropic",
		id: "claude-opus-5",
		api: "anthropic-messages",
	},
	{
		provider: "anthropic",
		id: "claude-fable-5",
		api: "anthropic-messages",
	},
];

// @lat: [[lat.md/proper-llm-router/tests#Verification#Non-CPA routing fixture]]
test("model targets resolve across configured Pi providers", () => {
	assert.equal(resolveModelTarget("", directModels), undefined);
	assert.equal(
		resolveModelTarget("openai/gpt-5.6-terra", directModels),
		undefined,
	);
	assert.deepEqual(
		resolveModelTarget("claude-opus-5", directModels),
		directModels[3],
	);
	assert.deepEqual(
		resolveModelTarget("anthropic/claude-opus-5", directModels),
		directModels[3],
	);

	const withCpa = [
		...directModels,
		{ provider: "cliproxyapi", id: "claude-opus-5", api: "openai-responses" },
		{
			provider: "cliproxyapi",
			id: "claude-haiku-4-5-20251001",
			api: "openai-responses",
		},
	];
	assert.equal(
		resolveModelTarget("claude-opus-5", withCpa)?.provider,
		"cliproxyapi",
	);
	assert.equal(
		resolveModelTarget("claude-haiku-4-5", withCpa)?.provider,
		"cliproxyapi",
	);
});

// @lat: [[lat.md/proper-llm-router/tests#Verification#Non-CPA routing fixture]]
test("factory self-registers the llm-router/auto placeholder", () => {
	const registered: Array<
		[string, { baseUrl: string; models: { id: string }[] }]
	> = [];
	llmRouter({
		on() {},
		registerCommand() {},
		registerProvider(name: string, config: unknown) {
			registered.push([name, config as (typeof registered)[0][1]]);
		},
	} as unknown as Parameters<typeof llmRouter>[0]);
	assert.equal(registered.length, 1);
	const [name, config] = registered[0] ?? [];
	assert.equal(name, "llm-router");
	assert.equal(config?.models[0]?.id, "auto");
	assert.ok(config?.baseUrl.startsWith("http://127.0.0.1:1/"));
});

// @lat: [[lat.md/proper-llm-router/tests#Verification#Non-CPA routing fixture]]
test("first input routes through Pi providers without CPA", async () => {
	let inputHandler:
		| ((event: any, ctx: any) => Promise<{ action: string }>)
		| undefined;
	let switched: any;
	let completed = 0;
	const notices: string[] = [];
	const pi = {
		on(name: string, handler: typeof inputHandler) {
			if (name === "input") inputHandler = handler;
		},
		registerCommand() {},
		async setModel(model: unknown) {
			switched = model;
			return true;
		},
	};
	llmRouter(pi as unknown as Parameters<typeof llmRouter>[0]);
	assert.ok(inputHandler);

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input) => {
		throw new Error(`unexpected network request: ${input}`);
	};
	try {
		const models = directModels.map((model) => ({ ...model }));
		const ctx = {
			model: { provider: "llm-router", id: "auto" },
			modelRegistry: {
				getAvailable: () => models,
				find: (provider: string, id: string) =>
					models.find(
						(model) => model.provider === provider && model.id === id,
					),
				async complete() {
					completed += 1;
					return {
						content: [
							{
								type: "toolCall",
								name: "route_model",
								arguments: {
									model: "claude-opus-5",
									rationale: "localized repository fix",
								},
							},
						],
					};
				},
			},
			ui: {
				notify(message: string) {
					notices.push(message);
				},
				onTerminalInput: undefined,
			},
		};
		await inputHandler({ text: "fix typo in README.md", images: [] }, ctx);
		assert.equal(completed, 1);
		assert.equal(switched?.provider, "anthropic", notices.join("\n"));
		assert.equal(switched?.id, "claude-opus-5");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// @lat: [[lat.md/proper-llm-router/tests#Verification#Non-CPA routing fixture]]
test("pinned commands switch direct providers without CPA", async () => {
	let inputHandler:
		| ((event: any, ctx: any) => Promise<{ action: string }>)
		| undefined;
	let switched: any;
	llmRouter({
		on(name: string, handler: typeof inputHandler) {
			if (name === "input") inputHandler = handler;
		},
		registerCommand() {},
		async setModel(model: unknown) {
			switched = model;
			return true;
		},
	} as unknown as Parameters<typeof llmRouter>[0]);
	assert.ok(inputHandler);

	const models = directModels.map((model) => ({ ...model }));
	await inputHandler(
		{ text: "/file diagnose the parser", images: [] },
		{
			model: { provider: "llm-router", id: "auto" },
			modelRegistry: {
				getAvailable: () => models,
				find: (provider: string, id: string) =>
					models.find(
						(model) => model.provider === provider && model.id === id,
					),
			},
			ui: { notify() {} },
		},
	);
	assert.equal(switched?.provider, "anthropic");
	assert.equal(switched?.id, "claude-fable-5");
});

// @lat: [[lat.md/proper-llm-router/tests#Verification#Non-CPA config fixture]]
test("config UI preselects values and wraps backward", async () => {
	let configHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
	llmRouter({
		on() {},
		registerCommand(name: string, command: { handler: typeof configHandler }) {
			if (name === "llm-router-config") configHandler = command.handler;
		},
	} as unknown as Parameters<typeof llmRouter>[0]);
	assert.ok(configHandler);

	let wrapped: string | undefined;
	await configHandler("", {
		hasUI: true,
		mode: "tui",
		modelRegistry: { getAvailable: () => directModels },
		ui: {
			notify() {},
			select: async () => {
				throw new Error("config picker should use custom UI in TUI mode");
			},
			custom: async (factory: any) => {
				const component = factory(
					{ requestRender() {} },
					{
						fg: (_color: string, text: string) => text,
						bold: (text: string) => text,
					},
					{},
					(value: string | undefined) => {
						wrapped = value;
					},
				);
				component.handleInput("\x1b[A");
				component.handleInput("\r");
				return wrapped;
			},
		},
	});
	assert.equal(wrapped, "Done");

	mkdirSync(join(testHome, ".pi", "agent"), { recursive: true });
	const picks: string[] = [];
	let menu = 0;
	const inputs = [
		["\r"],
		["\r"],
		["\r"],
		["\r"],
		["\x1b[B", "\x1b[B", "\r"],
		["\r"],
		["\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\r"],
	];
	await configHandler("", {
		hasUI: true,
		mode: "tui",
		modelRegistry: { getAvailable: () => directModels },
		ui: {
			notify() {},
			select: async () => {
				throw new Error("config picker should use custom UI in TUI mode");
			},
			custom: async (factory: any) => {
				let selected: string | undefined;
				const component = factory(
					{ requestRender() {} },
					{
						fg: (_color: string, text: string) => text,
						bold: (text: string) => text,
					},
					{},
					(value: string | undefined) => {
						selected = value;
					},
				);
				for (const input of inputs[menu++] ?? []) component.handleInput(input);
				if (selected) picks.push(selected);
				return selected;
			},
		},
	});
	assert.deepEqual(picks.slice(0, 2), ["Judge", "Model"]);
	assert.equal(picks[2]?.startsWith("openai-codex/gpt-5.6-terra"), true);
	assert.deepEqual(picks.slice(3, 5), ["Judge", "Fast"]);
	assert.equal(picks[5]?.startsWith("off"), true);
	assert.equal(picks[6], "Done");
});

// @lat: [[lat.md/proper-llm-router/tests#Verification#Non-CPA config fixture]]
test("config UI hides CPA-only controls and JSON fields without CPA", async () => {
	let configHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
	llmRouter({
		on() {},
		registerCommand(name: string, command: { handler: typeof configHandler }) {
			if (name === "llm-router-config") configHandler = command.handler;
		},
	} as unknown as Parameters<typeof llmRouter>[0]);
	assert.ok(configHandler);

	const menus: string[][] = [];
	const replies: Array<string | undefined> = [
		"Edit full config (JSON)",
		"Done",
	];
	let edited = "";
	await configHandler("", {
		hasUI: true,
		modelRegistry: { getAvailable: () => directModels },
		ui: {
			notify() {},
			select: async (_title: string, items: string[]) => {
				menus.push(items);
				return replies.shift();
			},
			editor: async (_title: string, value: string) => {
				edited = value;
				return undefined;
			},
		},
	});

	assert.equal((menus[0] ?? []).includes("Quota threshold"), false);
	assert.equal((menus[0] ?? []).includes("CPA management key"), false);
	const visible = JSON.parse(edited);
	for (const key of [
		"cpaBase",
		"cpaKeyEnv",
		"quotaMaxPct",
		"cpaManagementKey",
		"cpaManagementKeyEnv",
	]) {
		assert.equal(key in visible, false, key);
	}
});
