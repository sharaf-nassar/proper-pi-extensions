import assert from "node:assert/strict";
import { test } from "node:test";

import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { installJumpToBottom } from "../src/jump-to-bottom.ts";

function harness(editorLines: string[], footerLines: string[]) {
	let following = false;
	let scrolls = 0;
	const editor = {
		render: (_width: number) => editorLines,
		invalidate() {},
	};
	const footer = {
		render: (_width: number) => footerLines,
		invalidate() {},
	};
	const listeners = new Set<(data: string) => unknown>();
	const tui = {
		children: [editor, footer],
		terminal: { rows: 24 },
		get isFollowingOutput() {
			return following;
		},
		scrollToBottom() {
			scrolls++;
		},
		inputListeners: listeners,
		addInputListener(listener: (data: string) => unknown) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	// Pi's renderer owns the first listener and consumes every mouse event.
	const consumed: string[] = [];
	listeners.add((data: string) => {
		consumed.push(data);
		return { consume: true };
	});

	const dispose = installJumpToBottom(editor as never, tui as never);
	const send = (data: string) => {
		for (const listener of listeners) {
			if ((listener(data) as { consume?: boolean })?.consume) return true;
		}
		return false;
	};
	return {
		editor,
		consumed,
		dispose,
		send,
		scrollCount: () => scrolls,
		setFollowing: (value: boolean) => {
			following = value;
		},
	};
}

test("the button appears only while the viewport is scrolled up", () => {
	const app = harness(["> prompt"], ["footer"]);

	const scrolled = app.editor.render(40);
	assert.equal(scrolled.length, 2);
	assert.match(stripTerminalSequences(scrolled[0] ?? ""), /↓ jump to bottom/);
	assert.equal(stripTerminalSequences(scrolled[0] ?? "").length, 40);

	// Narrow terminals fall back to the arrow, then drop the button entirely.
	assert.equal(
		stripTerminalSequences(app.editor.render(8)[0] ?? ""),
		"     ↓  ",
	);
	assert.deepEqual(app.editor.render(3), ["> prompt"]);

	app.setFollowing(true);
	assert.deepEqual(app.editor.render(40), ["> prompt"]);
});

test("a click on the button scrolls to the bottom before the renderer sees it", () => {
	const app = harness(["> prompt"], ["footer"]);
	app.editor.render(40);

	// 24 rows, with one prompt row and one footer row below the button.
	const row = 24 - 1 - 2;
	const column = 40 - 1 - ("↓ jump to bottom".length + 2);
	assert.equal(app.send(`\x1b[<0;${column + 1};${row + 1}M`), true);
	assert.equal(app.send(`\x1b[<0;${column + 1};${row + 1}m`), true);
	assert.equal(app.scrollCount(), 1);
	assert.deepEqual(app.consumed, []);

	// A click one row below is the prompt, and stays with the renderer.
	assert.equal(app.send(`\x1b[<0;${column + 1};${row + 2}M`), true);
	assert.equal(app.scrollCount(), 1);
	assert.equal(app.consumed.length, 1);

	app.dispose?.();
	app.editor.render(40);
	assert.equal(app.send(`\x1b[<0;${column + 1};${row + 1}M`), true);
	assert.equal(app.scrollCount(), 1);
});
