/**
 * Live smoke test for the self-contained extension routing logic.
 * Run: node --experimental-strip-types smoke.ts ["task text"]
 * Needs the CPA key env var set (see ~/.pi/agent/llm-router.json).
 */
import * as assert from "node:assert";
import {
	loadConfig,
	parseSentinel,
	quotaBlockedArms,
	resolveArm,
	resolveVerdictModel,
	route,
} from "./llm-router.ts";

const cfg = loadConfig();

// pure-logic check: quota gate at 80% — claude account at 85% general
// blocks all claude arms unless another claude account is under; codex
// account fine except sonnet-window... (fixture below)
const usages = [
	{ type: "claude" as const, general: 30, models: { "claude-opus-5": 92 } },
	{ type: "claude" as const, general: 85, models: {} },
	{ type: "codex" as const, general: 96, models: {} },
];
const blocked = quotaBlockedArms(usages, 80);
// averages: opus (92+85)/2=88.5 blocked; fable/sonnet/haiku (30+85)/2=57.5
// fine; every codex arm blocked: the only codex acct is at 96
assert.deepStrictEqual(
	[...blocked].sort(),
	["claude-opus-5", "gpt-5-6-luna", "gpt-5-6-sol", "gpt-5-6-terra"],
);
assert.strictEqual(quotaBlockedArms([], 80).size, 0); // no data: no blocking
// averaging, not any-account-under: keys at 100 and 80 -> 90, so an 85%
// threshold blocks the lane even though one key is under it
const twoKeys = [
	{ type: "claude" as const, general: 100, models: {} },
	{ type: "claude" as const, general: 80, models: {} },
];
assert.ok(quotaBlockedArms(twoKeys, 85).has("claude-fable-5"));
assert.ok(!quotaBlockedArms(twoKeys, 95).has("claude-fable-5")); // 90 < 95

// pure-logic check: post-verdict swap pairs (fable<->sol, opus<->terra,
// sonnet->luna, haiku<->luna); available pick stays; both dead throws
const availWith = (dead: string[]) =>
	Object.fromEntries(
		["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5", "claude-fable-5",
			"gpt-5-6-luna", "gpt-5-6-terra", "gpt-5-6-sol"].map((a) => [
			a, { available: !dead.includes(a), auths: null },
		]),
	);
assert.deepStrictEqual(resolveVerdictModel("claude-fable-5", availWith(["claude-fable-5"])),
	{ final: "gpt-5-6-sol", swapped: true });
assert.deepStrictEqual(resolveVerdictModel("gpt-5-6-terra", availWith(["gpt-5-6-terra"])),
	{ final: "claude-opus-5", swapped: true });
assert.deepStrictEqual(resolveVerdictModel("claude-sonnet-5", availWith(["claude-sonnet-5"])),
	{ final: "gpt-5-6-luna", swapped: true });
assert.deepStrictEqual(resolveVerdictModel("gpt-5-6-luna", availWith(["gpt-5-6-luna"])),
	{ final: "claude-haiku-4-5", swapped: true });
assert.deepStrictEqual(resolveVerdictModel("claude-opus-5", availWith([])),
	{ final: "claude-opus-5", swapped: false });
assert.throws(() => resolveVerdictModel("claude-fable-5", availWith(["claude-fable-5", "gpt-5-6-sol"])));

// pure-logic check: [[llm-router: <model>]] sentinel parse + arm resolution
assert.strictEqual(parseSentinel("no marker here"), null);
assert.deepStrictEqual(parseSentinel("Task: [[llm-router: gpt-5.6-sol]] optimize the parser"), {
	name: "gpt-5.6-sol",
	stripped: "Task: optimize the parser",
});
assert.deepStrictEqual(parseSentinel("[[ LLM-Router : Sol ]] fix it"), {
	name: "Sol",
	stripped: "fix it",
}); // case/space tolerant
assert.strictEqual(resolveArm("gpt-5.6-sol"), "gpt-5-6-sol"); // CPA id
assert.strictEqual(resolveArm("claude-opus-5"), "claude-opus-5"); // arm key
assert.strictEqual(resolveArm("Sol"), "gpt-5-6-sol"); // unique fragment
assert.strictEqual(resolveArm("haiku"), "claude-haiku-4-5");
assert.strictEqual(resolveArm("claude-haiku-4-5-20251001"), "claude-haiku-4-5"); // dated CPA id
assert.strictEqual(resolveArm("claude"), null); // ambiguous
assert.strictEqual(resolveArm("gpt-9"), null); // unknown

// live check: full route() against the configured judge + CPA quota probe
const task = process.argv[2] ?? "fix typo in README.md: 'teh' -> 'the'";
const v = await route(cfg, task);
assert.ok(v.model && v.cpa_model && v.rationale, JSON.stringify(v));
console.log(JSON.stringify(v, null, 2));
