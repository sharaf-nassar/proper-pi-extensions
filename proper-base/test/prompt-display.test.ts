import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createPromptDisplay,
	PROMPT_DISPLAY_ENTRY,
} from "../src/prompt-display.ts";

// @lat: [[lat.md/proper-base/tests#Verification#Prompt display fixture]]
test("prompt templates keep their raw slash command for display", () => {
	const display = createPromptDisplay();
	const commands = [
		{ name: "implement-ready", source: "prompt" },
		{ name: "session", source: "extension" },
	];
	const expanded = "Orchestrate parallel implementation\n\nfull template body";

	display.captureInput("plain prompt", commands);
	display.captureUser({ content: [{ type: "text", text: "plain prompt" }] });
	display.captureInput("/implement-ready epic-1 4", commands);
	display.captureUser({ content: [{ type: "text", text: expanded }] });

	assert.equal(display.transform("plain prompt"), "plain prompt");
	assert.equal(display.transform(expanded), "/implement-ready epic-1 4");
	assert.equal(
		display.transform(` ${expanded}\n`),
		"/implement-ready epic-1 4",
	);

	const records = display.drain();
	assert.equal(records.length, 1);
	assert.equal(records[0]?.raw, "/implement-ready epic-1 4");
	assert.ok(!JSON.stringify(records).includes("full template body"));
	assert.deepEqual(display.drain(), []);

	const restored = createPromptDisplay();
	restored.restore([
		{
			type: "custom",
			customType: PROMPT_DISPLAY_ENTRY,
			data: { prompts: records },
		},
	]);
	assert.equal(restored.transform(expanded), "/implement-ready epic-1 4");

	restored.clear();
	assert.equal(restored.transform(expanded), expanded);
});
