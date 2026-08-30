import assert from "node:assert/strict";
import { test } from "node:test";

import {
	installWheelScrollLines,
	resolveWheelScrollLines,
} from "../src/wheel-scroll.ts";

// @lat: [[lat.md/proper-base/tests#Verification#Wheel scroll fixture]]

test("resolution defaults to the 3-line terminal convention", () => {
	assert.equal(resolveWheelScrollLines({}), 3);
	assert.equal(resolveWheelScrollLines({ PROPER_WHEEL_SCROLL_LINES: "5" }), 5);
	assert.equal(resolveWheelScrollLines({ PROPER_WHEEL_SCROLL_LINES: "1" }), 1);
});

test("invalid overrides fall back to the default", () => {
	for (const value of ["0", "-2", "abc", "", "  "]) {
		assert.equal(
			resolveWheelScrollLines({ PROPER_WHEEL_SCROLL_LINES: value }),
			3,
			JSON.stringify(value),
		);
	}
});

test("only a renderer exposing a numeric wheel step is patched", () => {
	const fullscreen = { wheelScrollLines: 1 };
	assert.equal(installWheelScrollLines(fullscreen, 3), true);
	assert.equal(fullscreen.wheelScrollLines, 3);

	// A fractional value floors rather than handing the renderer a float.
	assert.equal(installWheelScrollLines(fullscreen, 5.9), true);
	assert.equal(fullscreen.wheelScrollLines, 5);

	const regular = {};
	assert.equal(installWheelScrollLines(regular, 3), false);
	assert.equal("wheelScrollLines" in regular, false);
});
