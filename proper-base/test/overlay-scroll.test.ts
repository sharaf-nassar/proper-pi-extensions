import assert from "node:assert/strict";
import { test } from "node:test";

import type { TuiInputListener } from "@earendil-works/pi-tui";
import { installOverlayScroll } from "../src/overlay-scroll.ts";

// @lat: [[lat.md/proper-base/tests#Verification#Overlay scroll fixture]]

function harness() {
	const listeners = new Set<TuiInputListener>();
	const calls: string[] = [];
	const tui = {
		overlayFocused: false,
		isOverlayFocused() {
			return this.overlayFocused;
		},
		getPrimaryScrollView() {
			return { viewportHeight: 20 };
		},
		scrollBy(lines: number) {
			calls.push(`by:${lines}`);
		},
		scrollToTop() {
			calls.push("top");
		},
		scrollToBottom() {
			calls.push("bottom");
		},
		addInputListener(listener: TuiInputListener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	// Pi's viewport listener runs first. Wheel reports are always consumed
	// (Pi 1.2.0 scrolls behind overlays itself); scroll keys are consumed
	// unless an overlay is focused, in which case it declines.
	listeners.add((data: string) => {
		const wheel = data.startsWith("\x1b[<64;");
		if (wheel || (!tui.overlayFocused && data === "\x1b[5~")) {
			calls.push("native");
			return { consume: true };
		}
		return undefined;
	});
	const send = (data: string) => {
		for (const listener of listeners) {
			if (listener(data)?.consume) return true;
		}
		return false;
	};
	return { tui, listeners, calls, send };
}

test("scroll keys reach the viewport only while an overlay is focused", () => {
	const app = harness();
	const dispose = installOverlayScroll(app.tui as never);
	assert.notEqual(dispose, undefined);

	// Without an overlay the renderer keeps ownership.
	assert.equal(app.send("\x1b[5~"), true);
	assert.deepEqual(app.calls, ["native"]);
	app.calls.length = 0;

	app.tui.overlayFocused = true;
	assert.equal(app.send("\x1b[<64;5;6M"), true); // wheel stays native
	assert.equal(app.send("\x1b[5~"), true); // pageUp default
	assert.equal(app.send("\x1b[6~"), true); // pageDown default
	assert.equal(app.send("\x1b[1;5H"), true); // ctrl+home
	assert.equal(app.send("\x1b[1;5F"), true); // ctrl+end
	assert.deepEqual(app.calls, ["native", "by:-16", "by:16", "top", "bottom"]);

	// Typing, plain Home/End and unrelated keys stay with the overlay.
	assert.equal(app.send("a"), false);
	assert.equal(app.send("\x1b[A"), false);
	assert.equal(app.send("\x1b[H"), false);
	assert.equal(app.calls.length, 5);

	dispose?.();
	assert.equal(app.listeners.size, 1);
});

test("a renderer without the scroll surface installs nothing", () => {
	assert.equal(
		installOverlayScroll({ addInputListener: () => () => {} } as never),
		undefined,
	);
});
