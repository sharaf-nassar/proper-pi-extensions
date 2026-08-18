import assert from "node:assert/strict";
import { test } from "node:test";

import properBase from "../index.ts";

function toolResultHandler() {
	let handler: ((event: any, ctx: any) => unknown) | undefined;
	properBase({
		on(event: string, fn: typeof handler) {
			if (event === "tool_result") handler = fn;
		},
	} as any);
	assert.ok(handler, "tool_result handler was not registered");
	return handler;
}

function abortsOn(event: unknown): boolean {
	let aborted = false;
	toolResultHandler()(event, {
		abort() {
			aborted = true;
		},
	});
	return aborted;
}

test("declining the questionnaire aborts the turn", () => {
	assert.equal(
		abortsOn({
			toolName: "ask_user_question",
			details: { answers: [], cancelled: true },
		}),
		true,
	);
});

test("answered, failed, and unrelated tool results run on", () => {
	assert.equal(
		abortsOn({
			toolName: "ask_user_question",
			details: { answers: [{ questionIndex: 0 }], cancelled: false },
		}),
		false,
	);
	assert.equal(
		abortsOn({
			toolName: "ask_user_question",
			details: { answers: [], cancelled: true, error: "no_custom_ui" },
		}),
		false,
	);
	assert.equal(
		abortsOn({ toolName: "ask_user_question", details: undefined }),
		false,
	);
	assert.equal(
		abortsOn({ toolName: "bash", details: { cancelled: true } }),
		false,
	);
});
