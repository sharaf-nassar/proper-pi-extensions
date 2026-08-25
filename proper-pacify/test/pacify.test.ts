import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const testDir = mkdtempSync(join(tmpdir(), "proper-pacify-test-"));
process.env.PI_CODING_AGENT_DIR = testDir;
const {
	DEFAULTS,
	PacifyError,
	automaticModeEnabled,
	buildSystemPrompt,
	describeAuto,
	default: properPacify,
	isWithinSchedule,
	loadConfig,
	parseTimeOfDay,
	installInputPriorityPrototype,
	pacifyText,
	resolveEffort,
	resolveModel,
	saveConfig,
	splitCommandPrefix,
	supportedEfforts,
} = await import("../pacify.ts");

after(() => rmSync(testDir, { recursive: true, force: true }));

/** Minimal stand-in for a finished assistant message. */
const reply = (text: string, stopReason = "stop"): ModelReply =>
	({
		content: [{ type: "text", text }],
		stopReason,
	}) as unknown as ModelReply;

type TestModels = Parameters<typeof resolveModel>[1];
type TestContext = Parameters<typeof pacifyText>[0];
type TestPi = Parameters<typeof properPacify>[0];
type TestRunner = Parameters<typeof installInputPriorityPrototype>[0];
type ModelReply = Awaited<ReturnType<TestContext["modelRegistry"]["complete"]>>;
type TerminalInputHook =
	| ((handler: (data: string) => unknown) => () => void)
	| undefined;

const models = [
	{
		provider: "openai-codex",
		id: "gpt-5.6-luna",
		api: "openai-codex-responses",
		reasoning: true,
		thinkingLevelMap: {
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max",
		},
		maxTokens: 8192,
	},
	{
		provider: "cliproxyapi",
		id: "gpt-5.6-luna",
		api: "openai-responses",
		reasoning: true,
		thinkingLevelMap: {
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max",
		},
		maxTokens: 8192,
	},
	{
		provider: "anthropic",
		id: "claude-haiku-4-5",
		api: "anthropic-messages",
		reasoning: true,
		thinkingLevelMap: {
			minimal: "minimal",
			low: "low",
			medium: "medium",
			high: "high",
		},
		maxTokens: 8192,
	},
] as unknown as TestModels;

// @lat: [[proper-pacify/tests#Verification#Configuration and model resolution]]
test("configuration and model resolution stay deterministic", () => {
	const missing = join(testDir, "missing.json");
	assert.deepEqual(loadConfig(missing), DEFAULTS);

	const configPath = join(testDir, "nested", "pacify.json");
	saveConfig(
		{
			model: "anthropic/claude-haiku-4-5",
			effort: null,
			fast: true,
			prompt: "Keep it gentle.",
			auto: true,
		},
		configPath,
	);
	assert.equal(JSON.parse(readFileSync(configPath, "utf8")).auto, true);

	writeFileSync(
		configPath,
		JSON.stringify({ model: "", effort: "extreme", fast: "yes", auto: 1 }),
	);
	assert.deepEqual(loadConfig(configPath), DEFAULTS);
	assert.equal(
		resolveModel("anthropic/claude-haiku-4-5", models)?.provider,
		"anthropic",
	);
	assert.equal(resolveModel("gpt-5.6-luna", models)?.provider, "cliproxyapi");
	assert.equal(
		resolveModel("gpt-5.6-luna", models, "openai-codex")?.provider,
		"openai-codex",
	);
	assert.deepEqual(splitCommandPrefix("/skill:review fix this"), {
		prefix: "/skill:review ",
		body: "fix this",
	});
	const [luna] = models;
	assert.ok(luna);
	assert.deepEqual(supportedEfforts(luna), [
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]);
	assert.equal(resolveEffort(luna, "minimal"), "low");
});

