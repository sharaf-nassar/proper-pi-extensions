import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
	installEditorNavigation,
	installPromptClear,
	installReverseHistorySearch,
} from "../src/editor-navigation.ts";

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

function reverseSearchFixture(text = "draft prompt") {
	const state = { lines: text.split("\n"), cursorLine: 0, cursorCol: 2 };
	const submitted: string[] = [];
	const delegated: string[] = [];
	let renders = 0;
	const editor = {
		state,
		borderColor: (value: string) => value,
		getCursor: () => ({ line: state.cursorLine, col: state.cursorCol }),
		getText: () => state.lines.join("\n"),
		handleInput(data: string) {
			delegated.push(data);
			if (data === "\r") {
				submitted.push(this.getText());
				state.lines = [""];
				state.cursorLine = 0;
				state.cursorCol = 0;
			}
			if (data === "left") state.cursorCol--;
		},
		invalidate() {},
		render: (width: number) => ["─".repeat(width), text, "─".repeat(width)],
		setText(next: string) {
			state.lines = next.split("\n");
			state.cursorLine = state.lines.length - 1;
			state.cursorCol = state.lines.at(-1)?.length ?? 0;
		},
	};
	const keybindings = {
		matches(data: string, action: string) {
			return (
				(data === "\r" && action === "tui.input.submit") ||
				(data === "\x7f" && action === "tui.editor.deleteCharBackward") ||
				(data === "left" && action === "tui.editor.cursorLeft")
			);
		},
	};
	const controller = installReverseHistorySearch(
		editor,
		{ requestRender: () => renders++ },
		keybindings,
		["git status", "npm test", "git log"],
		200,
	);
	return {
		controller,
		delegated,
		editor,
		renders: () => renders,
		state,
		submitted,
	};
}

// @lat: [[lat.md/proper-base/tests#Verification#Reverse history search fixture]]
test("Ctrl+R incrementally searches older prompts and Ctrl+G restores the draft", () => {
	const fixture = reverseSearchFixture();

	fixture.editor.handleInput("\x12");
	assert.equal(fixture.editor.getText(), "git log");
	assert.match(
		fixture.editor.render(40).at(-1) ?? "",
		/^\(reverse-i-search\)`':/,
	);

	fixture.editor.handleInput("g");
	fixture.editor.handleInput("\x12");
	assert.equal(fixture.editor.getText(), "git status");

	fixture.editor.handleInput("x");
	assert.equal(fixture.editor.getText(), "git status");
	assert.match(
		fixture.editor.render(40).at(-1) ?? "",
		/^\(failing reverse-i-search\)`gx':/,
	);

	fixture.editor.handleInput("\x7f");
	assert.doesNotMatch(fixture.editor.render(40).at(-1) ?? "", /failing/);
	fixture.editor.handleInput("\x07");
	assert.equal(fixture.editor.getText(), "draft prompt");
	assert.deepEqual(fixture.editor.getCursor(), { line: 0, col: 2 });
	assert.ok(fixture.renders() > 0);
});

test("reverse search accepts with Escape, submits with Enter, and sees new prompts", () => {
	const fixture = reverseSearchFixture("");
	fixture.controller?.add("newest prompt");

	fixture.editor.handleInput("\x12");
	assert.equal(fixture.editor.getText(), "newest prompt");
	fixture.editor.handleInput("\x1b");
	assert.equal(fixture.editor.getText(), "newest prompt");
	assert.doesNotMatch(
		fixture.editor.render(40).at(-1) ?? "",
		/reverse-i-search/,
	);

	fixture.editor.handleInput("\x12");
	fixture.editor.handleInput("n");
	fixture.editor.handleInput("p");
	fixture.editor.handleInput("m");
	fixture.editor.handleInput("\r");
	assert.deepEqual(fixture.submitted, ["npm test"]);
	assert.equal(fixture.delegated.at(-1), "\r");

	fixture.editor.setText("edit me");
	fixture.editor.handleInput("\x12");
	fixture.editor.handleInput("\x1b");
	fixture.editor.handleInput("left");
	assert.equal(fixture.delegated.at(-1), "left");
});

// @lat: [[lat.md/proper-base/tests#Verification#Prompt clear fixture]]
test("Ctrl+C clears text before showing a transient exit warning", async () => {
	let text = "draft prompt";
	let shutdowns = 0;
	const editor = {
		getText: () => text,
		handleInput(_data: string) {},
		invalidate() {},
		render: (_width: number) => ["editor"],
		setText(next: string) {
			text = next;
		},
	};
	const keybindings = {
		matches(data: string, action: string) {
			return data === "ctrl+c" && action === "app.clear";
		},
	};
	const cleanup = installPromptClear(
		editor,
		{ requestRender() {} },
		keybindings,
		{
			shutdown: () => shutdowns++,
			ui: {
				theme: { fg: (_color: "warning", value: string) => `warning:${value}` },
			},
		},
	);

	editor.handleInput("ctrl+c");
	assert.equal(text, "");
	assert.deepEqual(editor.render(80), ["editor"]);
	assert.equal(shutdowns, 0);

	editor.handleInput("ctrl+c");
	assert.deepEqual(editor.render(80), [
		"warning: Press Ctrl+C again to exit",
		"editor",
	]);
	assert.equal(shutdowns, 0);

	editor.handleInput("ctrl+c");
	assert.equal(shutdowns, 1);
	assert.deepEqual(editor.render(80), ["editor"]);

	editor.handleInput("ctrl+c");
	assert.equal(editor.render(80).length, 2);
	await delay(550);
	assert.deepEqual(editor.render(80), ["editor"]);
	cleanup?.();
});
