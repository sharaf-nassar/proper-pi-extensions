import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	ExtensionRunner,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
	buildSystemPrompt,
	normalizeBuildSystemPromptOptions,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
import {
	applyProactiveDelegation,
	PROACTIVE_DELEGATION_TEXT,
	readProactiveDelegationEnabled,
} from "../src/proactive-delegation.ts";
import { appendPromptSection } from "../src/prompt-sections.ts";

function options() {
	return normalizeBuildSystemPromptOptions({
		cwd: "/project",
		selectedTools: ["subagent"],
		toolGuidelines: {
			subagent: ["Use subagent only when delegation is needed."],
		},
		sections: {
			advertised_subagents:
				'Their descriptions indicate available specializations, not instructions to delegate. Use subagent only when delegation is needed. Before execution, call subagent with { action: "list", capabilities: true }.',
		},
	});
}

// @lat: [[lat.md/proper-base/tests#Verification#Proactive delegation fixture]]
test("rewrites policy fields without freezing later prompt composition", async () => {
	const handler = (event: any) =>
		applyProactiveDelegation(event.systemPromptOptions, true);
	const later = (event: any) => {
		event.systemPromptOptions.sections.later = "IMPORTANT_LATER_RULE";
		event.systemPromptOptions.selectedTools.push("read");
		appendPromptSection(
			event.systemPromptOptions,
			"proper_base_title",
			"TITLE_RULE",
		);
	};
	const runner = new ExtensionRunner(
		[
			{ path: "base", handlers: new Map([["before_agent_start", [handler]]]) },
			{ path: "later", handlers: new Map([["before_agent_start", [later]]]) },
		] as any,
		{} as any,
		"/project",
		SessionManager.inMemory(),
		{} as any,
	);
	const result = await runner.emitBeforeAgentStart(
		"task",
		undefined,
		options(),
	);
	const prompt = buildSystemPrompt(result.systemPromptOptions);
	assert.equal(result.systemPromptOptions.forceSystemPrompt, undefined);
	assert.match(prompt, /IMPORTANT_LATER_RULE/);
	assert.match(prompt, /TITLE_RULE/);
	assert.match(prompt, /Delegate to subagents proactively/);
	assert.match(prompt, /Before execution, call subagent/);
	assert.doesNotMatch(prompt, /only when delegation is needed/);
	assert.doesNotMatch(prompt, /not instructions to delegate/);
	assert.ok(prompt.includes(PROACTIVE_DELEGATION_TEXT));
});

test("scoped choices defer to advertised routing overrides without load-order detection", () => {
	const state = options();
	applyProactiveDelegation(state, true, [
		{ provider: "llm-router", id: "auto" },
		{ provider: "cliproxyapi", id: "gpt-6-astra" },
		{ provider: "cliproxyapi", id: "claude-opus-5" },
		{ provider: "cliproxyapi", id: "gpt-6-astra" },
	]);
	const text = state.sections.proper_base_delegation ?? "";
	assert.match(
		text,
		/include that override as well; model= alone does not pin a routed child/,
	);
	assert.deepEqual(
		text.split("\n").filter((line) => line.startsWith("- ")),
		["- cliproxyapi/gpt-6-astra", "- cliproxyapi/claude-opus-5"],
	);
	assert.doesNotMatch(text, /llm-router\/auto/);
});

test("a loader-only session rewrites the loader's ask-first tool line", () => {
	const snippet =
		"pi-subagents is installed. For authorized specialist, independent-review, or parallel work, call subagents_enable, then subagent. Authorization must come from the current request or applicable instructions; complexity alone is not authorization.";
	const state = normalizeBuildSystemPromptOptions({
		cwd: "/project",
		selectedTools: ["subagents_enable"],
		toolSnippets: { subagents_enable: snippet },
	});
	applyProactiveDelegation(state, true);
	const prompt = buildSystemPrompt(state);
	assert.match(
		prompt,
		/- subagents_enable: pi-subagents is installed\. To delegate, call subagents_enable, then subagent; see Multi-agent mode below\./,
	);
	assert.doesNotMatch(prompt, /not authorization/);
	assert.ok(prompt.includes(PROACTIVE_DELEGATION_TEXT));
});

test("no subagent tool is inert and repeated application is idempotent", () => {
	const state = options();
	const original = structuredClone(state);
	applyProactiveDelegation(state, false);
	assert.deepEqual(state, original);
	applyProactiveDelegation(state, true);
	const applied = structuredClone(state);
	applyProactiveDelegation(state, true);
	assert.deepEqual(state, applied);
});

test("prior opaque replacements remain explicit, without resurrecting excluded defaults", () => {
	const state = options();
	state.forceSystemPrompt =
		"Only this prompt. Use subagent only when delegation is needed.";
	applyProactiveDelegation(state, true);
	appendPromptSection(state, "proper_base_title", "TITLE_RULE");
	const prompt = buildSystemPrompt(state);
	assert.match(prompt, /^Only this prompt\./);
	assert.match(prompt, /TITLE_RULE/);
	assert.ok(prompt.includes(PROACTIVE_DELEGATION_TEXT));
	assert.doesNotMatch(prompt, /advertised_subagents/);
});

test("proper-base.json proactiveDelegation=false disables, else enabled", () => {
	const dir = mkdtempSync(join(tmpdir(), "proper-base-proactive-"));
	try {
		assert.equal(readProactiveDelegationEnabled(dir), true);
		writeFileSync(join(dir, "proper-base.json"), '{"sessionRail":true}');
		assert.equal(readProactiveDelegationEnabled(dir), true);
		writeFileSync(
			join(dir, "proper-base.json"),
			'{"proactiveDelegation":false}',
		);
		assert.equal(readProactiveDelegationEnabled(dir), false);
		writeFileSync(join(dir, "proper-base.json"), "not json");
		assert.equal(readProactiveDelegationEnabled(dir), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
