import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import properBase from "../index.ts";

type Handler = (...args: any[]) => any;

async function createFixture(options?: {
	name?: string;
	priorAssistant?: boolean;
}) {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-session-title-"));
	const handlers = new Map<string, Handler>();
	let transformer:
		| ((
				markdown: string,
				context: { messageType: string; isStreaming: boolean },
		  ) => string)
		| undefined;
	let sessionName = options?.name;
	const branch = options?.priorAssistant
		? [
				{
					type: "message",
					message: { role: "assistant", content: [] },
				},
			]
		: [];
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, handler);
		},
		registerCommand() {},
		registerMarkdownTransformer(callback: typeof transformer) {
			transformer = callback;
		},
		getCommands: () => [],
		getSessionName: () => sessionName,
		setSessionName(name: string) {
			sessionName = name;
		},
	} as unknown as Parameters<typeof properBase>[0];
	properBase(pi);

	const ctx = {
		cwd,
		sessionManager: {
			getBranch: () => branch,
			getSessionFile: () => undefined,
		},
		ui: {
			addAutocompleteProvider() {},
			getEditorComponent: () => undefined,
			setEditorComponent() {},
			onTerminalInput() {
				return () => {};
			},
			setEditorText() {},
		},
	};

	await handlers.get("session_start")?.({}, ctx);
	return {
		cleanup: () => rm(cwd, { recursive: true, force: true }),
		ctx,
		handlers,
		getName: () => sessionName,
		getTransformer: () => transformer,
	};
}

// @lat: [[lat.md/proper-base/tests#Verification#Session-title fixture]]
test("first response names a fresh session and hides the title marker", async () => {
	const fixture = await createFixture();
	try {
		const beforeAgentStart = fixture.handlers.get("before_agent_start");
		const messageEnd = fixture.handlers.get("message_end");
		const transformer = fixture.getTransformer();
		assert.ok(beforeAgentStart);
		assert.ok(messageEnd);
		assert.ok(transformer);

		const prompt = await beforeAgentStart(
			{ systemPrompt: "base prompt" },
			fixture.ctx,
		);
		assert.match(prompt.systemPrompt, /<session_title>/);

		const markdown =
			"Implemented it.\n<session_title>Fix\x1b terminal\x07 tab title</session_title>";
		assert.equal(
			transformer(markdown, {
				messageType: "assistant",
				isStreaming: false,
			}),
			"Implemented it.",
		);

		await messageEnd(
			{
				message: {
					role: "assistant",
					content: [{ type: "text", text: markdown }],
				},
			},
			fixture.ctx,
		);
		assert.equal(fixture.getName(), "Fix terminal tab title");
		assert.equal(
			await beforeAgentStart({ systemPrompt: "next" }, fixture.ctx),
			undefined,
		);
	} finally {
		await fixture.cleanup();
	}
});

test("an aborted response leaves automatic naming for the retry", async () => {
	const fixture = await createFixture();
	try {
		const beforeAgentStart = fixture.handlers.get("before_agent_start");
		const messageEnd = fixture.handlers.get("message_end");
		assert.ok(beforeAgentStart);
		assert.ok(messageEnd);

		await messageEnd(
			{
				message: {
					role: "assistant",
					stopReason: "aborted",
					content: [
						{
							type: "text",
							text: "<session_title>Incomplete title</session_title>",
						},
					],
				},
			},
			fixture.ctx,
		);
		assert.equal(fixture.getName(), undefined);
		assert.match(
			(await beforeAgentStart({ systemPrompt: "retry prompt" }, fixture.ctx))
				.systemPrompt,
			/<session_title>/,
		);
	} finally {
		await fixture.cleanup();
	}
});

test("a completed response without metadata ends automatic naming", async () => {
	const fixture = await createFixture();
	try {
		const beforeAgentStart = fixture.handlers.get("before_agent_start");
		const messageEnd = fixture.handlers.get("message_end");
		assert.ok(beforeAgentStart);
		assert.ok(messageEnd);

		await messageEnd(
			{
				message: {
					role: "assistant",
					stopReason: "stop",
					content: [{ type: "text", text: "Completed without metadata." }],
				},
			},
			fixture.ctx,
		);
		assert.equal(
			await beforeAgentStart({ systemPrompt: "next prompt" }, fixture.ctx),
			undefined,
		);
	} finally {
		await fixture.cleanup();
	}
});

test("automatic naming leaves explicit and established sessions alone", async () => {
	for (const options of [{ name: "Manual name" }, { priorAssistant: true }]) {
		const fixture = await createFixture(options);
		try {
			const beforeAgentStart = fixture.handlers.get("before_agent_start");
			const messageEnd = fixture.handlers.get("message_end");
			assert.ok(beforeAgentStart);
			assert.ok(messageEnd);
			assert.equal(
				await beforeAgentStart({ systemPrompt: "base" }, fixture.ctx),
				undefined,
			);
			await messageEnd(
				{
					message: {
						role: "assistant",
						content: [
							{
								type: "text",
								text: "<session_title>Replacement</session_title>",
							},
						],
					},
				},
				fixture.ctx,
			);
			assert.equal(fixture.getName(), options.name);
		} finally {
			await fixture.cleanup();
		}
	}
});
