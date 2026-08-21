import assert from "node:assert/strict";
import { test } from "node:test";

import {
	isRecallable,
	mergePrompts,
	resolveBase,
	WRAPPED,
} from "../src/history.ts";

test("mergePrompts returns oldest first so Up yields the newest prompt", () => {
	const prompts = [
		{ text: "older", ts: 10 },
		{ text: "newer", ts: 30 },
		{ text: "middle", ts: 20 },
	];
	assert.deepEqual(mergePrompts(prompts, 10), ["older", "middle", "newer"]);
});

test("mergePrompts collapses a duplicate onto its most recent timestamp", () => {
	const prompts = [
		{ text: "dup", ts: 5 },
		{ text: "other", ts: 6 },
		{ text: "dup", ts: 50 },
	];
	assert.deepEqual(mergePrompts(prompts, 10), ["other", "dup"]);
});

test("mergePrompts keeps the newest prompts when over the limit", () => {
	const source = [
		{ text: "a", ts: 1 },
		{ text: "b", ts: 2 },
		{ text: "c", ts: 3 },
	];
	assert.deepEqual(mergePrompts(source, 2), ["b", "c"]);
});

test("mergePrompts keeps same-timestamp prompts in the order seen", () => {
	const source = [
		{ text: "first", ts: 7 },
		{ text: "second", ts: 7 },
	];
	assert.deepEqual(mergePrompts(source, 10), ["first", "second"]);
});

test("mergePrompts handles empty and degenerate input", () => {
	assert.deepEqual(mergePrompts([], 10), []);
	assert.deepEqual(mergePrompts([{ text: "a", ts: 1 }], 0), []);
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
