import assert from "node:assert/strict";
import { test } from "node:test";

import {
	extractPrompts,
	isRecallable,
	livePromptTexts,
	mergePrompts,
	resolveBase,
	selectSessions,
	WRAPPED,
} from "../src/history.ts";

test("extractPrompts reads string content", () => {
	const entries = [
		{ type: "message", message: { role: "user", content: "hello" } },
	];
	assert.deepEqual(
		extractPrompts(entries).map((p) => p.text),
		["hello"],
	);
});

test("extractPrompts joins text parts the way pi does", () => {
	// pi's getUserMessageText joins text blocks with an empty separator.
	const entries = [
		{
			type: "message",
			message: {
				role: "user",
				content: [
					{ type: "text", text: "foo" },
					{ type: "image", data: "..." },
					{ type: "text", text: "bar" },
				],
			},
		},
	];
	assert.deepEqual(
		extractPrompts(entries).map((p) => p.text),
		["foobar"],
	);
});

test("extractPrompts keeps chronological order and ignores non-user entries", () => {
	const entries = [
		{ type: "message", message: { role: "user", content: "first" } },
		{ type: "message", message: { role: "assistant", content: "reply" } },
		{ type: "compaction" },
		{ type: "message", message: { role: "user", content: "second" } },
	];
	assert.deepEqual(
		extractPrompts(entries).map((p) => p.text),
		["first", "second"],
	);
});

test("extractPrompts trims and drops blank prompts", () => {
	const entries = [
		{ type: "message", message: { role: "user", content: "  spaced  " } },
		{ type: "message", message: { role: "user", content: "   " } },
		{ type: "message", message: { role: "user", content: "" } },
		{ type: "message", message: { role: "user", content: [] } },
	];
	assert.deepEqual(
		extractPrompts(entries).map((p) => p.text),
		["spaced"],
	);
});

test("extractPrompts unwraps skill blocks to the typed prompt", () => {
	const content =
		'<skill name="unslop" location="/skills/unslop/SKILL.md">\nbody\n</skill>\n\nclean this up';
	const entries = [{ type: "message", message: { role: "user", content } }];
	assert.deepEqual(
		extractPrompts(entries).map((p) => p.text),
		["clean this up"],
	);
});

test("extractPrompts drops skill blocks that carry no typed prompt", () => {
	const content =
		'<skill name="unslop" location="/skills/unslop/SKILL.md">\nbody\n</skill>';
	const entries = [{ type: "message", message: { role: "user", content } }];
	assert.deepEqual(
		extractPrompts(entries).map((p) => p.text),
		[],
	);
});

test("extractPrompts tolerates malformed entries", () => {
	const entries = [
		{ type: "message" },
		{ type: "message", message: { role: "user" } },
		{ type: "message", message: { role: "user", content: [{ type: "text" }] } },
		{ type: "message", message: { role: "user", content: "kept" } },
	];
	assert.deepEqual(
		extractPrompts(entries as never).map((p) => p.text),
		["kept"],
	);
});

test("selectSessions orders newest first", () => {
	const sessions = [
		{ path: "/s/old.jsonl", modified: new Date(1000) },
		{ path: "/s/new.jsonl", modified: new Date(3000) },
		{ path: "/s/mid.jsonl", modified: new Date(2000) },
	];
	assert.deepEqual(
		selectSessions(sessions).map((s) => s.path),
		["/s/new.jsonl", "/s/mid.jsonl", "/s/old.jsonl"],
	);
});

test("selectSessions excludes the live session file", () => {
	// pi seeds the current session's prompts itself; including it here would duplicate them.
	const sessions = [
		{ path: "/s/a.jsonl", modified: new Date(2000) },
		{ path: "/s/live.jsonl", modified: new Date(3000) },
	];
	assert.deepEqual(
		selectSessions(sessions, "/s/live.jsonl").map((s) => s.path),
		["/s/a.jsonl"],
	);
});

test("selectSessions handles an absent or unknown live session", () => {
	const sessions = [{ path: "/s/a.jsonl", modified: new Date(1) }];
	assert.equal(selectSessions(sessions, undefined).length, 1);
	assert.equal(selectSessions(sessions, "/s/other.jsonl").length, 1);
	assert.deepEqual(selectSessions([], "/s/live.jsonl"), []);
});

test("extractPrompts records entry timestamps", () => {
	const entries = [
		{
			type: "message",
			timestamp: "2026-08-14T20:00:00.000Z",
			message: { role: "user", content: "dated" },
		},
		{ type: "message", message: { role: "user", content: "undated" } },
	];
	assert.deepEqual(extractPrompts(entries), [
		{ text: "dated", ts: Date.parse("2026-08-14T20:00:00.000Z") },
		{ text: "undated", ts: 0 },
	]);
});

