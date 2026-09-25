import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import {
	AgentSession,
	ExtensionRunner,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
	readSkillContextEnabled,
	writeSkillContextEnabled,
} from "../src/settings.ts";
import {
	SKILL_CONTEXT_ENTRY,
	SKILL_CONTEXT_TOOL,
	selectedSkills,
} from "../src/skill-context.ts";
import { parseSkillCommands, registerSkillContext } from "../src/skills.ts";

function fixture(t: TestContext) {
	const dir = mkdtempSync(join(tmpdir(), "proper-base-skills-"));
	const manager = SessionManager.inMemory(dir);
	const catalog: any[] = [];
	const notices: string[] = [];
	const commands = new Map<string, any>();
	let tool: any;
	let aborted = false;
	let idle = true;
	const model = { provider: "test", id: "test", contextWindow: 200_000 };
	const ctx: any = {
		sessionManager: manager,
		model,
		cwd: dir,
		hasUI: true,
		mode: "tui",
		isIdle: () => idle,
		hasPendingMessages: () => false,
		abort: () => {
			aborted = true;
		},
		ui: { notify: (text: string) => notices.push(text) },
	};
	const pi: any = {
		registerCommand: (name: string, command: any) =>
			commands.set(name, command),
		registerTool: (definition: any) => {
			tool = definition;
		},
		appendEntry: (type: string, data: unknown) =>
			manager.appendCustomEntry(type, data),
	};
	const sent: any[] = [];
	const queued: any[] = [];
	const agent: any = {
		state: { model, thinkingLevel: "off", tools: [], messages: [] },
		async prompt(messages: any[]) {
			for (const message of messages) {
				agent.state.messages.push(message);
				manager.appendMessage(message);
				if (message.role === "user") sent.push(message);
			}
		},
		steer: (message: any) => queued.push(message),
		followUp: (message: any) => queued.push(message),
	};
	const session: any = Object.create(AgentSession.prototype);
	let controller = registerSkillContext(pi, dir, () => session);
	const extension: any = {
		path: "test",
		commands: new Map(),
		handlers: new Map([
			["input", [(event: any) => controller.input(event, ctx)]],
			["before_agent_start", [(event: any) => controller.prepare(event)]],
		]),
	};
	const runner = new ExtensionRunner(
		[extension],
		{} as any,
		dir,
		manager,
		{} as any,
	);
	Object.assign(runner, { getModel: () => model });
	Object.assign(session, {
		agent,
		sessionManager: manager,
		_extensionRunner: runner,
		_modelRuntime: { hasConfiguredAuth: () => true },
		_pendingNextTurnMessages: [],
		_steeringMessages: [],
		_followUpMessages: [],
		_emitQueueUpdate() {},
		_toolRegistry: new Map(),
		_baseSystemPromptOptions: {
			cwd: dir,
			selectedTools: [],
			toolSnippets: {},
			toolGuidelines: {},
			promptGuidelines: [],
			appendSystemPrompt: "",
			sections: {},
			contextFiles: [],
			skills: [],
		},
		_resourceLoader: {
			getPrompts: () => ({ prompts: [] }),
			getSkills: () => ({ skills: catalog }),
		},
		_flushPendingBashMessages() {},
		_flushPendingCustomMessages() {},
		_findLastAssistantMessage: () => undefined,
		_runAgentPrompt: (messages: any[]) => agent.prompt(messages),
	});
	controller.start(ctx);
	t.after(() => {
		controller.stop();
		rmSync(dir, { recursive: true, force: true });
	});
	return {
		dir,
		manager,
		session,
		ctx,
		catalog,
		sent,
		queued,
		notices,
		get controller() {
			return controller;
		},
		get aborted() {
			return aborted;
		},
		setIdle(value: boolean) {
			idle = value;
		},
		add(name: string, body: string, explicitOnly = false) {
			const baseDir = join(dir, name);
			mkdirSync(baseDir, { recursive: true });
			const filePath = join(baseDir, "SKILL.md");
			writeFileSync(
				filePath,
				`---\nname: ${name}\ndescription: test fixture\n---\n${body}`,
			);
			catalog.push({
				name,
				filePath,
				baseDir,
				description: "fixture",
				disableModelInvocation: explicitOnly,
			});
			return filePath;
		},
		async command(args: string) {
			await commands.get("skill-context").handler(args, ctx);
		},
		async use(params: unknown) {
			const result = await tool.execute(
				"skill-call",
				params,
				new AbortController().signal,
				undefined,
				ctx,
			);
			manager.appendMessage({
				role: "toolResult",
				toolName: SKILL_CONTEXT_TOOL,
				toolCallId: "skill-call",
				...result,
				isError: false,
				timestamp: Date.now(),
			});
			return result;
		},
		project() {
			return controller.transform(
				manager.buildSessionProjection().messages,
				ctx,
			);
		},
		reload() {
			const previous = controller;
			controller = registerSkillContext(pi, dir, () => session);
			previous.stop();
			controller.start(ctx);
		},
	};
}

