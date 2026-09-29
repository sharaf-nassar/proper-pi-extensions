import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AgentSession,
	ExtensionRunner,
	getMarkdownTheme,
	InteractiveMode,
	initTheme,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences } from "@earendil-works/pi-tui";
import {
	createPromptDisplay,
	PROMPT_DISPLAY_ENTRY,
} from "../src/prompt-display.ts";
import { installPromptDisplayHost } from "../src/prompt-display-host.ts";

function fixture() {
	const manager = SessionManager.inMemory();
	const marker = (text: string) => text;
	const display = createPromptDisplay();
	const commands = [{ name: "review", source: "prompt" }];
	let adapter = installPromptDisplayHost(display, () => commands, marker);
	adapter.activate(manager);
	const sent: any[] = [];
	const queued: any[] = [];
	const model = { provider: "test", id: "test" };
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
	let transform: ((event: any) => any) | undefined;
	const extension: any = {
		path: "test",
		commands: new Map(),
		handlers: new Map([
			["input", [(event: any) => transform?.(event) ?? { action: "continue" }]],
		]),
	};
	const runner = new ExtensionRunner(
		[extension],
		{} as any,
		process.cwd(),
		manager,
		{} as any,
	);
	Object.assign(runner, { getModel: () => model });
	const session: any = Object.create(AgentSession.prototype);
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
			cwd: process.cwd(),
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
			getPrompts: () => ({
				prompts: [{ name: "review", content: "Expanded task" }],
			}),
			getSkills: () => ({ skills: [] }),
		},
		_flushPendingBashMessages() {},
		_flushPendingCustomMessages() {},
		_findLastAssistantMessage: () => undefined,
		_runAgentPrompt: (messages: any[]) => agent.prompt(messages),
	});
	const history: string[] = [];
	const ui: any = Object.setPrototypeOf(
		{
			session,
			getMarkdownTransformers: () => [marker],
			getMarkdownThemeWithSettings: () => getMarkdownTheme(),
			chatContainer: new Container(),
			loadedResourcesContainer: new Container(),
			showStatus() {},
			toolOutputExpanded: false,
			outputPad: 1,
			editor: { addToHistory: (text: string) => history.push(text) },
		},
		InteractiveMode.prototype,
	);
	const text = (message: any) =>
		(InteractiveMode.prototype as any).getUserMessageText.call(ui, message);
	const persist = () => {
		const records = display.drain();
		if (records.length)
			manager.appendCustomEntry(PROMPT_DISPLAY_ENTRY, { prompts: records });
	};
	return {
		manager,
		session,
		ui,
		history,
		sent,
		queued,
		text,
		persist,
		display,
		transform(fn: typeof transform) {
			transform = fn;
		},
		reload() {
			adapter.dispose();
			adapter = installPromptDisplayHost(display, () => commands, marker);
			// Deliberately no activate: Pi rebuilds chat before session_start.
		},
		close: () => adapter.dispose(),
	};
}

test("skill chains render separate native disclosures without changing messages or history", () => {
	initTheme("dark", false);
	const host = fixture();
	try {
		const first =
			'<skill name="one" location="/one/SKILL.md">\nFIRST_BODY\n</skill>';
		const second =
			'<skill name="two" location="/two/SKILL.md">\nSECOND_BODY\n</skill>';
		const text = `${first}\n\n${second}\n\nKeep this request visible.`;
		const message: any = {
			role: "user",
			content: [
				{ type: "text", text },
				{ type: "image", data: "attachment", mimeType: "image/png" },
			],
			timestamp: 1,
		};
		const before = structuredClone(message);
		const render = () =>
			host.ui.chatContainer.render(80).map(stripTerminalSequences).join("\n");
		for (const replay of [false, true]) {
			if (replay) host.reload();
			host.ui.chatContainer.clear();
			host.ui.addMessageToChat(message, { populateHistory: true });
			const skills = host.ui.chatContainer.children.filter(
				(child: any) =>
					child.constructor.name === "SkillInvocationMessageComponent",
			);
			assert.equal(skills.length, 2);
			assert.match(render(), /Keep this request visible/);
			assert.doesNotMatch(render(), /FIRST_BODY|SECOND_BODY|<skill/);
			const click = {
				type: "click",
				button: "left",
				x: 1,
				y: 1,
				screenX: 1,
				screenY: 1,
				width: 80,
				height: 3,
				shift: false,
				alt: false,
				ctrl: false,
			};
			assert.ok(skills[1].handleMouse(click)?.handled);
			assert.match(render(), /SECOND_BODY/);
			assert.doesNotMatch(render(), /FIRST_BODY/);
			assert.ok(skills[1].handleMouse(click)?.handled);
			assert.doesNotMatch(render(), /SECOND_BODY/);
			host.ui.setToolsExpanded(true);
			assert.match(render(), /FIRST_BODY/);
			assert.match(render(), /SECOND_BODY/);
			host.ui.setToolsExpanded(false);
			assert.doesNotMatch(render(), /FIRST_BODY|SECOND_BODY/);
		}
		assert.deepEqual(host.history, [text, text]);
		assert.deepEqual(message, before);
		host.ui.chatContainer.clear();
		host.ui.getMarkdownTransformers = () => [];
		host.ui.addMessageToChat(message);
		assert.match(
			render(),
			/SECOND_BODY/,
			"unowned hosts keep native rendering",
		);
	} finally {
		host.close();
	}
});

