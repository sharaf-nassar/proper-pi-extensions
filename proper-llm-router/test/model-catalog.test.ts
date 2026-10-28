import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { commandPin, loadConfig, resolveArm, route } from "../llm-router.ts";

const catalog = {
	"claude-haiku-5-5": "claude-haiku-5-5",
	"claude-sonnet-5-5": "claude-sonnet-5-5",
	"claude-opus-5-5": "claude-opus-5-5",
	"claude-fable-5-1": "claude-fable-5-1",
	"gpt-6-luna": "gpt-6-luna",
	"gpt-6-1-terra": "gpt-6.1-terra",
	"gpt-6-1-sol": "gpt-6.1-sol",
	"gpt-6-astra": "gpt-6-astra",
};
const cfg = {
	...loadConfig("/__proper-llm-router-missing-config__.json"),
	quotaMaxPct: null,
};

// @lat: [[lat.md/proper-llm-router/tests#Current model catalog]]
test("current catalog routes every arm through direct providers and CPA", async () => {
	for (const provider of ["direct", "cliproxyapi"]) {
		const models = Object.values(catalog).map((id) => ({
			id,
			provider:
				provider === "direct"
					? id.startsWith("claude")
						? "anthropic"
						: "openai"
					: provider,
		}));
		for (const [arm, id] of Object.entries(catalog)) {
			const verdict = await route(
				cfg,
				"Interpret the supplied technical drawing",
				undefined,
				{
					models,
					judge: async (instructions, _task, menu) => {
						assert.deepEqual(menu, Object.keys(catalog));
						for (const key of menu) assert.ok(instructions.includes(key));
						assert.match(
							instructions,
							/Terra has no measured exemplar outcomes/,
						);
						return { model: arm, rationale: "catalog fixture" };
					},
				},
			);
			assert.equal(verdict.arm, arm);
			assert.equal(verdict.model, id);
			assert.equal(verdict.provider, models.find((m) => m.id === id)?.provider);
			assert.equal(verdict.swapped_from, undefined);
			assert.equal(verdict.arms_unavailable, undefined);
		}
	}
});

test("Terra supports pins, overrides, and a missing-model swap", async () => {
	assert.deepEqual(
		commandPin(
			{
				...cfg,
				commandPins: { draw: { model: "gpt-6.1-terra", effort: null } },
			},
			"/draw interpret this diagram",
		),
		{ arm: "gpt-6-1-terra", effort: null },
	);
	const terra = { provider: "openai-codex", id: "gpt-6.1-terra" };
	const overridden = await route(
		{ ...cfg, judgeModelOverrides: { Terra: "openai-codex/gpt-6.1-terra" } },
		"Revise the supplied paragraph",
		undefined,
		{
			models: [terra],
			judge: async (instructions) => {
				assert.match(
					instructions,
					/openai-codex\/gpt-6\.1-terra \[selection key: gpt-6-1-terra\]/,
				);
				return { model: "gpt-6-1-terra", rationale: "writing" };
			},
		},
	);
	assert.equal(overridden.provider, terra.provider);
	assert.equal(overridden.model, terra.id);
	assert.equal(overridden.overridden_from, "gpt-6-1-terra");

	const swapped = await route(cfg, "Interpret this drawing", undefined, {
		models: [{ provider: "anthropic", id: "claude-sonnet-5-5" }],
		judge: async () => ({ model: "gpt-6-1-terra", rationale: "visual task" }),
	});
	assert.equal(swapped.model, "claude-sonnet-5-5");
	assert.equal(swapped.swapped_from, "gpt-6-1-terra");
	// Saved GPT-5.6 Terra pins retain their existing successor.
	assert.equal(resolveArm("gpt-5.6-terra"), "gpt-6-1-sol");
});

test("bundled measurements contain only current arms and no invented Terra rates", () => {
	const rows = readFileSync(
		new URL("../exemplars.jsonl", import.meta.url),
		"utf8",
	)
		.trim()
		.split("\n");
	for (const line of rows) {
		const row = JSON.parse(line);
		for (const arm of Object.keys(row.rates)) assert.ok(arm in catalog, arm);
		assert.equal(row.rates["gpt-6-1-terra"], undefined);
	}
});
