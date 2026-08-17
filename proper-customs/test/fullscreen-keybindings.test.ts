import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import properCustoms from "../index.ts";

test("fullscreen navigation keeps plain keys in the prompt and shifts transcript scrolling", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-customs-fullscreen-"));
	let onSessionStart: ((event: unknown, ctx: any) => Promise<void>) | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: KeybindingsManager) => any)
		| undefined;

	properCustoms({
		on(event: string, handler: typeof onSessionStart) {
			if (event === "session_start") onSessionStart = handler;
		},
	} as any);

	const editor = {
		onSubmit: undefined,
		addToHistory() {},
		render: () => ["editor"],
	};
	const keybindings = new KeybindingsManager({
		"app.model.select": "alt+l",
	});

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
			{ children: [], terminal: { rows: 24 } },
			{
				borderColor: (text: string) => text,
				selectList: { description: (text: string) => text },
			},
			keybindings,
		);

		assert.deepEqual(keybindings.getKeys("tui.altScreen.pageUp"), [
			"shift+pageUp",
		]);
		assert.deepEqual(keybindings.getKeys("tui.altScreen.pageDown"), [
			"shift+pageDown",
		]);
		assert.deepEqual(keybindings.getKeys("tui.altScreen.top"), ["shift+home"]);
		assert.deepEqual(keybindings.getKeys("tui.altScreen.bottom"), ["shift+end"]);
		assert.equal(keybindings.matches("\x1b[5~", "tui.altScreen.pageUp"), false);
		assert.equal(keybindings.matches("\x1b[5$", "tui.altScreen.pageUp"), true);
		assert.equal(keybindings.matches("\x1b[7~", "tui.altScreen.top"), false);
		assert.equal(keybindings.matches("\x1b[7$", "tui.altScreen.top"), true);

		assert.ok(keybindings.getKeys("tui.editor.pageUp").includes("pageUp"));
		assert.ok(keybindings.getKeys("tui.editor.pageDown").includes("pageDown"));
		assert.ok(keybindings.getKeys("tui.editor.cursorLineStart").includes("home"));
		assert.ok(keybindings.getKeys("tui.editor.cursorLineEnd").includes("end"));
		assert.equal(keybindings.matches("\x1b[5~", "tui.editor.pageUp"), true);
		assert.equal(keybindings.matches("\x1b[7~", "tui.editor.cursorLineStart"), true);
		assert.deepEqual(keybindings.getKeys("app.model.select"), ["alt+l"]);

		keybindings.setUserBindings({ "app.model.select": "ctrl+l" });
		keybindings.reload();
		assert.deepEqual(keybindings.getKeys("tui.altScreen.pageUp"), [
			"shift+pageUp",
		]);
		assert.deepEqual(keybindings.getKeys("app.model.select"), ["ctrl+l"]);

		const firstInstall = keybindings.getUserBindings();
		installedFactory?.(
			{ children: [], terminal: { rows: 24 } },
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