// @lat: [[lat.md/proper-base/tests#Verification#Skill management fixture]]
test("native prompt expansion loads a command chain once and preserves request and images", async (t) => {
	const f = fixture(t);
	f.add("audit", "Audit instructions.");
	f.add("tests", "Test instructions.");
	await f.session.prompt(
		"/skill:audit /skill:tests /skill:audit inspect this",
		{
			images: [],
			source: "rpc",
		},
	);
	const text = f.sent[0].content[0].text;
	assert.equal(text.match(/<skill name="audit"/g)?.length, 1);
	assert.equal(text.match(/<skill name="tests"/g)?.length, 1);
	assert.match(text, /inspect this$/);
	assert.deepEqual(
		selectedSkills(f.manager.getBranch()).map((skill) => skill.name),
		["audit", "tests"],
	);
	const original = structuredClone(f.manager.getEntries());
	await f.session.prompt("/skill:audit inspect another file");
	const projected = JSON.stringify(f.project());
	assert.equal(projected.split("Audit instructions.").length - 1, 1);
	assert.match(projected, /inspect another file/);
	assert.deepEqual(f.manager.getEntries().slice(0, original.length), original);
});

test("syntax ignores literal mentions and honors native expansion opt-outs", async (t) => {
	const f = fixture(t);
	f.add("audit", "AUDIT_BODY");
	for (const literal of [
		"Explain /skill:audit",
		"`/skill:audit`",
		'"/skill:audit"',
		"\\ /skill:audit",
		"```\n/skill:audit\n```",
		"$audit",
		"/audit",
		"/skill audit",
		"/ skill:audit",
		"/skills:audit",
		"/skill:audi",
		"/skill:Audit",
		"/skill:",
		"/skill:unknown",
		"https://example.com/skill:audit",
		"//example.com/skill:audit",
		"docs/skill:audit",
		"/skill:audit/path",
		"/skill:audit?query=yes",
		"/skill:audit#section",
		"/skill:audit.md",
		"/skill:audit,",
		"[audit](/skill:audit)",
	]) {
		assert.equal(parseSkillCommands(literal, new Set(["audit"])), undefined);
		await f.session.prompt(literal);
		assert.equal(f.sent.at(-1).content[0].text, literal);
	}
	await f.session.prompt("/skill:audit", {
		expandPromptTemplates: false,
		source: "rpc",
	});
	assert.equal(f.sent.at(-1).content[0].text, "/skill:audit");
	assert.equal(selectedSkills(f.manager.getBranch()).length, 0);
	await f.session.prompt("/skill:audit -- explain /skill:missing literally");
	assert.match(
		f.sent.at(-1).content[0].text,
		/explain \/skill:missing literally$/,
	);
});

test("the first unknown or URL-like token ends selection and preserves the literal remainder", async (t) => {
	const f = fixture(t);
	f.add("audit", "AUDIT_BODY");
	f.add("tests", "TEST_BODY");
	for (const token of [
		"/skill:missing",
		"/skill:audit/path",
		"/skill:audit?query=yes",
		"https://example.com/skill:audit",
		"/tests",
		"$tests",
	]) {
		const remainder = `${token} /skill:tests do work`;
		assert.deepEqual(
			parseSkillCommands(
				`/skill:audit ${remainder}`,
				new Set(["audit", "tests"]),
			),
			{ names: ["audit"], request: remainder },
		);
		await f.session.prompt(`/skill:audit ${remainder}`);
		const text = f.sent.at(-1).content[0].text as string;
		assert.ok(text.endsWith(remainder));
		assert.doesNotMatch(text, /TEST_BODY/);
	}
	assert.deepEqual(
		selectedSkills(f.manager.getBranch()).map((skill) => skill.name),
		["audit"],
	);
	assert.deepEqual(
		parseSkillCommands(
			"/skill:audit\n/skill:tests\twork",
			new Set(["audit", "tests"]),
		),
		{ names: ["audit", "tests"], request: "work" },
	);
});