// @lat: [[proper-pacify/tests#Verification#Model request contract]]
test("pacify sends tone-only instructions and configured request options", async () => {
	const captured: any[] = [];
	const response = {
		content: [{ type: "text", text: "Could you please fix this now?" }],
		stopReason: "stop",
	};
	const ctx = {
		model: { provider: "openai-codex" },
		scopedModels: [],
		modelRegistry: {
			getAvailable: () => models,
			async complete(model: unknown, context: unknown, options: unknown) {
				captured.push({ model, context, options });
				return response;
			},
		},
	} as unknown as TestContext;
	const input = "Fix this now.";
	const result = await pacifyText(
		ctx,
		{ ...DEFAULTS, model: "openai-codex/gpt-5.6-luna", fast: true },
		input,
		new AbortController().signal,
	);
	assert.equal(result.text, "Could you please fix this now?");
	assert.equal(captured[0].context.messages[0].content, input);
	assert.match(captured[0].context.systemPrompt, /Change tone only/);
	assert.match(captured[0].context.systemPrompt, /neutral-professional/);
	assert.match(
		captured[0].context.systemPrompt,
		/change only the spans listed below/,
	);
	assert.match(captured[0].context.systemPrompt, /Everything else is content/);
	assert.match(buildSystemPrompt("Keep it warm."), /cannot override/);
	assert.equal(captured[0].options.reasoningEffort, "medium");
	assert.equal(captured[0].options.serviceTier, "priority");
	assert.equal(captured.length, 1);

	ctx.modelRegistry.complete = async () => reply("partial", "length");
	await assert.rejects(
		pacifyText(ctx, DEFAULTS, input, new AbortController().signal),
		PacifyError,
	);
});

// @lat: [[proper-pacify/tests#Verification#Extension flow]]
test("commands and auto mode log both prompts and send pacified user text", async () => {
	const configPath = join(testDir, "pacify.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			...DEFAULTS,
			model: "openai-codex/gpt-5.6-luna",
			effort: "minimal",
			auto: true,
		}),
	);
	const commands = new Map<string, any>();
	let inputHandler: ((event: any, ctx: any) => Promise<any>) | undefined;
	const entries: any[] = [];
	const sent: Array<{ text: string; options: unknown }> = [];
	const pi = {
		registerEntryRenderer() {},
		registerCommand(name: string, command: unknown) {
			commands.set(name, command);
		},
		on(name: string, handler: typeof inputHandler) {
			if (name === "input") inputHandler = handler;
		},
		appendEntry(type: string, data: unknown) {
			entries.push({ type, data });
		},
		sendUserMessage(text: string, options: unknown) {
			sent.push({ text, options });
		},
	};
	properPacify(pi as unknown as TestPi);
	assert.ok(commands.has("pacify"));
	assert.ok(commands.has("pacify-config"));
	assert.ok(inputHandler);

	const outputs = [
		"could you please fix this now",
		"could you please check this",
		"could you fix this now",
	];
	const notifications: Array<{ message: string; level: string }> = [];
	const ctx = {
		model: { provider: "openai-codex" },
		scopedModels: [],
		modelRegistry: {
			getAvailable: () => models,
			async complete() {
				return reply(outputs.shift() ?? "");
			},
		},
		ui: {
			setStatus() {
				throw new Error("progress belongs in the session log, not the footer");
			},
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
			onTerminalInput: undefined as TerminalInputHook,
		},
	};
	const transformed = await inputHandler(
		{
			text: "/skill:review fix this now",
			images: [{ type: "image" }],
			source: "interactive",
		},
		ctx,
	);
	assert.equal(transformed.text, "/skill:review could you please fix this now");
	assert.equal(entries[0].data.before, "/skill:review fix this now");
	assert.equal(entries[0].data.after, transformed.text);
	assert.equal(entries[0].data.effort, "low");
	assert.match(notifications[0]?.message ?? "", /pacifying with/);
	assert.equal(notifications[0]?.level, "info");

	const extensionPrompt = await inputHandler(
		{ text: "check this", source: "extension" },
		ctx,
	);
	assert.equal(extensionPrompt.text, "could you please check this");

	await commands.get("pacify").handler("/file fix this now", {
		...ctx,
		waitForIdle: async () => {},
	});
	assert.deepEqual(sent, [
		{
			text: "/file could you fix this now",
			options: { expandPromptTemplates: true },
		},
	]);
	assert.equal(entries[2].data.source, "command");
	assert.deepEqual(
		await inputHandler({ text: sent[0]?.text ?? "", source: "extension" }, ctx),
		{ action: "continue" },
	);

	const menu = ["Effort", "Model", "Fast", "Tone prompt", "Auto", "Done"];
	await commands.get("pacify-config").handler("", {
		...ctx,
		hasUI: true,
		waitForIdle: async () => {},
		ui: {
			...ctx.ui,
			async select(title: string, options: string[]) {
				if (title.startsWith("Pacify:")) return menu.shift();
				if (title === "Pacify model") {
					return "anthropic/claude-haiku-4-5";
				}
				if (title === "Pacify effort") {
					assert.equal(options.includes("minimal"), false);
					assert.equal(options.includes("low"), true);
					return "none";
				}
				if (title === "Priority service tier") return "on";
				if (title === "Pacify every user prompt") return "off";
				return undefined;
			},
			async editor() {
				return "Keep it kind.";
			},
		},
	});
	assert.deepEqual(loadConfig(configPath), {
		model: "anthropic/claude-haiku-4-5",
		effort: null,
		fast: true,
		prompt: "Keep it kind.",
		auto: false,
	});
	assert.deepEqual(
		await inputHandler({ text: "auto is off", source: "interactive" }, ctx),
		{ action: "continue" },
	);

	writeFileSync(
		configPath,
		JSON.stringify({ ...loadConfig(configPath), auto: true }),
	);
	ctx.ui.onTerminalInput = (handler: (data: string) => unknown) => {
		handler("\x1b");
		return () => {};
	};
	ctx.modelRegistry.complete = async () => reply("ignored");
	assert.deepEqual(
		await inputHandler({ text: "cancel this", source: "interactive" }, ctx),
		{ action: "handled" },
	);
	assert.match(notifications.at(-1)?.message ?? "", /cancelled/);

	ctx.ui.onTerminalInput = undefined;
	ctx.modelRegistry.complete = async () => {
		throw new Error("provider down");
	};
	assert.deepEqual(
		await inputHandler({ text: "keep original", source: "interactive" }, ctx),
		{ action: "continue" },
	);
	assert.equal(entries.at(-1).data.before, "keep original");
	assert.equal(entries.at(-1).data.after, "keep original");
	assert.match(entries.at(-1).data.error, /provider down/);
	assert.match(notifications.at(-1)?.message ?? "", /sending original/);
});

