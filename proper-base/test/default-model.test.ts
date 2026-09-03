import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	persistDefaultModel,
	stickyModelEnabled,
} from "../src/default-model.ts";

function harness(options: { settings?: unknown; config?: unknown } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "default-model-"));
	const settingsPath = join(dir, "settings.json");
	const configPath = join(dir, "proper-base.json");
	if (options.settings !== undefined) {
		writeFileSync(
			settingsPath,
			typeof options.settings === "string"
				? options.settings
				: `${JSON.stringify(options.settings, null, 2)}\n`,
		);
	}
	if (options.config !== undefined) {
		writeFileSync(configPath, `${JSON.stringify(options.config)}\n`);
	}
	return { dir, settingsPath, configPath };
}

// @lat: [[lat.md/proper-base/tests#Verification#Sticky model fixture]]
test("a model selection becomes Pi's startup default", () => {
	const { dir, settingsPath } = harness({
		settings: {
			theme: "dark",
			defaultProvider: "cliproxyapi",
			defaultModel: "gpt-5.6-sol",
			defaultThinkingLevel: "xhigh",
		},
	});

	assert.equal(
		persistDefaultModel(dir, { provider: "cliproxyapi", id: "claude-opus-5" }),
		true,
	);

	const written = readFileSync(settingsPath, "utf8");
	assert.deepEqual(JSON.parse(written), {
		theme: "dark",
		defaultProvider: "cliproxyapi",
		defaultModel: "claude-opus-5",
		defaultThinkingLevel: "xhigh",
	});
	// Pi's own format, so a later Pi write produces no unrelated diff.
	assert.match(written, /^\{\n {2}"theme": "dark",\n/);
	assert.ok(written.endsWith("}\n"));
});

test("a model with no saved default gains both keys", () => {
	const { dir, settingsPath } = harness({ settings: { theme: "dark" } });

	assert.equal(
		persistDefaultModel(dir, { provider: "anthropic", id: "claude-opus-4-8" }),
		true,
	);
	assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), {
		theme: "dark",
		defaultProvider: "anthropic",
		defaultModel: "claude-opus-4-8",
	});
});

test("an unchanged selection rewrites nothing", () => {
	const { dir, settingsPath } = harness({
		settings: {
			defaultProvider: "cliproxyapi",
			defaultModel: "claude-opus-5",
		},
	});
	const before = readFileSync(settingsPath, "utf8");

	assert.equal(
		persistDefaultModel(dir, { provider: "cliproxyapi", id: "claude-opus-5" }),
		false,
	);
	assert.equal(readFileSync(settingsPath, "utf8"), before);
});

test("the routing placeholder never becomes the startup default", () => {
	const { dir, settingsPath } = harness({
		settings: {
			defaultProvider: "cliproxyapi",
			defaultModel: "claude-opus-5",
		},
	});
	const before = readFileSync(settingsPath, "utf8");

	assert.equal(
		persistDefaultModel(dir, { provider: "llm-router", id: "auto" }),
		false,
	);
	assert.equal(readFileSync(settingsPath, "utf8"), before);
});

test("the sticky default can be turned off", () => {
	const { dir, settingsPath } = harness({
		settings: { defaultModel: "gpt-5.6-sol" },
		config: { sessionRail: false, stickyModel: false },
	});
	const before = readFileSync(settingsPath, "utf8");

	assert.equal(stickyModelEnabled(dir), false);
	assert.equal(
		persistDefaultModel(dir, { provider: "cliproxyapi", id: "claude-opus-5" }),
		false,
	);
	assert.equal(readFileSync(settingsPath, "utf8"), before);
});

test("a missing or damaged config reads as enabled", () => {
	const { dir: missing } = harness();
	assert.equal(stickyModelEnabled(missing), true);

	const { dir: damaged } = harness({ config: undefined });
	writeFileSync(join(damaged, "proper-base.json"), "{ not json");
	assert.equal(stickyModelEnabled(damaged), true);
});

test("a missing or damaged settings file is never replaced", () => {
	const { dir: missing, settingsPath: missingPath } = harness();
	assert.equal(
		persistDefaultModel(missing, {
			provider: "cliproxyapi",
			id: "claude-opus-5",
		}),
		false,
	);
	assert.equal(existsSync(missingPath), false);

	const { dir: damaged, settingsPath: damagedPath } = harness({
		settings: "{ not json",
	});
	assert.equal(
		persistDefaultModel(damaged, {
			provider: "cliproxyapi",
			id: "claude-opus-5",
		}),
		false,
	);
	assert.equal(readFileSync(damagedPath, "utf8"), "{ not json");
});
