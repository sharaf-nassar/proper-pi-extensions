import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const blockingProcessApi = /\b(?:exec|execFile|spawn|fork)Sync\b/;
const relativeImport = /(?:from\s*|import\s*\()\s*["'](\.[^"']+)["']/g;

async function extensionEntries() {
	const entries = [];
	for (const item of await readdir(root, { withFileTypes: true })) {
		if (!item.isDirectory()) continue;
		const manifest = join(root, item.name, "package.json");
		try {
			const pkg = JSON.parse(await readFile(manifest, "utf8"));
			for (const entry of pkg.pi?.extensions ?? []) {
				entries.push(resolve(dirname(manifest), entry));
			}
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	}
	return entries;
}

async function importedRuntimeFiles(entries) {
	const pending = [...entries];
	const seen = new Set();
	while (pending.length) {
		const file = pending.pop();
		if (!file || seen.has(file)) continue;
		seen.add(file);
		const source = await readFile(file, "utf8");
		for (const match of source.matchAll(relativeImport)) {
			const imported = resolve(dirname(file), match[1]);
			try {
				await access(imported);
				pending.push(imported);
			} catch {
				// Package imports and type-only declarations are outside this audit.
			}
		}
	}
	return seen;
}

// @lat: [[lat#Runtime responsiveness]]
test("runtime extensions never synchronously wait on child processes", async () => {
	const files = await importedRuntimeFiles(await extensionEntries());
	const findings = [];
	for (const file of files) {
		const source = await readFile(file, "utf8");
		if (blockingProcessApi.test(source)) findings.push(relative(root, file));
	}
	assert.deepEqual(findings, []);
});
