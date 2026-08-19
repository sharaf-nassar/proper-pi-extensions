import assert from "node:assert/strict";
import { test } from "node:test";

import { installHistoryGuard } from "../src/history-guard.ts";

test("history guard skips editors without history support", () => {
	assert.equal(installHistoryGuard({}), undefined);
});

test("history accepts only prompts recorded by the editor submit path", () => {
	const history: string[] = [];
	const editor = {
		addToHistory(text: string) {
			history.push(text);
		},
	};
	const trusted = installHistoryGuard(editor);
	assert.equal(installHistoryGuard(editor), trusted);
	trusted?.add("   ");

	editor.addToHistory('<skill name="unslop">expanded body</skill>');
	editor.addToHistory("expanded prompt template body");
	trusted?.add("/skill:unslop clean this up");

	assert.deepEqual(history, ["/skill:unslop clean this up"]);
});
