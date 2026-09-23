import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_PROMPTS } from "../defaults.ts";
import {
	applyPrompts,
	ConfigError,
	claimBuild,
	isScopedInstall,
	loadPrompts,
	type Mode,
	type ModelPrompt,
	matchesModel,
	promptsFor,
	SECTION,
	selectsModel,
} from "../model-prompts.ts";
import { session } from "./fixture.ts";

const PREAMBLE = "You are an expert coding assistant operating inside pi";
const block = (text: string) => `<${SECTION}>\n${text}\n</${SECTION}>`;
const count = (text: string, part: string) => text.split(part).length - 1;
const configError = (message: RegExp) => (error: unknown) =>
	error instanceof ConfigError && message.test(error.message);

// @lat: [[proper-model-prompts/tests#Model patterns]]
test("patterns match provider/id or the bare id, case-insensitively", () => {
	const claude = { provider: "cliproxyapi", id: "claude-opus-5" };
	const routed = { provider: "openrouter", id: "anthropic/claude-sonnet-5" };
	assert.ok(matchesModel("cliproxyapi/claude-*", claude));
	assert.ok(!matchesModel("anthropic/claude-*", claude));
	assert.ok(matchesModel("claude-*", claude));
	assert.ok(matchesModel("CLAUDE-OPUS-5", claude));
	assert.ok(matchesModel(" cliproxyapi/* ", claude));
	assert.ok(matchesModel("*", routed));
	assert.ok(matchesModel("*sonnet*", routed), "* crosses /");
	assert.ok(matchesModel("anthropic/claude-sonnet-5", routed), "bare id");
	assert.ok(!matchesModel("claude-*", routed));
	assert.ok(!matchesModel("claude-opus", claude), "no substring matching");
	assert.ok(matchesModel("gpt-5.6-sol", { provider: "x", id: "gpt-5.6-sol" }));
	assert.ok(!matchesModel("gpt-5.6-sol", { provider: "x", id: "gpt-5x6-sol" }));

	const opus55 = { provider: "cliproxyapi", id: "claude-opus-5-5" };
	assert.ok(selectsModel(["*claude*", "!*opus-5-5*"], claude));
	assert.ok(!selectsModel(["*claude*", "!*opus-5-5*"], opus55));
	assert.ok(!selectsModel(["!*opus-5-5*", "*claude*"], opus55), "any order");
	assert.ok(!selectsModel([" ! cliproxyapi/* ", "*"], claude), "provider/id");
	assert.ok(!selectsModel(["!*opus-5-5*"], claude), "exclusions alone");
});

