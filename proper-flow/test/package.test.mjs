import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const expected = ["file.md", "implement-ready.md", "spec.md", "triage.md"];

test("package exposes the four workflow prompts", async () => {
	const manifest = JSON.parse(
		await readFile(new URL("package.json", root), "utf8"),
	);
	assert.deepEqual(manifest.pi.prompts, ["./prompts"]);

	const prompts = (await readdir(new URL("prompts/", root)))
		.filter((name) => name.endsWith(".md"))
		.sort();
	assert.deepEqual(prompts, expected);

	for (const name of prompts) {
		const source = await readFile(new URL(`prompts/${name}`, root), "utf8");
		assert.match(source, /^---\n[\s\S]*?^description: .+$/m, name);
		assert.match(source, /^argument-hint: .+$/m, name);
	}
});