// @lat: [[proper-pacify/tests#Verification#Dispatch priority fixture]]
test("pacification runs before foreign input handlers regardless of load order", async () => {
	const configPath = join(testDir, "pacify.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			...DEFAULTS,
			model: "openai-codex/gpt-5.6-luna",
			auto: true,
		}),
	);

	const seenByForeignHandler: string[] = [];
	const entries: any[] = [];
	const ctx = {
		model: { provider: "openai-codex" },
		scopedModels: [],
		modelRegistry: {
			getAvailable: () => models,
			async complete() {
				return reply("please fix the parser now");
			},
		},
		ui: {
			setStatus() {},
			notify() {},
			onTerminalInput: undefined as TerminalInputHook,
		},
	};

	let ownHandler: ((event: any, ctx: any) => Promise<any>) | undefined;
	properPacify({
		registerEntryRenderer() {},
		registerCommand() {},
		on(name: string, handler: typeof ownHandler) {
			if (name === "input") ownHandler = handler;
		},
		appendEntry(type: string, data: unknown) {
			entries.push({ type, data });
		},
		sendUserMessage() {},
	} as unknown as TestPi);

	// A foreign extension registered ahead of this package: its handler is the
	// first entry in the chain, exactly as Pi orders it from settings.
	class FakeRunner {
		createContext() {
			return ctx as unknown as TestContext;
		}
		async emitInput(text: string, _images?: unknown, _source?: string) {
			seenByForeignHandler.push(text);
			const own = await ownHandler?.({ text, source: "interactive" }, ctx);
			return own ?? { action: "continue" };
		}
	}

	assert.equal(
		installInputPriorityPrototype(FakeRunner as unknown as TestRunner),
		true,
	);
	assert.equal(
		installInputPriorityPrototype(FakeRunner as unknown as TestRunner),
		false,
	);

	const result = await new FakeRunner().emitInput(
		"fix this stupid parser now",
		undefined,
		"interactive",
	);

	assert.deepEqual(seenByForeignHandler, ["please fix the parser now"]);
	assert.deepEqual(result, {
		action: "transform",
		text: "please fix the parser now",
	});
	assert.equal(entries.length, 1);
	assert.equal(entries[0].data.before, "fix this stupid parser now");
	assert.equal(entries[0].data.after, "please fix the parser now");
});