async function configDir(t: { after(fn: () => unknown): void }) {
	const dir = await mkdtemp(join(tmpdir(), "proper-model-prompts-config-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

// @lat: [[proper-model-prompts/tests#Configuration]]
test("configuration loads inline text and prompt files", async (t) => {
	const dir = await configDir(t);
	const path = join(dir, "proper-model-prompts.json");
	assert.deepEqual(
		loadPrompts(path),
		[...DEFAULT_PROMPTS],
		"a missing file means the built-in prompts only",
	);
	for (const config of [
		{},
		{ defaults: true },
		{ offerForegroundSubagents: false },
	]) {
		await writeFile(path, JSON.stringify(config));
		assert.deepEqual(loadPrompts(path), [...DEFAULT_PROMPTS]);
	}

	await mkdir(join(dir, "prompts"));
	await writeFile(join(dir, "prompts", "gpt.md"), "\nRun the tests.\n\n");
	const home = join(dir, "home");
	await mkdir(home);
	await writeFile(join(home, "all.md"), "Be brief.");
	const prompts = [
		{ models: ["claude-*"], text: "  Keep diffs small.  " },
		{ models: ["gpt-*"], position: "prepend", file: "prompts/gpt.md" },
		{ models: ["*"], position: "append", modes: ["print"], file: "~/all.md" },
	];
	await writeFile(path, JSON.stringify({ defaults: false, prompts }));
	const originalHome = process.env.HOME;
	process.env.HOME = home;
	t.after(() => {
		process.env.HOME = originalHome;
	});
	const own = [
		{ models: ["claude-*"], position: "append", text: "Keep diffs small." },
		{ models: ["gpt-*"], position: "prepend", text: "Run the tests." },
		{
			models: ["*"],
			position: "append",
			modes: ["print"],
			text: "Be brief.",
		},
	];
	assert.deepEqual(loadPrompts(path), own, "defaults: false drops built-ins");

	await writeFile(path, JSON.stringify({ prompts }));
	assert.deepEqual(
		loadPrompts(path),
		[...DEFAULT_PROMPTS, ...own],
		"built-in prompts come first",
	);
});

test("invalid configuration fails with its location", async (t) => {
	const dir = await configDir(t);
	const path = join(dir, "proper-model-prompts.json");
	const cases: Array<[unknown, RegExp]> = [
		["{", /proper-model-prompts\.json: /],
		[[], /expected an object with optional "defaults"/],
		[{ prompt: [] }, /expected an object with optional "defaults"/],
		[{ prompts: [], extra: true }, /expected an object/],
		[{ prompts: {} }, /"prompts" \(a list\)/],
		[{ defaults: "no" }, /"defaults" \(true or false\)/],
		[
			{ offerForegroundSubagents: "no" },
			/"offerForegroundSubagents" \(true or false\)/,
		],
		[{ prompts: ["text"] }, /prompts\[0\]: expected an object/],
		[
			{ prompts: [{ models: ["*"], text: "x", priority: 1 }] },
			/prompts\[0\]: unknown key priority/,
		],
		[{ prompts: [{ models: [], text: "x" }] }, /non-empty list/],
		[{ prompts: [{ models: [" "], text: "x" }] }, /non-empty list/],
		[{ prompts: [{ models: "*", text: "x" }] }, /non-empty list/],
		[
			{ prompts: [{ models: ["*"], position: "top", text: "x" }] },
			/position must be "prepend" or "append"/,
		],
		[
			{ prompts: [{ models: ["*"], modes: [], text: "x" }] },
			/modes must be a non-empty list of tui, rpc, json, print/,
		],
		[
			{ prompts: [{ models: ["*"], modes: ["cli"], text: "x" }] },
			/modes must be/,
		],
		[
			{ prompts: [{ models: ["*"], modes: "print", text: "x" }] },
			/modes must be/,
		],
		[
			{ prompts: [{ models: ["!*x*"], text: "x" }] },
			/models needs a pattern without !/,
		],
		[
			{ prompts: [{ models: ["*", " ! "], text: "x" }] },
			/! must be followed by a pattern/,
		],
		[{ prompts: [{ models: ["*"] }] }, /exactly one of text or file/],
		[
			{ prompts: [{ models: ["*"], text: "x", file: "y.md" }] },
			/exactly one of text or file/,
		],
		[{ prompts: [{ models: ["*"], text: 1 }] }, /text must be a string/],
		[{ prompts: [{ models: ["*"], file: "" }] }, /file must be a path/],
		[{ prompts: [{ models: ["*"], text: " \n" }] }, /prompt text is empty/],
		[
			{
				prompts: [
					{ models: ["*"], text: "x" },
					{ models: ["*"], file: "no.md" },
				],
			},
			/prompts\[1\]: cannot read .*no\.md \(ENOENT\)/,
		],
	];
	for (const [config, message] of cases) {
		await writeFile(
			path,
			typeof config === "string" ? config : JSON.stringify(config),
		);
		assert.throws(
			() => loadPrompts(path),
			configError(message),
			JSON.stringify(config),
		);
	}

	// Unreadable paths, for prompt files and for the configuration itself.
	await writeFile(join(dir, "plain"), "not a directory");
	for (const [file, code] of [
		[".", "EISDIR"],
		["plain/inner.md", "ENOTDIR"],
	]) {
		await writeFile(
			path,
			JSON.stringify({ prompts: [{ models: ["*"], file }] }),
		);
		assert.throws(
			() => loadPrompts(path),
			configError(new RegExp(`prompts\\[0\\]: cannot read .* \\(${code}\\)`)),
		);
	}
	const folder = join(dir, "folder.json");
	await mkdir(folder);
	assert.throws(
		() => loadPrompts(folder),
		configError(/cannot read .*folder\.json \(EISDIR\)/),
	);
	assert.throws(
		() => loadPrompts(join(dir, "plain", "config.json")),
		configError(/cannot read .*config\.json \(ENOTDIR\)/),
	);
});

function event(forced?: string) {
	const systemPromptOptions: any = {
		sections: { earlier: "EARLIER" },
		forceSystemPrompt: forced,
	};
	return {
		systemPromptOptions,
		// Like Pi: a replacement is opaque; otherwise sections render in order.
		get systemPrompt() {
			const sections = Object.entries(systemPromptOptions.sections).map(
				([name, text]) => `<${name}>\n${text}\n</${name}>`,
			);
			return (
				systemPromptOptions.forceSystemPrompt ??
				["BASE", ...sections].join("\n\n")
			);
		},
	};
}
const prompt = (position: ModelPrompt["position"], text: string) => ({
	models: ["*"],
	position,
	text,
});

// @lat: [[proper-model-prompts/tests#Composition]]
test("appended text is always a section; replacements carry it too", () => {
	const base = "BASE\n\n<earlier>\nEARLIER\n</earlier>";
	const appended = event();
	applyPrompts(appended, [prompt("append", "A1"), prompt("append", "A2")]);
	assert.equal(appended.systemPromptOptions.sections[SECTION], "A1\n\nA2");
	assert.equal(appended.systemPromptOptions.forceSystemPrompt, undefined);

	const prepended = event();
	applyPrompts(prepended, [prompt("append", "A"), prompt("prepend", "P")]);
	assert.equal(
		prepended.systemPromptOptions.forceSystemPrompt,
		`P\n\n${base}\n\n${block("A")}`,
	);
	assert.equal(prepended.systemPromptOptions.sections[SECTION], "A");

	const prependOnly = event();
	applyPrompts(prependOnly, [prompt("prepend", "P")]);
	assert.equal(
		prependOnly.systemPromptOptions.forceSystemPrompt,
		`P\n\n${base}`,
	);
	assert.equal(prependOnly.systemPromptOptions.sections[SECTION], undefined);

	const forced = event("FORCED BY ANOTHER EXTENSION");
	applyPrompts(forced, [prompt("append", "A")]);
	assert.equal(
		forced.systemPromptOptions.forceSystemPrompt,
		`FORCED BY ANOTHER EXTENSION\n\n${block("A")}`,
	);
	assert.equal(forced.systemPromptOptions.sections[SECTION], "A");

	const wrapped = event("FORCED");
	applyPrompts(wrapped, [prompt("prepend", "P"), prompt("append", "A")]);
	assert.equal(
		wrapped.systemPromptOptions.forceSystemPrompt,
		`P\n\nFORCED\n\n${block("A")}`,
	);

	const none = event();
	applyPrompts(none, []);
	assert.deepEqual(none.systemPromptOptions.sections, { earlier: "EARLIER" });
	assert.equal(none.systemPromptOptions.forceSystemPrompt, undefined);

	const build = {};
	assert.equal(claimBuild(build), true);
	assert.equal(claimBuild(build), false, "a second copy is refused");
	assert.equal(claimBuild({}), true, "each prompt build is claimed afresh");
});

const defaults = (id: string, mode: Mode = "tui") => {
	const slash = id.indexOf("/");
	const model = { provider: id.slice(0, slash), id: id.slice(slash + 1) };
	return promptsFor([...DEFAULT_PROMPTS], model, mode);
};
const defaultTags = (id: string, mode: Mode = "tui") =>
	defaults(id, mode).map((prompt) => /^<(\w+)>/.exec(prompt.text)?.[1]);
const defaultText = (id: string, mode: Mode = "tui") =>
	defaults(id, mode)
		.map((prompt) => prompt.text)
		.join("\n\n");

// @lat: [[proper-model-prompts/tests#Built-in prompts]]
test("built-in prompts target Claude and GPT families across provider id forms", () => {
	for (const prompt of DEFAULT_PROMPTS)
		assert.equal(
			prompt.position,
			"append",
			"defaults never replace the prompt",
		);
	const core = ["grounding"];
	const opus5 = [...core, "response_length"];
	const fable = [...core, "decisiveness", "acting_on_requests"];
	const fable51 = [...fable, "progress_updates"];
	const gpt6 = ["initiative"];
	const gpt5 = ["autonomy"];
	const expected: Record<string, string[]> = {
		"cliproxyapi/claude-opus-5": opus5,
		"anthropic/claude-opus-5": opus5,
		"amazon-bedrock/us.anthropic.claude-opus-5": opus5,
		"openrouter/anthropic/claude-opus-5:batch": opus5,
		"vercel-ai-gateway/anthropic/claude-opus-5-fast": opus5,
		"cliproxyapi/claude-opus-5-5": opus5,
		"amazon-bedrock/global.anthropic.claude-opus-5-5": opus5,
		"openrouter/anthropic/claude-opus-5.5:batch": opus5,
		"github-copilot/claude-opus-5.5": opus5,
		"vercel-ai-gateway/anthropic/claude-opus-5.5-fast": opus5,
		"openrouter/~anthropic/claude-opus-latest": core,
		"openrouter/~anthropic/claude-fable-latest": core,
		"openrouter/~openai/gpt-sol-latest": [],
		"anthropic/claude-sonnet-5": core,
		"cliproxyapi/claude-haiku-4-5": core,
		"anthropic/claude-fable-5": fable,
		"openrouter/anthropic/claude-fable-5:batch": fable,
		"anthropic/claude-fable-5-1": fable51,
		"amazon-bedrock/us.anthropic.claude-fable-5-1": fable51,
		"github-copilot/claude-fable-5.1": fable51,
		"anthropic/claude-mythos-5-1": fable51,
		"cliproxyapi/gpt-6-astra": gpt6,
		"openai/gpt-6-sol": gpt6,
		"github-copilot/gpt-6-luna": gpt6,
		"amazon-bedrock/global.openai.gpt-6-astra": gpt6,
		"openrouter/openai/gpt-6-luna-pro:batch": gpt6,
		"vercel-ai-gateway/openai/gpt-6-sol-fast": gpt6,
		"cliproxyapi/gpt-5.6-sol": gpt5,
		"openai-codex/gpt-5.6-terra": gpt5,
		"amazon-bedrock/in.openai.gpt-5.6-luna": gpt5,
		"openrouter/openai/gpt-5.6-sol-pro:batch": gpt5,
		"cliproxyapi/gpt-5.5": gpt5,
		"azure-openai-responses/gpt-5.5-pro": gpt5,
		"amazon-bedrock/openai.gpt-5.5": gpt5,
		"vercel-ai-gateway/openai/gpt-5.5-fast": gpt5,
		"openai/gpt-5.4": [],
		"openai/gpt-oss-120b": [],
		"cliproxyapi/glm-5.3-flash": [],
	};
	for (const [id, tags] of Object.entries(expected))
		assert.deepEqual(defaultTags(id), tags, id);

	const unattended = [...core, "autonomous_run"];
	assert.deepEqual(
		defaultTags("cliproxyapi/claude-sonnet-5", "print"),
		unattended,
	);
	assert.deepEqual(
		defaultTags("cliproxyapi/claude-sonnet-5", "json"),
		unattended,
	);
	assert.deepEqual(defaultTags("cliproxyapi/claude-sonnet-5", "rpc"), core);

	// Opus 5.5 gets its own guide's unattended paragraph instead of the general one.
	const own = /^A standing instruction from the user/m;
	const general = /You are operating autonomously/;
	for (const id of [
		"cliproxyapi/claude-opus-5-5",
		"openrouter/anthropic/claude-opus-5.5:batch",
	]) {
		assert.deepEqual(defaultTags(id, "json"), [...opus5, "autonomous_run"], id);
		assert.match(defaultText(id, "print"), own, id);
		assert.doesNotMatch(defaultText(id, "print"), general, id);
	}
	assert.match(defaultText("cliproxyapi/claude-opus-5", "print"), general);
	assert.doesNotMatch(defaultText("cliproxyapi/claude-opus-5", "print"), own);
	assert.deepEqual(defaultTags("cliproxyapi/claude-fable-5", "rpc"), fable);
	assert.deepEqual(defaultTags("cliproxyapi/claude-fable-5", "print"), [
		...core,
		"decisiveness",
		"autonomous_run",
	]);
	assert.deepEqual(defaultTags("cliproxyapi/gpt-6-sol", "print"), [
		...gpt6,
		"autonomous_run",
	]);
	assert.deepEqual(defaultTags("cliproxyapi/gpt-5.5", "json"), [
		...gpt5,
		"autonomous_run",
	]);
	assert.deepEqual(defaultTags("cliproxyapi/gpt-6-sol", "rpc"), gpt6);

	// A problem report gets an assessment instead of a fix, stated once, only
	// where the vendor's guidance for that model asks for it.
	const assess = /the deliverable is your assessment|diagnose/g;
	const rules = (id: string, mode?: Mode) =>
		defaultText(id, mode).match(assess)?.length ?? 0;
	for (const mode of ["tui", "print"] as const) {
		assert.equal(rules("cliproxyapi/claude-fable-5-1", mode), 1, mode);
		assert.equal(rules("cliproxyapi/gpt-5.6-terra", mode), 1, mode);
		assert.equal(rules("cliproxyapi/gpt-5.5", mode), 0, mode);
		assert.equal(rules("cliproxyapi/gpt-6-astra", mode), 0, mode);
	}
	assert.equal(rules("cliproxyapi/claude-sonnet-5"), 0);
	assert.equal(rules("cliproxyapi/claude-sonnet-5", "print"), 1);
	assert.equal(
		rules("cliproxyapi/claude-opus-5-5", "print"),
		0,
		"not in its page",
	);

	// Guarantees the wording must keep, whatever else changes.
	const byTag = (tag: string) =>
		DEFAULT_PROMPTS.find((prompt) => prompt.text.startsWith(`<${tag}>`))
			?.text ?? "";
	const coreText = byTag("grounding");
	const fableText = byTag("decisiveness");
	assert.match(coreText, /remove temporary files you created/, "cleanup");
	assert.match(
		coreText,
		/removing temporary files you created during this task without asking/,
		"cleanup needs no permission, so scope and risky actions agree",
	);
	assert.match(
		coreText,
		/files or branches that existed before this task/,
		"pre-existing files still need permission",
	);
	assert.match(
		coreText,
		/By default, Pi summarizes/,
		"compaction can be disabled, so the claim is qualified",
	);
	assert.match(
		fableText,
		/This does not apply to thinking blocks\./,
		"Anthropic scopes the Fable rule to user-facing text",
	);
	for (const prompt of DEFAULT_PROMPTS)
		assert.doesNotMatch(
			prompt.text,
			/\u2014|\b(?:CRITICAL|MUST|NEVER|IMPORTANT)\b|double-check|re-verify/,
			"no em dashes, CAPS emphasis, or verification steps",
		);
});

// @lat: [[proper-model-prompts/tests#Run modes]]
test("a real session applies entries only in their run modes", async (t) => {
	const interactive = await (await session(t)).ask();
	assert.ok(interactive.prompt.startsWith(PREAMBLE));
	assert.ok(
		interactive.prompt.indexOf("<grounding>") <
			interactive.prompt.indexOf("<response_length>"),
		"built-in core, then the Opus 5 block",
	);
	assert.ok(!interactive.prompt.includes("<autonomous_run>"));

	const config = {
		prompts: [{ models: ["*"], modes: ["print"], text: "PRINT-ONLY" }],
	};
	const printed = await session(t, { mode: "print", config });
	const unattended = await printed.ask();
	assert.equal(count(unattended.prompt, "<autonomous_run>"), 1);
	assert.ok(unattended.prompt.endsWith("PRINT-ONLY\n</proper_model_prompts>"));
	await printed.use("gpt-6-sol");
	const gpt = await printed.ask();
	assert.ok(!gpt.prompt.includes("<grounding>"));
	assert.equal(count(gpt.prompt, "<initiative>"), 1);
	assert.equal(count(gpt.prompt, "<autonomous_run>"), 1);
	assert.ok(!gpt.prompt.includes("the deliverable is your assessment"));
	assert.ok(gpt.prompt.endsWith("PRINT-ONLY\n</proper_model_prompts>"));

	const rpc = await (await session(t, { mode: "rpc", config })).ask();
	assert.ok(rpc.prompt.includes("<grounding>"));
	assert.ok(!rpc.prompt.includes("<autonomous_run>"));
	assert.ok(!rpc.prompt.includes("PRINT-ONLY"));

	const off = await session(t, {
		mode: "print",
		config: { defaults: false },
	});
	assert.ok(!(await off.ask()).prompt.includes(SECTION));
});

// @lat: [[proper-model-prompts/tests#Foreground offer]]
test("the terminal asks once before adding the package to foreground subagents", async (t) => {
	const packageDir = dirname(
		fileURLToPath(new URL("../model-prompts.ts", import.meta.url)),
	);
	const settings = {
		packages: ["npm:pi-subagents"],
		subagents: { modelScope: { strict: true } },
	};
	const seed = (value: unknown) => (dir: string) =>
		writeFile(join(dir, "settings.json"), JSON.stringify(value));
	const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));
	const offer = { tools: ["subagent"], prepare: seed(settings) };

	const yes = await session(t, { ...offer, confirm: true });
	assert.equal(yes.confirms.length, 1);
	assert.match(yes.confirms[0] ?? "", /foreground subagents/);
	assert.deepEqual(await read(join(yes.dir, "settings.json")), {
		...settings,
		subagents: {
			...settings.subagents,
			defaultSubagentOnlyExtensions: [packageDir],
		},
	});
	assert.match(yes.notices.at(-1) ?? "", /^proper-model-prompts: added /);

	const own = { prompts: [{ models: ["x"], text: "X" }] };
	const no = await session(t, { ...offer, twice: true, config: own });
	assert.equal(no.confirms.length, 1, "a second loaded copy stays quiet");
	assert.deepEqual(await read(no.configPath), {
		...own,
		offerForegroundSubagents: false,
	});
	assert.deepEqual(await read(join(no.dir, "settings.json")), settings);

	// Nothing to ask: an answer on record, the package already listed (here by
	// a ~/ path to a link), no pi-subagents, no terminal, or a broken file.
	const home = await mkdtemp(join(tmpdir(), "proper-model-prompts-home-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	await symlink(packageDir, join(home, "link"));
	const originalHome = process.env.HOME;
	process.env.HOME = home;
	t.after(() => {
		process.env.HOME = originalHome;
	});
	const listed = { subagents: { defaultSubagentOnlyExtensions: ["~/link"] } };
	for (const options of [
		{ ...offer, config: { offerForegroundSubagents: false } },
		{ ...offer, prepare: seed(listed) },
		{ prepare: seed(settings) },
		{ ...offer, mode: "rpc" as const },
		{ ...offer, config: "not an object" },
		{
			...offer,
			prepare: (dir: string) =>
				writeFile(join(dir, "settings.json"), "{ broken"),
		},
	]) {
		const quiet = await session(t, { ...options, confirm: true });
		assert.equal(quiet.confirms.length, 0, JSON.stringify(options));
	}

	// A project install or a one-off `pi -e` copy must not enter the global list.
	const project = await session(t, {
		...offer,
		confirm: true,
		packageDir: (dir) => join(dir, "repo", ".pi", "npm", "node_modules", "pkg"),
		prepare: async (dir) => {
			await seed(settings)(dir);
			await mkdir(join(dir, "repo", ".pi", "npm", "node_modules", "pkg"), {
				recursive: true,
			});
		},
	});
	assert.equal(project.confirms.length, 0, "project install");

	const locked = await session(t, {
		...offer,
		confirm: true,
		prepare: async (dir) => {
			await seed(settings)(dir);
			await mkdir(join(dir, "settings.json.lock"));
		},
	});
	assert.deepEqual(await read(join(locked.dir, "settings.json")), settings);
	assert.match(
		locked.notices.at(-1) ?? "",
		/has it locked\. To load it in foreground subagents, add /,
	);
});

// @lat: [[proper-model-prompts/tests#Install scope]]
test("only personal installs count for the global foreground list", () => {
	const agent = "/home/u/.pi/agent";
	const scoped = (dir: string) => isScopedInstall(dir, agent);
	assert.ok(!scoped(`${agent}/npm/node_modules/proper-model-prompts`), "npm");
	assert.ok(!scoped(`${agent}/git/github.com/o/repo`), "git");
	assert.ok(!scoped("/home/u/work/proper-model-prompts"), "local checkout");
	assert.ok(
		scoped("/home/u/work/app/.pi/npm/node_modules/proper-model-prompts"),
		"project npm",
	);
	assert.ok(
		scoped("/home/u/work/app/.pi/git/github.com/o/repo"),
		"project git",
	);
	assert.ok(
		scoped(
			`${agent}/tmp/extensions/npm-1a2b/node_modules/proper-model-prompts`,
		),
		"pi -e",
	);
	assert.ok(
		!isScopedInstall(
			"/home/u/.pi/npm/node_modules/proper-model-prompts",
			"/home/u/.pi",
		),
		"an agent directory named .pi keeps its personal installs",
	);
});

// @lat: [[proper-model-prompts/tests#Live sessions]]
test("a real session sends each model only its own prompts", async (t) => {
	const s = await session(t, {
		config: {
			defaults: false,
			prompts: [
				{ models: ["cliproxyapi/claude-*"], text: "CLAUDE-APPEND" },
				{ models: ["gpt-*"], position: "prepend", text: "GPT-PREPEND" },
				{ models: ["*"], text: "ALL-APPEND" },
			],
		},
	});

	const claude = await s.ask();
	assert.equal(claude.model, "claude-opus-5");
	assert.ok(claude.prompt.startsWith(PREAMBLE));
	assert.ok(claude.prompt.endsWith(block("CLAUDE-APPEND\n\nALL-APPEND")));
	assert.ok(!claude.prompt.includes("GPT-PREPEND"));
	assert.equal(s.recorded(), block("CLAUDE-APPEND\n\nALL-APPEND"));

	await s.use("gpt-6-sol");
	const gpt = await s.ask();
	assert.equal(gpt.model, "gpt-6-sol");
	assert.ok(gpt.head.startsWith(`GPT-PREPEND\n\n${PREAMBLE}`));
	assert.equal(gpt.prompt, gpt.head, "one leading prompt, no stale deltas");
	assert.ok(gpt.prompt.endsWith(block("ALL-APPEND")));
	assert.ok(!gpt.prompt.includes("CLAUDE-APPEND"));
	assert.equal(
		s.recorded(),
		block("ALL-APPEND"),
		"the transcript records appended text under a replacement too",
	);

	await s.use("glm-5.3-flash");
	const glm = await s.ask();
	assert.ok(glm.prompt.startsWith(PREAMBLE));
	assert.ok(glm.prompt.endsWith(block("ALL-APPEND")));
	assert.ok(!glm.prompt.includes("GPT-PREPEND"));
	assert.ok(!glm.prompt.includes("CLAUDE-APPEND"));

	await s.use("claude-opus-5");
	const back = await s.ask();
	assert.ok(back.prompt.endsWith(block("CLAUDE-APPEND\n\nALL-APPEND")));
	assert.ok(!back.prompt.includes("GPT-PREPEND"));

	for (const request of [claude, gpt, glm, back])
		assert.equal(count(request.prompt, `<${SECTION}>`), 1, request.model);
});

test("a double-loaded extension inserts each prompt and reports each error once", async (t) => {
	const s = await session(t, {
		twice: true,
		model: "gpt-6-sol",
		config: {
			prompts: [
				{ models: ["*"], position: "prepend", text: "ONCE-P" },
				{ models: ["*"], text: "ONCE-A" },
			],
		},
	});
	const request = await s.ask();
	assert.equal(count(request.prompt, "ONCE-P"), 1);
	assert.equal(count(request.prompt, "ONCE-A"), 1);

	await s.config("{ not json");
	await s.ask();
	await s.ask();
	assert.equal(s.notices.length, 1);
});

test("configuration edits apply on the next prompt; errors are reported once", async (t) => {
	const s = await session(t, { config: { defaults: false } });
	const plain = await s.ask();
	assert.ok(!plain.prompt.includes(SECTION));

	await s.config({
		defaults: false,
		prompts: [{ models: ["claude-*"], text: "NEW" }],
	});
	assert.ok((await s.ask()).prompt.endsWith(block("NEW")));

	await s.config("{ not json");
	const broken = await s.ask();
	await s.ask();
	assert.ok(!broken.prompt.includes(SECTION));
	assert.equal(s.notices.length, 1);
	assert.match(s.notices[0] ?? "", /^proper-model-prompts: .*JSON/);

	await s.config({
		defaults: false,
		prompts: [{ models: ["claude-*"], text: "FIXED" }],
	});
	assert.ok((await s.ask()).prompt.endsWith(block("FIXED")));
});

test("other extensions' prompt changes survive in either load order", async (t) => {
	const forcer = (pi: any) =>
		pi.on("before_agent_start", (event: any) => ({
			systemPrompt: `${event.systemPrompt}\n\nFORCED-TAIL`,
		}));
	const sectioner = (pi: any) =>
		pi.on("before_agent_start", (event: any) => {
			event.systemPromptOptions.sections.other = "OTHER";
		});
	const config = {
		defaults: false,
		prompts: [
			{ models: ["*"], position: "prepend", text: "P" },
			{ models: ["*"], text: "A" },
		],
	};

	const first = await session(t, { config, before: [sectioner, forcer] });
	const early = await first.ask();
	assert.ok(early.head.startsWith(`P\n\n${PREAMBLE}`));
	assert.ok(early.head.includes("FORCED-TAIL"));
	assert.ok(early.head.includes("<other>\nOTHER\n</other>"));
	assert.ok(early.head.endsWith(block("A")));

	const second = await session(t, { config, after: [forcer] });
	const late = await second.ask();
	assert.ok(late.head.startsWith(`P\n\n${PREAMBLE}`));
	assert.ok(late.head.endsWith(`${block("A")}\n\nFORCED-TAIL`));

	const appendOnly = {
		defaults: false,
		prompts: [{ models: ["*"], text: "A" }],
	};
	const third = await session(t, {
		config: appendOnly,
		after: [sectioner, forcer],
	});
	const sections = await third.ask();
	assert.ok(sections.prompt.includes(block("A")));
	assert.ok(sections.prompt.includes("<other>\nOTHER\n</other>"));
	assert.ok(sections.prompt.endsWith("FORCED-TAIL"));

	// Documented limit: after a prepend replaces the prompt, Pi ignores
	// sections that later extensions add without handling the replacement.
	const fourth = await session(t, { config, after: [sectioner] });
	const dropped = await fourth.ask();
	assert.ok(dropped.head.startsWith("P\n\n"));
	assert.ok(!dropped.head.includes("OTHER"));
});
