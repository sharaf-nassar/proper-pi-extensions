import assert from "node:assert/strict";
import { test } from "node:test";

import { type TUI, visibleWidth } from "@earendil-works/pi-tui";

import {
	findSmartSelectionRange,
	installSmartSelection,
} from "../src/smart-selection.ts";

function expectedRange(line: string, token: string) {
	const start = line.indexOf(token);
	return {
		start: visibleWidth(line.slice(0, start)),
		end: visibleWidth(line.slice(0, start + token.length)),
	};
}

// @lat: [[lat.md/proper-base/tests#Verification#Smart selection fixture]]
test("smart selection expands terminal tokens and leaves prose native", () => {
	const urlLine = "see (https://example.com/a?q=1).";
	const url = "https://example.com/a?q=1";
	assert.deepEqual(
		findSmartSelectionRange(urlLine, urlLine.indexOf("example")),
		expectedRange(urlLine, url),
	);
	const balancedUrl = "https://example.com/wiki/Function_(mathematics)";
	assert.deepEqual(
		findSmartSelectionRange(balancedUrl, balancedUrl.indexOf("Function")),
		expectedRange(balancedUrl, balancedUrl),
	);

	const pathLine = "open src/foo.test.ts:12:3 now";
	const path = "src/foo.test.ts:12:3";
	assert.deepEqual(
		findSmartSelectionRange(pathLine, pathLine.indexOf("foo")),
		expectedRange(pathLine, path),
	);

	for (const [line, token] of [
		["use --output=dist/file", "--output=dist/file"],
		["call ModelRegistry.getProvider", "ModelRegistry.getProvider"],
		['run "hello world" now', '"hello world"'],
		['run "hello \\"wide\\" world" now', '"hello \\"wide\\" world"'],
	] as const) {
		assert.deepEqual(
			findSmartSelectionRange(line, line.indexOf(token) + 1),
			expectedRange(line, token),
		);
	}

	assert.equal(findSmartSelectionRange("ordinary words", 3), undefined);
	assert.equal(findSmartSelectionRange("ratio 1/2", 7), undefined);
	assert.deepEqual(findSmartSelectionRange("\x1b[31msrc/foo.ts\x1b[0m", 5), {
		start: 0,
		end: 10,
	});
});

test("fullscreen selection keeps Pi's native fallback and restores it", () => {
	let nativeCalls = 0;
	const native = (_point: {
		row: number;
		col: number;
		scrollView?: unknown;
	}) => {
		nativeCalls++;
		return {
			start: { row: 0, col: 0 },
			end: { row: 0, col: 4, boundary: true },
		};
	};
	const host = {
		getSelectionSourceLine: () => "read src/index.ts now",
		getWordSelection: native,
	};
	const dispose = installSmartSelection(host as unknown as TUI);
	const smart = host.getWordSelection({ row: 0, col: 8, scrollView: {} });
	assert.deepEqual(smart, {
		start: { row: 0, col: 5, scrollView: {} },
		end: { row: 0, col: 17, scrollView: {}, boundary: true },
	});
	assert.equal(nativeCalls, 0);

	host.getWordSelection({ row: 0, col: 1 });
	assert.equal(nativeCalls, 1);
	dispose?.();
	host.getWordSelection({ row: 0, col: 1 });
	assert.equal(nativeCalls, 2);
});