test("explicit control loads still reject missing names atomically", async (t) => {
	const f = fixture(t);
	f.add("audit", "AUDIT_BODY");
	await f.command("load audit missing");
	assert.match(f.notices.at(-1) ?? "", /Unknown skill/);
	assert.equal(selectedSkills(f.manager.getBranch()).length, 0);
});

test("ambiguous and unreadable skills reject the entire selection before persistence", async (t) => {
	const f = fixture(t);
	const path = f.add("audit", "AUDIT_BODY");
	f.catalog.push({ ...f.catalog[0] });
	await assert.rejects(f.session.prompt("/skill:audit work"), /ambiguous/);
	f.catalog.pop();
	rmSync(path);
	await assert.rejects(
		f.session.prompt("/skill:audit work"),
		/Cannot read skill/,
	);
	assert.equal(f.sent.length, 0);
});

test("queued and cancelled inputs do not activate skills before actual delivery", async (t) => {
	const f = fixture(t);
	f.add("audit", "AUDIT_BODY");
	f.add("tests", "TEST_BODY");
	f.session._isAgentRunActive = true;
	await f.session.steer("/skill:audit /skill:tests queued");
	assert.equal(selectedSkills(f.manager.getBranch()).length, 0);
	assert.match(f.queued[0].content[0].text, /TEST_BODY/);
	f.manager.appendMessage(f.queued[0]);
	assert.equal(selectedSkills(f.manager.getBranch()).length, 2);
	await f.session.followUp("/skill:audit later");
	assert.equal(selectedSkills(f.manager.getBranch()).length, 2);
});

test("snapshots survive compaction and reload; changed files require explicit refresh", async (t) => {
	const f = fixture(t);
	const path = f.add("audit", "ORIGINAL_INSTRUCTIONS");
	await f.session.prompt("/skill:audit completed review");
	writeFileSync(path, "CHANGED_INSTRUCTIONS");
	f.manager.appendCompaction(
		"Review completed. Next, inspect another file.",
		null,
		1000,
	);
	f.manager.appendMessage({
		role: "user",
		content: "continue",
		timestamp: Date.now(),
	});
	f.reload();
	let projected = JSON.stringify(f.project());
	assert.match(projected, /ORIGINAL_INSTRUCTIONS/);
	assert.doesNotMatch(projected, /CHANGED_INSTRUCTIONS|completed review/);
	assert.match(projected, /Do not repeat completed actions/);
	await f.command("list");
	assert.match(f.notices.at(-1) ?? "", /changed on disk; refresh explicitly/);
	await f.command("refresh audit");
	projected = JSON.stringify(f.project());
	assert.match(projected, /CHANGED_INSTRUCTIONS/);
	assert.doesNotMatch(projected, /ORIGINAL_INSTRUCTIONS/);
	assert.equal(JSON.stringify(f.project()), projected);
});

test("remove and clear affect only the current branch and remove earlier instruction bodies", async (t) => {
	const f = fixture(t);
	f.add("audit", "AUDIT_BODY");
	f.add("tests", "TEST_BODY");
	await f.session.prompt("/skill:audit /skill:tests work");
	const leaf = f.manager.getLeafId();
	assert.ok(leaf);
	await f.command("remove audit");
	assert.doesNotMatch(JSON.stringify(f.project()), /AUDIT_BODY/);
	assert.match(JSON.stringify(f.project()), /TEST_BODY/);
	await f.command("clear");
	assert.equal(
		selectedSkills(f.manager.getBranch()).filter((skill) => skill.selected)
			.length,
		0,
	);
	assert.doesNotMatch(JSON.stringify(f.project()), /AUDIT_BODY|TEST_BODY/);
	f.manager.branch(leaf);
	assert.match(JSON.stringify(f.project()), /AUDIT_BODY/);
	assert.equal(selectedSkills(SessionManager.inMemory().getBranch()).length, 0);
});

