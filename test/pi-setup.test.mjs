import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const publicPackages = [
	"@router-for-me/pi-cliproxyapi-provider",
	"pi-mcp-adapter",
	"@vigolium/piolium",
	"pi-subagents",
	"pi-web-access",
	"@juicesharp/rpiv-ask-user-question",
	"@amaster.ai/pi-image-gen",
	"@dietrichgebert/ponytail",
	"@ff-labs/pi-fff",
	"pi-context-view",
	"proper-base",
	"proper-flow",
];

test("complete Pi setup covers public packages and explicit exclusions", async () => {
	const setup = await readFile(new URL("PI_SETUP.md", root), "utf8");
	const readme = await readFile(new URL("README.md", root), "utf8");

	for (const packageName of publicPackages) {
		assert.match(
			setup,
			new RegExp(`npm:${packageName.replaceAll("/", "\\/")}`),
		);
	}

	assert.match(setup, /ui-ux-pro-max-cli@latest/);
	assert.match(setup, /skills add cursor\/plugins/);
	assert.match(setup, /--skill unslop/);
	assert.match(setup, /proper-llm-router/);
	assert.match(setup, /proper-flow\/install\.sh/);
	assert.match(setup, /npm install --global lat\.md/);
	assert.match(setup, /npm install --global @beads\/bd/);
	assert.match(setup, /Do not install:[\s\S]*quill\.ts/);
	assert.match(setup, /Do not install:[\s\S]*scribe-ai-integration\.ts/);
	assert.match(readme, /\[Complete Pi setup\]\(\.\/PI_SETUP\.md\)/);
});