// @lat: [[lat.md/proper-base/tests#Verification#Prompt display fixture]]
test("handled and rejected template submissions cannot relabel later messages", async () => {
	const host = fixture();
	try {
		host.transform((event) =>
			event.text.includes("handled") ? { action: "handled" } : undefined,
		);
		await host.session.prompt("/review handled");
		host.session.agent.state.model = undefined;
		await assert.rejects(host.session.prompt("/review rejected"), /model/i);
		host.session.agent.state.model = { provider: "test", id: "test" };
		await host.session.prompt("plain next prompt");
		assert.equal(host.text(host.sent[0]), "plain next prompt");
		assert.deepEqual(host.display.drain(), []);
		await host.session.prompt("/review accepted");
		assert.equal(
			host.sent[1].content[0].text,
			"Expanded task",
			"model text stays native",
		);
		assert.equal(host.text(host.sent[1]), "/review accepted");
		host.persist();
		host.reload();
		assert.equal(
			host.text(host.sent[1]),
			"/review accepted",
			"reload restores before session_start",
		);
	} finally {
		host.close();
	}
});

test("identical expansion text keeps per-message display across queues and reload", async () => {
	const host = fixture();
	try {
		host.session._isAgentRunActive = true;
		await host.session.steer("/review first");
		await host.session.followUp("/review second");
		await host.session.prompt("/review third", { streamingBehavior: "steer" });
		await host.session.steer("Expanded task");
		assert.deepEqual(host.queued.map(host.text), [
			"/review first",
			"/review second",
			"/review third",
			"Expanded task",
		]);
		for (const message of host.queued) host.manager.appendMessage(message);
		host.persist();
		host.reload();
		assert.deepEqual(host.queued.map(host.text), [
			"/review first",
			"/review second",
			"/review third",
			"Expanded task",
		]);
		host.close();
		assert.deepEqual(
			host.queued.map(host.text),
			Array(4).fill("Expanded task"),
		);
	} finally {
		host.close();
	}
});

test("concurrent transformed inputs retain their own invocation and abandoned queues leave no records", async () => {
	const host = fixture();
	try {
		let release!: () => void;
		host.transform(async (event) => {
			if (event.text === "/review slow")
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			return { action: "transform", text: "transformed body" };
		});
		const slow = host.session.steer("/review slow");
		await host.session.followUp("/review fast");
		release();
		await slow;
		assert.deepEqual(host.queued.map(host.text), [
			"/review fast",
			"/review slow",
		]);
		assert.deepEqual(
			host.display.drain(),
			[],
			"undelivered queue entries never persist metadata",
		);
		assert.ok(
			host.queued.every(
				(message) => message.content[0].text === "transformed body",
			),
		);
	} finally {
		host.close();
	}
});

test("legacy hash records and inactive branches cannot relabel new message identities", () => {
	const display = createPromptDisplay();
	const manager = SessionManager.inMemory();
	const message: any = { role: "user", content: "Expanded task", timestamp: 0 };
	const id = manager.appendMessage(message);
	manager.appendCustomEntry(PROMPT_DISPLAY_ENTRY, {
		prompts: [
			{ hash: "legacy", raw: "/review old" },
			{ messageEntryId: "another-branch", raw: "/review wrong" },
		],
	});
	display.restore(manager.getBranch());
	assert.equal(display.rawFor(message), undefined);
	manager.appendCustomEntry(PROMPT_DISPLAY_ENTRY, {
		prompts: [{ messageEntryId: id, raw: "/review exact" }],
	});
	display.restore(manager.getBranch());
	assert.equal(display.rawFor(message), "/review exact");
	assert.equal(display.rawFor({ ...message }), undefined);
});