// @lat: [[proper-pacify/tests#Verification#Session override fixture]]
test("session command toggles automatic mode without touching stored config", async () => {
	const configPath = join(testDir, "pacify.json");
	const stored = {
		...DEFAULTS,
		model: "openai-codex/gpt-5.6-luna",
		auto: false,
	};
	writeFileSync(configPath, JSON.stringify(stored));

	const commands = new Map<string, any>();
	let inputHandler: ((event: any, ctx: any) => Promise<any>) | undefined;
	let sessionStart: ((event: any) => void) | undefined;
	const notifications: string[] = [];
	properPacify({
		registerEntryRenderer() {},
		registerCommand(name: string, command: unknown) {
			commands.set(name, command);
		},
		on(name: string, handler: any) {
			if (name === "input") inputHandler = handler;
			if (name === "session_start") sessionStart = handler;
		},
		appendEntry() {},
		sendUserMessage() {},
	} as unknown as TestPi);
	assert.ok(inputHandler);
	assert.ok(sessionStart);

	const ctx = {
		model: { provider: "openai-codex" },
		scopedModels: [],
		modelRegistry: {
			getAvailable: () => models,
			async complete() {
				return reply("please review the parser");
			},
		},
		ui: {
			setStatus() {
				throw new Error("progress belongs in the session log, not the footer");
			},
			notify(message: string) {
				notifications.push(message);
			},
			onTerminalInput: undefined as TerminalInputHook,
		},
	};

	// Stored default is off, so nothing is pacified yet.
	assert.deepEqual(
		await inputHandler(
			{ text: "review the parser", source: "interactive" },
			ctx,
		),
		{ action: "continue" },
	);

	await commands.get("pacify-session").handler("", ctx);
	assert.match(notifications.at(-1) ?? "", /on for this session/);
	assert.equal(
		JSON.parse(readFileSync(configPath, "utf8")).auto,
		false,
		"stored default must stay untouched",
	);

	const enabled = await inputHandler(
		{ text: "review the parser", source: "interactive" },
		ctx,
	);
	assert.equal(enabled.action, "transform");
	assert.equal(enabled.text, "please review the parser");

	// Toggling again disables it for the session.
	await commands.get("pacify-session").handler("", ctx);
	assert.match(notifications.at(-1) ?? "", /off for this session/);
	assert.deepEqual(
		await inputHandler(
			{ text: "review the parser", source: "interactive" },
			ctx,
		),
		{ action: "continue" },
	);

	// A replacement session drops the override; a reload keeps it.
	await commands.get("pacify-session").handler("", ctx);
	sessionStart({ reason: "reload" });
	assert.equal(
		(
			await inputHandler(
				{ text: "review the parser", source: "interactive" },
				ctx,
			)
		).action,
		"transform",
	);
	sessionStart({ reason: "new" });
	assert.deepEqual(
		await inputHandler(
			{ text: "review the parser", source: "interactive" },
			ctx,
		),
		{ action: "continue" },
	);
});

