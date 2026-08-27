import assert from "node:assert/strict";
import { test } from "node:test";

import type { TuiInputListener } from "@earendil-works/pi-tui";
import {
	installSelectionDismiss,
	isTypingInput,
} from "../src/selection-dismiss.ts";

// @lat: [[lat.md/proper-base/tests#Verification#Selection dismissal fixture]]

// ESC prefix is matched separately: biome bans control characters in
// regexes, and string literals carry it fine.
const SGR_MOUSE_TAIL = /^\[<\d+;\d+;\d+[Mm]$/;

function harness() {
	const listeners = new Set<TuiInputListener>();
	let renders = 0;
	let autoScrollStops = 0;
	const tui = {
		selectionAnchor: undefined as unknown,
		selectionFocus: undefined as unknown,
		selectionGranularity: "word",
		selectionInitialRange: undefined as unknown,
		selectionDragged: false,
		selectionPressActive: false,
		getSelectionBounds() {
			return this.selectionAnchor === undefined ||
				this.selectionFocus === undefined
				? undefined
				: { start: this.selectionAnchor, end: this.selectionFocus };
		},
		stopSelectionAutoScroll() {
			autoScrollStops++;
		},
		requestRender() {
			renders++;
		},
		addInputListener(listener: TuiInputListener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	// Pi's renderer registers its viewport listener first and consumes every
	// mouse gesture and viewport key before later listeners run.
	const consumed: string[] = [];
	listeners.add((data: string) => {
		const mouse = data.startsWith("\x1b") && SGR_MOUSE_TAIL.test(data.slice(1));
		if (mouse || data === "\x1b[5~" || data === "\x1b[6~") {
			consumed.push(data);
			return { consume: true };
		}
		return undefined;
	});
	const select = () => {
		tui.selectionAnchor = { row: 1, col: 2 };
		tui.selectionFocus = { row: 1, col: 9 };
		tui.selectionGranularity = "word";
		tui.selectionInitialRange = { start: tui.selectionAnchor };
		tui.selectionDragged = true;
	};
	const send = (data: string) => {
		for (const listener of listeners) {
			if (listener(data)?.consume) return true;
		}
		return false;
	};
	return {
		tui,
		listeners,
		consumed,
		select,
		send,
		renders: () => renders,
		autoScrollStops: () => autoScrollStops,
	};
}

test("typing input covers keys and pastes but not reports or releases", () => {
	for (const data of ["a", "é", "abc", "\r", "\x7f", "\x1b", "\x1b[A"]) {
		assert.equal(isTypingInput(data), true, JSON.stringify(data));
	}
	assert.equal(isTypingInput("\x1b[200~90:62:3F:A5\x1b[201~"), true);
	for (const data of ["", "\x1b[6;20;10t", "\x1b[97;1:3u", "\x1b[1;1:3A"]) {
		assert.equal(isTypingInput(data), false, JSON.stringify(data));
	}
});

test("a keystroke dismisses the selection without consuming the input", () => {
	const app = harness();
	const dispose = installSelectionDismiss(app.tui as never);
	assert.notEqual(dispose, undefined);

	app.select();
	assert.equal(app.send("a"), false);
	assert.equal(app.tui.selectionAnchor, undefined);
	assert.equal(app.tui.selectionFocus, undefined);
	assert.equal(app.tui.selectionGranularity, "character");
	assert.equal(app.tui.selectionInitialRange, undefined);
	assert.equal(app.tui.selectionDragged, false);
	assert.equal(app.autoScrollStops(), 1);
	assert.equal(app.renders(), 1);

	// Without a selection the listener stays silent instead of re-rendering.
	assert.equal(app.send("b"), false);
	assert.equal(app.renders(), 1);

	// A paste edits the prompt exactly as typing does.
	app.select();
	app.send("\x1b[200~hello\x1b[201~");
	assert.equal(app.tui.selectionAnchor, undefined);
});

test("mouse gestures, viewport keys, and reports keep the selection", () => {
	const app = harness();
	installSelectionDismiss(app.tui as never);
	app.select();

	// The renderer consumes its own gestures before the listener runs.
	assert.equal(app.send("\x1b[<0;5;6M"), true);
	assert.equal(app.send("\x1b[5~"), true);
	// Terminal responses flow past every listener without being keystrokes.
	assert.equal(app.send("\x1b[6;20;10t"), false);
	assert.equal(app.send("\x1b[97;1:3u"), false);
	assert.notEqual(app.tui.selectionAnchor, undefined);
	assert.equal(app.renders(), 0);

	// A drag in progress owns the selection it is building.
	app.tui.selectionPressActive = true;
	assert.equal(app.send("a"), false);
	assert.notEqual(app.tui.selectionAnchor, undefined);
});

test("renderers without the selection surface install nothing", () => {
	const listeners = new Set<TuiInputListener>();
	const bare = {
		addInputListener(listener: TuiInputListener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	assert.equal(installSelectionDismiss(bare as never), undefined);
	assert.equal(listeners.size, 0);
});

test("reinstallation takes over and a stale disposer is a no-op", () => {
	const app = harness();
	const first = installSelectionDismiss(app.tui as never);
	const second = installSelectionDismiss(app.tui as never);
	assert.notEqual(second, undefined);
	// The renderer listener plus exactly one dismissal listener.
	assert.equal(app.listeners.size, 2);

	// The reload order runs the old instance's disposer after the takeover.
	first?.();
	app.select();
	app.send("a");
	assert.equal(app.tui.selectionAnchor, undefined);

	second?.();
	assert.equal(app.listeners.size, 1);
	app.select();
	app.send("a");
	assert.notEqual(app.tui.selectionAnchor, undefined);
});