test("mergePrompts returns oldest first so Up yields the newest prompt", () => {
	const sessions = [
		{ text: "older", ts: 10 },
		{ text: "newer", ts: 30 },
	];
	const store = [{ text: "middle", ts: 20 }];
	assert.deepEqual(mergePrompts([sessions, store], 10), [
		"older",
		"middle",
		"newer",
	]);
});

test("mergePrompts interleaves sources by time rather than grouping them", () => {
	// The store and the session files overlap in time; grouping by source
	// would put every recorded prompt after every session prompt.
	const sessions = [
		{ text: "s1", ts: 1 },
		{ text: "s2", ts: 4 },
	];
	const store = [
		{ text: "r1", ts: 2 },
		{ text: "r2", ts: 3 },
	];
	assert.deepEqual(mergePrompts([sessions, store], 10), [
		"s1",
		"r1",
		"r2",
		"s2",
	]);
});

test("mergePrompts collapses a duplicate onto its most recent timestamp", () => {
	const sessions = [
		{ text: "dup", ts: 5 },
		{ text: "other", ts: 6 },
	];
	const store = [{ text: "dup", ts: 50 }];
	assert.deepEqual(mergePrompts([sessions, store], 10), ["other", "dup"]);
});

test("mergePrompts keeps the newest prompts when over the limit", () => {
	const source = [
		{ text: "a", ts: 1 },
		{ text: "b", ts: 2 },
		{ text: "c", ts: 3 },
	];
	assert.deepEqual(mergePrompts([source], 2), ["b", "c"]);
});

test("mergePrompts drops prompts pi seeds from the live session", () => {
	const source = [
		{ text: "live", ts: 2 },
		{ text: "past", ts: 1 },
	];
	assert.deepEqual(mergePrompts([source], 10, new Set(["live"])), ["past"]);
});

test("mergePrompts keeps same-timestamp prompts in the order seen", () => {
	const source = [
		{ text: "first", ts: 7 },
		{ text: "second", ts: 7 },
	];
	assert.deepEqual(mergePrompts([source], 10), ["first", "second"]);
});

test("mergePrompts handles empty and degenerate input", () => {
	assert.deepEqual(mergePrompts([], 10), []);
	assert.deepEqual(mergePrompts([[], []], 10), []);
	assert.deepEqual(mergePrompts([[{ text: "a", ts: 1 }]], 0), []);
});

test("livePromptTexts collects the live session's prompts for exclusion", () => {
	const entries = [
		{ type: "message", message: { role: "user", content: "one" } },
		{ type: "message", message: { role: "assistant", content: "reply" } },
		{ type: "message", message: { role: "user", content: "two" } },
	];
	assert.deepEqual([...livePromptTexts(entries)].sort(), ["one", "two"]);
});

test("resolveBase passes through an editor we have not wrapped", () => {
	const other = () => "other-editor";
	assert.equal(resolveBase(other), other);
	assert.equal(resolveBase(undefined), undefined);
});

test("resolveBase unwraps our own wrapper instead of stacking on it", () => {
	// Reload, resume, and fork all re-fire session_start; without this the
	// wrapper chain would grow and reseed the same prompts on every pass.
	const base = () => "base-editor";
	const wrapper = Object.assign(() => "wrapped", { [WRAPPED]: base });
	assert.equal(resolveBase(wrapper), base);
});

test("resolveBase reports no base when our wrapper had none", () => {
	const wrapper = Object.assign(() => "wrapped", { [WRAPPED]: null });
	assert.equal(resolveBase(wrapper), undefined);
});

test("resolveBase survives repeated wrapping cycles", () => {
	type Factory = (() => string) & { [WRAPPED]?: Factory | null };
	const base: Factory = () => "base-editor";
	let current: Factory | undefined = base;
	for (let i = 0; i < 5; i++) {
		const resolved = resolveBase(current);
		current = Object.assign(() => "wrapped", {
			[WRAPPED]: resolved ?? null,
		}) as Factory;
	}
	assert.equal(resolveBase(current), base);
});

test("UI commands are not recallable, prompt templates are", () => {
	const commands = [
		{ name: "file", source: "prompt" },
		{ name: "llm-router-config", source: "extension" },
		{ name: "skill:unslop", source: "skill" },
	];
	assert.equal(isRecallable("fix the login bug", commands), true);
	assert.equal(isRecallable("/file fix the login bug", commands), true);
	assert.equal(isRecallable("/skill:unslop", commands), true);
	assert.equal(
		isRecallable("/model cliproxyapi/claude-opus-5", commands),
		false,
	);
	assert.equal(isRecallable("/new", commands), false);
	assert.equal(isRecallable("/reload", commands), false);
	assert.equal(isRecallable("/llm-router-config", commands), false);
});
