import assert from "node:assert/strict";
import { test } from "node:test";

import { omitPriorTurnImages } from "../src/image-context.ts";

// @lat: [[lat.md/proper-base/tests#Verification#Image context fixture]]
test("images leave model context after their original user turn", () => {
	const oldUser = {
		role: "user",
		content: [
			{ type: "text", text: "inspect this" },
			{ type: "image", data: "old-user-image" },
		],
	};
	const oldTool = {
		role: "toolResult",
		content: [
			{ type: "text", text: "Image Size: 100x100" },
			{ type: "image", data: "old-tool-image" },
		],
	};
	const currentUser = {
		role: "user",
		content: [{ type: "text", text: "next" }],
	};
	const currentTool = {
		role: "toolResult",
		content: [{ type: "image", data: "current-tool-image" }],
	};
	const messages = [oldUser, oldTool, currentUser, currentTool];

	const filtered = omitPriorTurnImages(messages);

	assert.notEqual(filtered, messages);
	assert.deepEqual(filtered[0]?.content, [
		{ type: "text", text: "inspect this" },
		{ type: "text", text: "[image omitted after its original user turn]" },
	]);
	assert.deepEqual(filtered[1]?.content, [
		{ type: "text", text: "Image Size: 100x100" },
		{ type: "text", text: "[image omitted after its original user turn]" },
	]);
	assert.equal(filtered[2], currentUser);
	assert.equal(filtered[3], currentTool);
	assert.equal(oldUser.content[1]?.type, "image");
	assert.equal(oldTool.content[1]?.type, "image");

	const currentTurn = [currentUser, currentTool];
	assert.equal(omitPriorTurnImages(currentTurn), currentTurn);
});
