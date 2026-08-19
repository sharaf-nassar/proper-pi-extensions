import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { agentDir, seedWorkerContext } from "../install.mjs";

function scratch(settings?: string): string {
	const dir = mkdtempSync(join(tmpdir(), "proper-base-settings-"));
	if (settings !== undefined) {
		writeFileSync(join(dir, "settings.json"), settings, "utf-8");
	}
	return dir;
}

function read(dir: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(dir, "settings.json"), "utf-8"));
}

test("seedWorkerContext adds the override and keeps existing settings", () => {
	const dir = scratch('{"theme":"dark","packages":["npm:pi-subagents"]}');
	assert.equal(seedWorkerContext(dir), true);
	assert.deepEqual(read(dir), {
		theme: "dark",
		packages: ["npm:pi-subagents"],
		subagents: { agentOverrides: { worker: { defaultContext: "fresh" } } },
	});
});

test("seedWorkerContext keeps sibling subagents and agentOverrides keys", () => {
	const dir = scratch(
		'{"subagents":{"defaultModel":"x","agentOverrides":{"reviewer":{"disabled":true}}}}',
	);
	assert.equal(seedWorkerContext(dir), true);
	assert.deepEqual(read(dir).subagents, {
		defaultModel: "x",
		agentOverrides: {
			reviewer: { disabled: true },
			worker: { defaultContext: "fresh" },
		},
	});
});

test("seedWorkerContext never overwrites a configured worker", () => {
	const configured =
		'{"subagents":{"agentOverrides":{"worker":{"defaultContext":"fork"}}}}';
	const dir = scratch(configured);
	assert.equal(seedWorkerContext(dir), false);
	assert.equal(readFileSync(join(dir, "settings.json"), "utf-8"), configured);
});

test("seedWorkerContext is a no-op on a second run", () => {
	const dir = scratch("{}");
	assert.equal(seedWorkerContext(dir), true);
	assert.equal(seedWorkerContext(dir), false);
});

test("seedWorkerContext leaves missing or unreadable settings alone", () => {
	assert.equal(seedWorkerContext(scratch()), false);
	const broken = scratch("{ not json");
	assert.equal(seedWorkerContext(broken), false);
	assert.equal(
		readFileSync(join(broken, "settings.json"), "utf-8"),
		"{ not json",
	);
});

test("agentDir follows PI_CODING_AGENT_DIR, else ~/.pi/agent", () => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = "/custom/agent";
		assert.equal(agentDir(), "/custom/agent");
		process.env.PI_CODING_AGENT_DIR = "~/nested/agent";
		assert.equal(agentDir(), join(homedir(), "nested/agent"));
		delete process.env.PI_CODING_AGENT_DIR;
		assert.equal(agentDir(), join(homedir(), ".pi", "agent"));
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});
