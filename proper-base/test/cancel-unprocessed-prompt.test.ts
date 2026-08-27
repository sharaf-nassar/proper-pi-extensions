import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import properBase from "../index.ts";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";

test("cancelling an unprocessed prompt restores it and leaves its session branch", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-cancel-prompt-"));
	const handlers = new Map<string, (...args: any[]) => any>();
	let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
	let terminalInput: ((data: string) => unknown) | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: any) => any)
		| undefined;
	let sentCommand: string | undefined;
	let editorText = "";
	let navigatedTo: string | undefined;
	let idle = false;
	let leafId: string | null = null;
	const entries: any[] = [];

	const pi = {
		on(event: string, handler: (...args: any[]) => any) {
			handlers.set(event, handler);
		},
		registerCommand(name: string, options: any) {
			if (name === "__proper-cancel-prompt") commandHandler = options.handler;
		},
		sendUserMessage(text: string) {
			sentCommand = text;
		},
		getCommands: () => [],
		appendEntry(customType: string) {
			const entry = {
				type: "custom",
				customType,
				id: "anchor",
				parentId: leafId,
			};
			entries.push(entry);
			leafId = entry.id;
		},
	} as any;
	properBase(pi);

	const editor = {
		onSubmit: undefined as ((text: string) => void) | undefined,
		addToHistory() {},
		getText: () => editorText,
		setText(text: string) {
			editorText = text;
		},
		isShowingAutocomplete: () => false,
		render: () => ["editor"],
	};
	const terminal = { rows: 24, write() {} };
	const tui = {
		children: [editor],
		terminal,
		getFocusedComponent: () => editor,
	};
	const sessionManager = {
		getBranch: (fromId?: string) => {
			const byId = new Map(entries.map((entry) => [entry.id, entry]));
			const path: any[] = [];
			let current = byId.get(fromId ?? leafId ?? "");
			while (current) {
				path.push(current);
				current = current.parentId ? byId.get(current.parentId) : undefined;
			}
			return path.reverse();
		},
		getEntries: () => [...entries],
		getSessionFile: () => undefined,
		getLeafId: () => leafId,
		getLeafEntry: () => entries.find((entry) => entry.id === leafId),
		getEntry: (id: string) => entries.find((entry) => entry.id === id),
	};
	const ctx = {
		cwd,
		isIdle: () => idle,
		sessionManager,
		ui: {
			addAutocompleteProvider() {},
			getEditorComponent: () => () => editor,
			setEditorComponent(factory: typeof installedFactory) {
				installedFactory = factory;
			},
			onTerminalInput(handler: typeof terminalInput) {
				terminalInput = handler;
				return () => {};
			},
			setEditorText(text: string) {
				editorText = text;
			},
		},
	};

	try {
		await handlers.get("session_start")?.({}, ctx);
		installedFactory?.(
			tui,
			{
				borderColor: (text: string) => text,
				selectList: { description: (text: string) => text },
			},
			new KeybindingsManager(),
		);

		assert.ok(handlers.get("input"));
		assert.ok(handlers.get("message_start"));
		assert.ok(handlers.get("agent_settled"));
		assert.ok(commandHandler);
		assert.ok(terminalInput);

		await handlers.get("input")?.(
			{ source: "interactive", text: "edit this prompt" },
			ctx,
		);
		const userMessage = {
			role: "user",
			content: [{ type: "text", text: "edit this prompt" }],
			timestamp: 123,
		};
		await handlers.get("message_start")?.({ message: userMessage }, ctx);
		entries.push({
			type: "message",
			id: "user-entry",
			parentId: null,
			message: userMessage,
		});
		leafId = "user-entry";

		terminalInput?.("\x1b");
		assert.equal(editorText, "edit this prompt");

		await handlers.get("agent_settled")?.({}, ctx);
		assert.equal(sentCommand, "/__proper-cancel-prompt");

		await commandHandler?.("", {
			...ctx,
			navigateTree: async (targetId: string) => {
				navigatedTo = targetId;
				return { cancelled: false };
			},
		});
		assert.equal(entries.at(-1)?.customType, "proper-cancel-anchor");
		assert.equal(navigatedTo, "user-entry");

		editorText = "";
		idle = true;
		editor.onSubmit = () => {};
		editor.onSubmit?.("cancel during routing");
		terminalInput?.("\x1b");
		assert.equal(editorText, "cancel during routing");

		editorText = "";
		idle = false;
		sentCommand = undefined;
		await handlers.get("input")?.(
			{ source: "interactive", text: "already processing" },
			ctx,
		);
		await handlers.get("message_start")?.(
			{
				message: {
					role: "user",
					content: [{ type: "text", text: "already processing" }],
					timestamp: 456,
				},
			},
			ctx,
		);
		await handlers.get("message_start")?.(
			{
				message: {
					role: "assistant",
					content: [],
					stopReason: "stop",
					timestamp: 457,
				},
			},
			ctx,
		);
		terminalInput?.("\x1b");
		assert.equal(editorText, "");
		await handlers.get("agent_settled")?.({}, ctx);
		assert.equal(sentCommand, undefined);

		editor.onSubmit?.("queued prompt");
		await handlers.get("input")?.(
			{
				source: "interactive",
				text: "queued prompt",
				streamingBehavior: "steer",
			},
			ctx,
		);
		terminalInput?.("\x1b");
		assert.equal(editorText, "");

		// An extension that wraps Pi's input dispatch appends its own transcript
		// entry between submission and the user message, so that entry is the
		// prompt's parent and must leave the branch with it.
		entries.length = 0;
		editorText = "";
		sentCommand = undefined;
		navigatedTo = undefined;
		entries.push({
			type: "message",
			id: "prior-assistant",
			parentId: null,
			message: { role: "assistant", content: [], timestamp: 700 },
		});
		leafId = "prior-assistant";
		editor.onSubmit?.("pacified prompt");
		entries.push({
			type: "custom",
			customType: "proper-pacify",
			id: "pacify-entry",
			parentId: leafId,
		});
		leafId = "pacify-entry";
		await handlers.get("input")?.(
			{ source: "interactive", text: "pacified prompt" },
			ctx,
		);
		const pacifiedMessage = {
			role: "user",
			content: [{ type: "text", text: "pacified prompt" }],
			timestamp: 789,
		};
		await handlers.get("message_start")?.({ message: pacifiedMessage }, ctx);
		entries.push({
			type: "message",
			id: "pacified-entry",
			parentId: "pacify-entry",
			message: pacifiedMessage,
		});
		leafId = "pacified-entry";

		terminalInput?.("\x1b");
		assert.equal(editorText, "pacified prompt");
		await handlers.get("agent_settled")?.({}, ctx);
		assert.equal(sentCommand, "/__proper-cancel-prompt");
		await commandHandler?.("", {
			...ctx,
			navigateTree: async (targetId: string) => {
				navigatedTo = targetId;
				return { cancelled: false };
			},
		});
		assert.equal(navigatedTo, "prior-assistant");
		assert.equal(entries.at(-1)?.id, "pacified-entry");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
