import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import * as host from "@earendil-works/pi-coding-agent";

// @lat: [[proper-model-prompts/tests#Bundled loading]]
test("the distributed file loads with only Pi's public virtual package root", async () => {
	const require = createRequire(
		import.meta.resolve("@earendil-works/pi-coding-agent"),
	);
	const manifestPath = require.resolve("jiti/package.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const { createJiti } = await import(
		join(dirname(manifestPath), manifest.exports["./static"].import)
	);
	const jiti = createJiti(import.meta.url, {
		moduleCache: false,
		tryNative: false,
		virtualModules: { "@earendil-works/pi-coding-agent": host },
	});
	const directory = await mkdtemp(join(tmpdir(), "proper-model-prompts-"));
	try {
		const entry = join(directory, "model-prompts.ts");
		for (const name of ["model-prompts.ts", "defaults.ts"])
			await copyFile(
				new URL(`../${name}`, import.meta.url),
				join(directory, name),
			);
		const extension = await jiti.import(entry, { default: true });
		const events: string[] = [];
		const registered: string[] = [];
		extension(
			{
				on: (event: string) => events.push(event),
				registerTool: (tool: { name: string }) => registered.push(tool.name),
				registerCommand: (name: string) => registered.push(name),
			},
			join(directory, "unused.json"),
		);
		assert.deepEqual(events.sort(), ["before_agent_start", "session_start"]);
		assert.deepEqual(registered, []);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
