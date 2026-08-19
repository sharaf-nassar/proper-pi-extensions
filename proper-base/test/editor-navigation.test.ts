import assert from "node:assert/strict";
import { test } from "node:test";

import { installEditorNavigation } from "../src/editor-navigation.ts";

test("history recall with Up leaves the cursor at the prompt start", () => {
	const state = { lines: [""], cursorLine: 0, cursorCol: 0 };
	const editor = {
		state,
		historyIndex: -1,
		getCursor: () => ({ line: state.cursorLine, col: state.cursorCol }),
		getLines: () => [...state.lines],
		handleInput(data: string) {
			if (data !== "up") return;
			state.lines = ["recalled", "prompt"];
			state.cursorLine = 1;
			state.cursorCol = 6;
			this.historyIndex = 0;
		},
		render: () => [],
		invalidate() {},
	};
	const keybindings = {
		matches(data: string, action: string) {
			return data === "up" && action === "tui.editor.cursorUp";
		},
	};

	installEditorNavigation(editor, keybindings);
	editor.handleInput("up");

	assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
});
