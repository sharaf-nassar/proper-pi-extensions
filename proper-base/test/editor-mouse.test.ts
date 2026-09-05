import assert from "node:assert/strict";
import { test } from "node:test";

import { Editor } from "@earendil-works/pi-tui";

import { installEditorMouseGuard } from "../src/editor-mouse.ts";

function editorWithText(text: string) {
	const tui = {
		terminal: { rows: 24 },
		requestRender() {},
		children: [] as unknown[],
	};
	const editor = new Editor(
		tui as never,
		{ borderColor: (value: string) => value, selectList: {} } as never,
	);
	tui.children.push(editor);
	editor.setText(text);
	// Pi records the visible row count during render; mouse rows are
	// resolved against it.
	editor.render(40);
	return editor;
}

function click(editor: Editor, x: number, y: number) {
	return editor.handleMouse({
		type: "click",
		button: "left",
		x,
		y,
		screenX: x,
		screenY: y,
		width: 40,
		height: 3,
		shift: false,
		alt: false,
		ctrl: false,
		clickCount: 1,
	});
}

// @lat: [[lat.md/proper-base/tests#Verification#Prompt mouse fixture]]
test("the guard leaves the cursor alone while disabled and restores clicks when enabled", () => {
	const editor = editorWithText("hello world");
	let enabled = false;
	const dispose = installEditorMouseGuard(editor, () => enabled);
	assert.ok(dispose);
	const cursorAtEnd = editor.getCursor();

	// Row 1 is the prompt's first text row; a disabled click is reported
	// handled, so the renderer starts no selection, yet the cursor stays.
	assert.deepEqual(click(editor, 2, 1), { handled: true });
	assert.deepEqual(editor.getCursor(), cursorAtEnd);

	// Border rows and rows past the text keep Pi's own focus behavior.
	assert.deepEqual(click(editor, 2, 0), { handled: true, focus: true });
	assert.deepEqual(editor.getCursor(), cursorAtEnd);

	// Press, drag, and release stay unhandled so drag-to-select still works.
	assert.equal(
		editor.handleMouse({
			type: "press",
			button: "left",
			x: 2,
			y: 1,
			screenX: 2,
			screenY: 1,
			width: 40,
			height: 3,
			shift: false,
			alt: false,
			ctrl: false,
		}),
		undefined,
	);

	// Re-enabling hands the same click back to Pi, which moves the cursor.
	enabled = true;
	assert.deepEqual(click(editor, 2, 1), { handled: true, focus: true });
	assert.notDeepEqual(editor.getCursor(), cursorAtEnd);
	assert.equal(editor.getCursor().col, 2);

	// Disposal restores the prototype method; a stale disposer is a no-op.
	dispose();
	assert.equal(Object.hasOwn(editor, "handleMouse"), false);
	enabled = false;
	assert.deepEqual(click(editor, 5, 1), { handled: true, focus: true });
	assert.equal(editor.getCursor().col, 5);
	dispose();
	assert.equal(Object.hasOwn(editor, "handleMouse"), false);
});

test("the guard installs once per editor and skips editors without mouse support", () => {
	const editor = editorWithText("abc");
	const first = installEditorMouseGuard(editor, () => false);
	const second = installEditorMouseGuard(editor, () => false);
	assert.ok(first && second);
	// The second install took over; the first disposer no longer matches.
	first();
	assert.equal(Object.hasOwn(editor, "handleMouse"), true);
	second();
	assert.equal(Object.hasOwn(editor, "handleMouse"), false);

	const legacy = { render: () => [], invalidate() {} };
	assert.equal(
		installEditorMouseGuard(legacy as never, () => false),
		undefined,
	);
});
