import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import properBase from "../index.ts";

test("fullscreen navigation keeps plain keys in the prompt and uses ctrl-shift for transcript scrolling", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-fullscreen-"));
	let onSessionStart: ((event: unknown, ctx: any) => Promise<void>) | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: KeybindingsManager) => any)
		| undefined;

	properBase({
		on(event: string, handler: typeof onSessionStart) {
			if (event === "session_start") onSessionStart = handler;
		},
	} as any);

	const editorState = {
		lines: ["one", "two", "three"],
		cursorLine: 1,
		cursorCol: 1,
	};
	const editor = {
		state: editorState,
		onSubmit: undefined,
		addToHistory() {},
		getLines: () => [...editorState.lines],
		getCursor: () => ({
			line: editorState.cursorLine,
			col: editorState.cursorCol,
		}),
		handleInput(data: string) {
			if (data === "\x1b[F") {
				editorState.cursorCol =
					editorState.lines[editorState.cursorLine]?.length ?? 0;
			}
		},
		render: () => ["editor"],
	};
	const keybindings = new KeybindingsManager({
		"app.model.select": "alt+l",
	});
	const staleReload = keybindings.reload.bind(keybindings);
	keybindings.reload = () => {
		staleReload();
		keybindings.setUserBindings({
			...keybindings.getUserBindings(),
			"tui.altScreen.pageUp": "shift+pageUp",
			"tui.altScreen.pageDown": "shift+pageDown",
			"tui.altScreen.top": "shift+home",
			"tui.altScreen.bottom": "shift+end",
		});
	};
	(keybindings as any)[Symbol.for("pi-proper-customs.fullscreen-keybindings")] =
		true;
	const writes: string[] = [];
	const terminal = {
		rows: 24,
		write(data: string) {
			writes.push(data);
		},
	};
	const originalWrite = terminal.write;

	try {
		await onSessionStart?.(
			{},
			{
				cwd,
				sessionManager: {
					getBranch: () => [],
					getSessionFile: () => undefined,
				},
				ui: {
					getEditorComponent: () => () => editor,
					setEditorComponent: (factory: typeof installedFactory) => {
						installedFactory = factory;
					},
				},
			},
		);
		installedFactory?.(
			{ children: [], terminal },
			{
				borderColor: (text: string) => text,
				selectList: { description: (text: string) => text },
			},
			keybindings,
		);

		assert.equal(terminal.write, originalWrite);
		const mouseEnable =
			"\x1b[?1049h\x1b[?1000h\x1b[?1003h\x1b[?1004h\x1b[?1006h";
		terminal.write(mouseEnable);
		assert.deepEqual(writes, [mouseEnable]);

		assert.deepEqual(keybindings.getKeys("tui.altScreen.pageUp"), [
			"ctrl+shift+pageUp",
		]);
		assert.deepEqual(keybindings.getKeys("tui.altScreen.pageDown"), [
			"ctrl+shift+pageDown",
		]);
		assert.deepEqual(keybindings.getKeys("tui.altScreen.top"), [
			"ctrl+shift+home",
		]);
		assert.deepEqual(keybindings.getKeys("tui.altScreen.bottom"), [
			"ctrl+shift+end",
		]);
		assert.equal(keybindings.matches("\x1b[5~", "tui.altScreen.pageUp"), false);
		assert.equal(keybindings.matches("\x1b[5$", "tui.altScreen.pageUp"), false);
		assert.equal(keybindings.matches("\x1b[5;6~", "tui.altScreen.pageUp"), true);
		assert.equal(keybindings.matches("\x1b[6;6~", "tui.altScreen.pageDown"), true);
		assert.equal(keybindings.matches("\x1b[7~", "tui.altScreen.top"), false);
		assert.equal(keybindings.matches("\x1b[7$", "tui.altScreen.top"), false);
		assert.equal(keybindings.matches("\x1b[1;6H", "tui.altScreen.top"), true);
		assert.equal(keybindings.matches("\x1b[1;6F", "tui.altScreen.bottom"), true);

		assert.ok(keybindings.getKeys("tui.editor.pageUp").includes("pageUp"));
		assert.ok(keybindings.getKeys("tui.editor.pageDown").includes("pageDown"));
		assert.ok(keybindings.getKeys("tui.editor.cursorLineStart").includes("home"));
		assert.ok(keybindings.getKeys("tui.editor.cursorLineEnd").includes("end"));
		assert.equal(keybindings.matches("\x1b[5~", "tui.editor.pageUp"), true);
		assert.equal(keybindings.matches("\x1b[7~", "tui.editor.cursorLineStart"), true);
		assert.deepEqual(keybindings.getKeys("app.model.select"), ["alt+l"]);

		editor.handleInput("\x1b[F");
		assert.deepEqual(editor.getCursor(), { line: 1, col: 3 });
		editor.handleInput("\x1b[F");
		assert.deepEqual(editor.getCursor(), { line: 2, col: 5 });
		editor.handleInput("\x1b[F");
		assert.deepEqual(editor.getCursor(), { line: 2, col: 5 });

		keybindings.setUserBindings({ "app.model.select": "ctrl+l" });
		keybindings.reload();
		assert.deepEqual(keybindings.getKeys("tui.altScreen.pageUp"), [
			"ctrl+shift+pageUp",
		]);
		assert.deepEqual(keybindings.getKeys("app.model.select"), ["ctrl+l"]);

		const firstInstall = keybindings.getUserBindings();
		installedFactory?.(
			{ children: [], terminal },
			{
				borderColor: (text: string) => text,
				selectList: { description: (text: string) => text },
			},
			keybindings,
		);
		assert.deepEqual(keybindings.getUserBindings(), firstInstall);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
