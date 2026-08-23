import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("proper-flow shell suites", () => {
	const result = spawnSync("bash", ["proper-flow/test.sh"], {
		encoding: "utf8",
	});
	assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
