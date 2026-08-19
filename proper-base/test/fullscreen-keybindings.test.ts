import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import properBase from "../index.ts";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";

test("base keybindings add image paste, prompt newlines, and transcript shortcuts", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-fullscreen-"));
	let onSessionStart: ((event: unknown, ctx: any) => Promise<void>) | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: KeybindingsManager) => any)
		| undefined;

	properBase({
		on(event: string, handler: typeof onSessionStart) {
			if (event === "session_start") onSessionStart = handler;
		},
		getCommands: () => [],
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
			if (data === "\x1b[H") editorState.cursorCol = 0;
			if (data === "\x1b[F") {
				editorState.cursorCol =
					editorState.lines[editorState.cursorLine]?.length ?? 0;
			}
		},
		buildVisualLineMap() {
			return editorState.lines.flatMap((line, logicalLine) =>
				line.length > 6
					? [
							{ logicalLine, startCol: 0, length: 6 },
							{ logicalLine, startCol: 6, length: line.length - 6 },
						]
					: [{ logicalLine, startCol: 0, length: line.length }],
			);
		},
		findCurrentVisualLine(visualLines: any[]) {
			return visualLines.findIndex((line, index) => {
				if (line.logicalLine !== editorState.cursorLine) return false;
				const offset = editorState.cursorCol - line.startCol;
				const last = visualLines[index + 1]?.logicalLine !== line.logicalLine;
				return (
					offset >= 0 &&
					(offset < line.length || (last && offset === line.length))
				);
			});
		},
		render: () => ["editor"],
	};
	const keybindings = new KeybindingsManager({
		"app.model.select": "alt+l",
		"app.clipboard.pasteImage": "alt+v",
		"tui.input.newLine": "ctrl+n",
		"app.message.followUp": ["alt+enter", "ctrl+alt+enter"],
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
		assert.deepEqual(keybindings.getKeys("app.clipboard.pasteImage"), [
			"alt+v",
			"ctrl+v",
			"ctrl+shift+v",
		]);
		assert.equal(keybindings.matches("\x16", "app.clipboard.pasteImage"), true);
		assert.equal(
			keybindings.matches("\x1b[118;6u", "app.clipboard.pasteImage"),
			true,
		);
		assert.deepEqual(keybindings.getKeys("tui.input.newLine"), [
			"ctrl+n",
			"shift+enter",
			"alt+enter",
		]);
		assert.deepEqual(keybindings.getKeys("app.message.followUp"), [
			"ctrl+alt+enter",
		]);
		assert.equal(keybindings.matches("\x1b[13;2u", "tui.input.newLine"), true);
		assert.equal(keybindings.matches("\x1b[13;3u", "tui.input.newLine"), true);
		assert.equal(
			keybindings.matches("\x1b[13;3u", "app.message.followUp"),
			false,
		);
		assert.equal(keybindings.matches("\x1b[5~", "tui.altScreen.pageUp"), false);
		assert.equal(keybindings.matches("\x1b[5$", "tui.altScreen.pageUp"), false);
		assert.equal(
			keybindings.matches("\x1b[5;6~", "tui.altScreen.pageUp"),
			true,
		);
		assert.equal(
			keybindings.matches("\x1b[6;6~", "tui.altScreen.pageDown"),
			true,
		);
		assert.equal(keybindings.matches("\x1b[7~", "tui.altScreen.top"), false);
		assert.equal(keybindings.matches("\x1b[7$", "tui.altScreen.top"), false);
		assert.equal(keybindings.matches("\x1b[1;6H", "tui.altScreen.top"), true);
		assert.equal(
			keybindings.matches("\x1b[1;6F", "tui.altScreen.bottom"),
			true,
		);

		assert.ok(keybindings.getKeys("tui.editor.pageUp").includes("pageUp"));
		assert.ok(keybindings.getKeys("tui.editor.pageDown").includes("pageDown"));
		assert.ok(
			keybindings.getKeys("tui.editor.cursorLineStart").includes("home"),
		);
		assert.ok(keybindings.getKeys("tui.editor.cursorLineEnd").includes("end"));
		assert.equal(keybindings.matches("\x1b[5~", "tui.editor.pageUp"), true);
		assert.equal(
			keybindings.matches("\x1b[7~", "tui.editor.cursorLineStart"),
			true,
		);
		assert.deepEqual(keybindings.getKeys("app.model.select"), ["alt+l"]);

		editor.handleInput("\x1b[F");
		assert.deepEqual(editor.getCursor(), { line: 1, col: 3 });
		editor.handleInput("\x1b[F");
		assert.deepEqual(editor.getCursor(), { line: 2, col: 5 });
		editor.handleInput("\x1b[F");
		assert.deepEqual(editor.getCursor(), { line: 2, col: 5 });

		editorState.lines = ["abcdefghij", "second"];
		editorState.cursorLine = 0;
		editorState.cursorCol = 8;
		editor.handleInput("\x1b[H");
		assert.deepEqual(editor.getCursor(), { line: 0, col: 6 });
		editor.handleInput("\x1b[H");
		assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
		editorState.cursorLine = 1;
		editorState.cursorCol = 3;
		editor.handleInput("\x1b[H");
		assert.deepEqual(editor.getCursor(), { line: 1, col: 0 });
		editor.handleInput("\x1b[H");
		assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });

		keybindings.setUserBindings({ "app.model.select": "ctrl+l" });
		keybindings.reload();
		assert.deepEqual(keybindings.getKeys("tui.altScreen.pageUp"), [
			"ctrl+shift+pageUp",
		]);
		assert.deepEqual(keybindings.getKeys("app.clipboard.pasteImage"), [
			"ctrl+v",
			"ctrl+shift+v",
		]);
		assert.deepEqual(keybindings.getKeys("tui.input.newLine"), [
			"shift+enter",
			"ctrl+j",
			"alt+enter",
		]);
		assert.deepEqual(keybindings.getKeys("app.message.followUp"), []);
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
