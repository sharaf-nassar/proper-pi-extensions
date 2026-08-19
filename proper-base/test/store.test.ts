import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	appendPrompt,
	compactIfNeeded,
	encodeEntry,
	MAX_PROMPT_CHARS,
	projectKey,
	readPrompts,
	storePath,
} from "../src/store.ts";

function scratch(): string {
	return join(mkdtempSync(join(tmpdir(), "proper-history-")), "store.jsonl");
}

test("projectKey matches pi's session directory encoding", () => {
	assert.equal(projectKey("/home/mamba/work/cue"), "--home-mamba-work-cue--");
	assert.equal(projectKey("/home/mamba"), "--home-mamba--");
});

test("storePath keeps the store beside pi's other agent state", () => {
	assert.equal(
		storePath("/agent", "/home/mamba/work/cue"),
		"/agent/proper-history/--home-mamba-work-cue--.jsonl",
	);
});

test("appendPrompt round-trips through readPrompts in order", () => {
	const file = scratch();
	assert.equal(appendPrompt(file, "first", 1), true);
	assert.equal(appendPrompt(file, "second", 2), true);
	assert.deepEqual(readPrompts(file), [
		{ text: "first", ts: 1 },
		{ text: "second", ts: 2 },
	]);
});

test("appendPrompt trims and skips blank prompts", () => {
	const file = scratch();
	assert.equal(appendPrompt(file, "  spaced  ", 1), true);
	assert.equal(appendPrompt(file, "   ", 2), false);
	assert.equal(appendPrompt(file, "", 3), false);
	assert.deepEqual(readPrompts(file), [{ text: "spaced", ts: 1 }]);
});

test("appendPrompt skips prompts too long to append as one line", () => {
	// Truncating would hand back a command that looks complete but is not.
	const file = scratch();
	assert.equal(appendPrompt(file, "x".repeat(MAX_PROMPT_CHARS), 1), true);
	assert.equal(appendPrompt(file, "y".repeat(MAX_PROMPT_CHARS + 1), 2), false);
	assert.deepEqual(
		readPrompts(file).map((p) => p.text.length),
		[MAX_PROMPT_CHARS],
	);
});

test("appendPrompt preserves multiline prompts as one entry", () => {
	const file = scratch();
	appendPrompt(file, "line one\nline two", 1);
	assert.deepEqual(readPrompts(file), [{ text: "line one\nline two", ts: 1 }]);
	assert.equal(readFileSync(file, "utf8").trimEnd().split("\n").length, 1);
});

test("appendPrompt creates the store private to the user", () => {
	const file = scratch();
	appendPrompt(file, "secret-ish", 1);
	assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("appendPrompt reports failure instead of throwing", () => {
	// A directory where the file should be makes every write fail.
	const dir = mkdtempSync(join(tmpdir(), "proper-history-"));
	assert.equal(appendPrompt(join(dir), "prompt", 1), false);
});

test("readPrompts returns nothing for a missing or empty store", () => {
	assert.deepEqual(
		readPrompts(join(tmpdir(), "proper-history-absent.jsonl")),
		[],
	);
	const file = scratch();
	writeFileSync(file, "");
	assert.deepEqual(readPrompts(file), []);
});

test("readPrompts skips damaged lines instead of failing", () => {
	const file = scratch();
	writeFileSync(
		file,
		`${encodeEntry({ text: "good", ts: 1 })}not json\n{"t":42}\n{"t":""}\n${encodeEntry({ text: "also good", ts: 2 })}`,
	);
	assert.deepEqual(
		readPrompts(file).map((p) => p.text),
		["good", "also good"],
	);
});

test("readPrompts defaults a missing timestamp instead of dropping the prompt", () => {
	const file = scratch();
	writeFileSync(file, '{"t":"undated"}\n');
	assert.deepEqual(readPrompts(file), [{ text: "undated", ts: 0 }]);
});

test("readPrompts reads only the tail and drops the partial first line", () => {
	const file = scratch();
	for (let i = 0; i < 200; i++) appendPrompt(file, `prompt-${i}`, i);
	const size = statSync(file).size;
	const tail = readPrompts(file, Math.floor(size / 4));
	assert.ok(
		tail.length > 0 && tail.length < 200,
		`expected a partial read, got ${tail.length}`,
	);
	// Every surviving entry must be whole, and the newest must be present.
	assert.equal(tail.at(-1)?.text, "prompt-199");
	assert.ok(tail.every((p) => /^prompt-\d+$/.test(p.text)));
});

test("compactIfNeeded leaves a small store alone", () => {
	const file = scratch();
	appendPrompt(file, "keep me", 1);
	assert.equal(compactIfNeeded(file, 1024 * 1024, 10), false);
	assert.deepEqual(
		readPrompts(file).map((p) => p.text),
		["keep me"],
	);
});

test("compactIfNeeded trims an oversized store to the newest entries", () => {
	const file = scratch();
	for (let i = 0; i < 500; i++) appendPrompt(file, `prompt-${i}`, i);
	assert.equal(compactIfNeeded(file, 1, 10), true);
	const kept = readPrompts(file);
	assert.equal(kept.length, 10);
	assert.equal(kept[0]?.text, "prompt-490");
	assert.equal(kept.at(-1)?.text, "prompt-499");
});

test("compactIfNeeded is a no-op for a missing store", () => {
	assert.equal(
		compactIfNeeded(join(tmpdir(), "proper-history-absent.jsonl"), 1, 10),
		false,
	);
});

test("the store survives concurrent appends from several sessions", () => {
	// Multiple pi sessions in one project append to the same file.
	const file = scratch();
	const writers = 8;
	const each = 40;
	for (let round = 0; round < each; round++) {
		for (let writer = 0; writer < writers; writer++) {
			appendPrompt(file, `w${writer}-r${round}`, round);
		}
	}
	const prompts = readPrompts(file, Number.MAX_SAFE_INTEGER);
	assert.equal(prompts.length, writers * each);
	assert.equal(new Set(prompts.map((p) => p.text)).size, writers * each);
});