// @lat: [[proper-pacify/tests#Verification#Scheduled automatic mode fixture]]
test("scheduled automatic mode covers windows, wrapping, and bad input", () => {
	const at = (hours: number, minutes = 0) =>
		new Date(2026, 0, 15, hours, minutes);

	assert.equal(parseTimeOfDay("09:00"), 540);
	assert.equal(parseTimeOfDay("23:59"), 1439);
	for (const bad of ["24:00", "09:60", "9:00", "0900", "", "nine"]) {
		assert.equal(parseTimeOfDay(bad), undefined, bad);
	}

	const day = { start: "09:00", end: "17:00" };
	assert.equal(isWithinSchedule(day, at(8, 59)), false);
	assert.equal(isWithinSchedule(day, at(9, 0)), true, "start is inclusive");
	assert.equal(isWithinSchedule(day, at(16, 59)), true);
	assert.equal(isWithinSchedule(day, at(17, 0)), false, "end is exclusive");

	const overnight = { start: "22:00", end: "06:00" };
	assert.equal(isWithinSchedule(overnight, at(23, 30)), true);
	assert.equal(isWithinSchedule(overnight, at(2, 0)), true);
	assert.equal(isWithinSchedule(overnight, at(6, 0)), false);
	assert.equal(isWithinSchedule(overnight, at(12, 0)), false);

	// A zero-length or malformed window never enables automatic mode.
	assert.equal(
		isWithinSchedule({ start: "09:00", end: "09:00" }, at(9, 0)),
		false,
	);
	assert.equal(
		isWithinSchedule({ start: "oops", end: "17:00" }, at(12, 0)),
		false,
	);

	// Stored schedules survive a round trip; invalid ones fall back to off.
	const configPath = join(testDir, "scheduled.json");
	saveConfig({ ...DEFAULTS, auto: day }, configPath);
	assert.deepEqual(loadConfig(configPath).auto, day);
	assert.equal(describeAuto(day), "09:00-17:00 daily");

	for (const bad of [
		{ start: "09:00" },
		{ start: "09:00", end: "25:00" },
		{ start: "09:00", end: "09:00" },
		"09:00-17:00",
	]) {
		writeFileSync(configPath, JSON.stringify({ ...DEFAULTS, auto: bad }));
		assert.equal(loadConfig(configPath).auto, false, JSON.stringify(bad));
	}

	assert.equal(
		automaticModeEnabled({ ...DEFAULTS, auto: day }, at(10, 0)),
		true,
	);
	assert.equal(
		automaticModeEnabled({ ...DEFAULTS, auto: day }, at(20, 0)),
		false,
	);
	assert.equal(
		automaticModeEnabled({ ...DEFAULTS, auto: true }, at(20, 0)),
		true,
	);
});

// @lat: [[proper-pacify/tests#Verification#Reload and dispatch safety fixture]]
test("wrapper survives reload, bare commands, and transcript failures", async () => {
	const configPath = join(testDir, "pacify.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			...DEFAULTS,
			model: "openai-codex/gpt-5.6-luna",
			auto: true,
		}),
	);

	const sentToModel: string[] = [];
	const makeCtx = () =>
		({
			model: { provider: "openai-codex" },
			scopedModels: [],
			modelRegistry: {
				getAvailable: () => models,
				async complete(
					_model: unknown,
					context: { messages: { content: string }[] },
				) {
					sentToModel.push(context.messages[0]?.content ?? "");
					return reply("rewritten");
				},
			},
			ui: {
				setStatus() {},
				notify() {},
				onTerminalInput: undefined as TerminalInputHook,
			},
		}) as unknown as TestContext;

	class FakeRunner {
		createContext() {
			return makeCtx();
		}
		async emitInput(_text: string, _images?: unknown, _source?: string) {
			return { action: "continue" };
		}
	}
	assert.equal(
		installInputPriorityPrototype(FakeRunner as unknown as TestRunner),
		true,
	);

	const loggedBy: string[] = [];
	const makePi = (tag: string, appendEntry?: () => void) =>
		({
			registerEntryRenderer() {},
			registerCommand() {},
			on() {},
			appendEntry:
				appendEntry ??
				(() => {
					loggedBy.push(tag);
				}),
			sendUserMessage() {},
		}) as unknown as TestPi;

	properPacify(makePi("first"));

	// A reload replaces the module instance but leaves the wrapper installed.
	// The wrapper must follow the newest instance, not the one that installed it.
	properPacify(makePi("second"));
	await new FakeRunner().emitInput("fix this stupid parser", undefined, "x");
	assert.deepEqual(loggedBy, ["second"]);

	// A command with no argument is dispatch syntax and must reach the chain
	// untouched rather than being rewritten as prose.
	for (const bare of ["/file", "/refine"]) {
		const result = await new FakeRunner().emitInput(bare, undefined, "x");
		assert.deepEqual(result, { action: "continue" }, bare);
	}
	assert.deepEqual(sentToModel, ["fix this stupid parser"]);

	// A failing transcript write must never cost the user their prompt.
	properPacify(
		makePi("throws", () => {
			throw new Error("Extension instance is stale");
		}),
	);
	const survived = await new FakeRunner().emitInput(
		"fix it now",
		undefined,
		"x",
	);
	assert.deepEqual(survived, { action: "transform", text: "rewritten" });
});
