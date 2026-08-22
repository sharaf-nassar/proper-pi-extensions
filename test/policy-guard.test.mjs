import assert from "node:assert/strict";
import { test } from "node:test";

import {
	findPolicyViolations,
	isProtectedPolicyPath,
} from "../scripts/policy-guard.mjs";

test("policy analysis is unaffected by the commit override environment", () => {
	const previous = process.env.ALLOW_POLICY_CHANGES;
	try {
		process.env.ALLOW_POLICY_CHANGES = "1";
		assert.deepEqual(
			findPolicyViolations({
				changed: ["biome.json"],
				deleted: [],
				addedLines: [],
			}),
			["biome.json: validation policy changes require human approval"],
		);
	} finally {
		if (previous === undefined) delete process.env.ALLOW_POLICY_CHANGES;
		else process.env.ALLOW_POLICY_CHANGES = previous;
	}
});

test("policy guard blocks validation edits and suppression shortcuts", () => {
	assert.equal(isProtectedPolicyPath(".pre-commit-config.yaml"), true);
	assert.equal(isProtectedPolicyPath("proper-base/tsconfig.json"), true);
	assert.equal(isProtectedPolicyPath("proper-base/package-lock.json"), true);
	assert.equal(isProtectedPolicyPath("proper-base/package.json"), false);
	assert.equal(isProtectedPolicyPath("CLAUDE.md"), true);
	assert.equal(
		isProtectedPolicyPath(".github/workflows/publish-npm.yml"),
		true,
	);
	assert.equal(isProtectedPolicyPath(".release-me.json"), true);
	assert.equal(isProtectedPolicyPath("scripts/check-repo.mjs"), true);
	assert.equal(isProtectedPolicyPath("proper-base/src/history.ts"), false);

	assert.deepEqual(
		findPolicyViolations({
			changed: ["proper-base/src/history.ts"],
			deleted: [],
			addedLines: [
				{
					path: "proper-base/src/history.ts",
					line: "// @ts-expect-error hide the error",
				},
				{
					path: "proper-base/test/history.test.ts",
					line: "const fake = value as any;",
				},
				{
					path: "proper-base/test/history.test.ts",
					line: "test(name, { skip: true }, callback);",
				},
			],
		}),
		[
			"proper-base/src/history.ts: forbidden suppression: // @ts-expect-error hide the error",
			"proper-base/test/history.test.ts: forbidden suppression: const fake = value as any;",
			"proper-base/test/history.test.ts: forbidden suppression: test(name, { skip: true }, callback);",
		],
	);

	assert.deepEqual(
		findPolicyViolations({
			changed: ["proper-base/test/history.test.ts"],
			deleted: ["proper-base/test/store.test.ts"],
			addedLines: [],
		}),
		["proper-base/test/store.test.ts: deleting tests requires policy approval"],
	);
});