test("model activation uses the same registry and cannot load explicit-only skills", async (t) => {
	const f = fixture(t);
	const path = f.add("audit", "AUTOMATIC_BODY");
	f.add("deploy", "DEPLOY_BODY", true);
	await assert.rejects(
		f.use({ action: "load", names: ["audit", "deploy"] }),
		/explicit user invocation/,
	);
	assert.equal(selectedSkills(f.manager.getBranch()).length, 0);
	await f.use({ action: "load", names: ["audit"] });
	assert.equal(selectedSkills(f.manager.getBranch())[0]?.source, "model");
	writeFileSync(path, "UNREQUESTED_NEW_VERSION");
	await f.use({ action: "load", names: ["audit"] });
	assert.match(JSON.stringify(f.project()), /AUTOMATIC_BODY/);
	assert.doesNotMatch(JSON.stringify(f.project()), /UNREQUESTED_NEW_VERSION/);
	await f.session.prompt("/skill:deploy deploy the change");
	assert.match(JSON.stringify(f.project()), /DEPLOY_BODY/);
});

test("budget failures are atomic, full-body and recoverable through deselection", async (t) => {
	const f = fixture(t);
	f.add("large", "x".repeat(40_000));
	f.add("second", "y".repeat(40_000));
	await assert.rejects(
		f.session.prompt("/skill:large /skill:second task"),
		/No instructions were truncated/,
	);
	assert.equal(selectedSkills(f.manager.getBranch()).length, 0);
	await f.session.prompt("/skill:large task");
	await f.command("load second");
	assert.equal(selectedSkills(f.manager.getBranch()).length, 1);
	assert.match(f.notices.at(-1) ?? "", /No instructions were truncated/);
	f.ctx.model.contextWindow = 10_000;
	assert.throws(() => f.project(), /No instructions were truncated/);
	assert.equal(f.aborted, true);
	assert.deepEqual(
		f.controller.input(
			{ type: "input", text: "continue", source: "interactive" },
			f.ctx,
		),
		{ action: "handled" },
	);
	await f.command("remove large");
	assert.doesNotThrow(() => f.project());
});

test("persistent disable restores native expansion and context behavior, with no duplicate wrappers", async (t) => {
	const f = fixture(t);
	f.add("audit", "AUDIT_BODY");
	f.add("tests", "TEST_BODY");
	await f.command("off");
	assert.equal(readSkillContextEnabled(f.dir), false);
	f.reload();
	await f.session.prompt("/skill:audit /skill:tests task");
	assert.match(f.sent.at(-1).content[0].text, /\/skill:tests task$/);
	assert.doesNotMatch(f.sent.at(-1).content[0].text, /TEST_BODY/);
	const messages = f.manager.buildSessionProjection().messages;
	assert.equal(f.controller.transform(messages, f.ctx), messages);
	await assert.rejects(f.use({ action: "load", names: ["tests"] }), /disabled/);
	await f.command("on");
	await f.session.prompt("/skill:audit /skill:tests next");
	assert.match(f.sent.at(-1).content[0].text, /TEST_BODY/);
	assert.equal(selectedSkills(f.manager.getBranch()).length, 2);
	assert.equal(
		JSON.parse(readFileSync(join(f.dir, "proper-base.json"), "utf8"))
			.skillContext,
		true,
	);
});

test("settings changes apply on the next run and selection commands reject active work", async (t) => {
	const f = fixture(t);
	f.add("audit", "AUDIT_BODY");
	await f.session.prompt("/skill:audit task");
	f.setIdle(false);
	await f.command("clear");
	assert.match(f.notices.at(-1) ?? "", /Wait for the current run/);
	writeSkillContextEnabled(f.dir, false);
	f.manager.appendCompaction("Work in progress", null, 1000);
	f.manager.appendMessage({
		role: "user",
		content: "continue",
		timestamp: Date.now(),
	});
	assert.match(JSON.stringify(f.project()), /AUDIT_BODY/);
	f.controller.prepare({ systemPromptOptions: { sections: {} } } as any);
	assert.doesNotMatch(JSON.stringify(f.project()), /AUDIT_BODY/);
});

test("control commands preserve unrelated config and leave malformed files intact", async (t) => {
	const f = fixture(t);
	const path = join(f.dir, "proper-base.json");
	writeFileSync(path, '{"sessionRail":false,"unrelated":7}');
	await f.command("off");
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
		sessionRail: false,
		unrelated: 7,
		skillContext: false,
	});
	writeFileSync(path, "{broken");
	await f.command("on");
	assert.equal(readFileSync(path, "utf8"), "{broken");
	assert.equal(
		f.manager
			.getBranch()
			.some(
				(entry) =>
					entry.type === "custom" && entry.customType === SKILL_CONTEXT_ENTRY,
			),
		false,
	);
});
