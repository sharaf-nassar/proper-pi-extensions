import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const packages = ["proper-base", "proper-flow"];

test("npm release config matches publishable packages", async () => {
	const config = JSON.parse(
		await readFile(new URL(".release-me.json", root), "utf8"),
	);
	assert.equal(config.type, "npm");
	assert.equal(config.branch, "main");
	assert.deepEqual(Object.keys(config.packages).sort(), packages);

	for (const name of packages) {
		const manifestPath = config.packages[name];
		assert.equal(manifestPath, `${name}/package.json`);
		const manifest = JSON.parse(
			await readFile(new URL(manifestPath, root), "utf8"),
		);
		assert.equal(manifest.name, name);
		assert.notEqual(manifest.private, true);
		assert.equal(manifest.publishConfig?.access, "public");
	}
});

test("npm release workflow separates verification from OIDC publishing", async () => {
	const workflow = await readFile(
		new URL(".github/workflows/publish-npm.yml", root),
		"utf8",
	);

	for (const name of packages) {
		assert.match(workflow, new RegExp(`- "${name}-v\\*"`));
	}
	assert.match(workflow, /^permissions: \{\}$/m);
	assert.match(workflow, /^ {2}verify:\n[\s\S]*?^ {2}publish:/m);
	assert.match(workflow, /^ {2}publish:\n[\s\S]*?id-token: write/m);
	assert.doesNotMatch(
		workflow.match(/^ {2}verify:\n[\s\S]*?^ {2}publish:/m)?.[0] ?? "",
		/id-token: write/,
	);
	assert.match(workflow, /environment: npm-release/);
	assert.doesNotMatch(workflow, /registry-url:/);
	assert.match(workflow, /npm pack "\.\/\$PACKAGE_PATH"/);
	assert.match(workflow, /test -z "\$\(git status --porcelain\)"/);
	assert.match(workflow, /npm publish "\$PWD\/\$TARBALL" --access public/);
	assert.match(workflow, /gh release create "\$TAG_NAME"/);
	assert.match(workflow, /--notes-from-tag/);
	assert.match(workflow, /actions\/checkout@[0-9a-f]{40} # v7\.0\.1/);
	assert.match(workflow, /actions\/setup-node@[0-9a-f]{40} # v7\.0\.0/);
	assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40} # v7\.0\.1/);
	assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40} # v8\.0\.1/);
});
