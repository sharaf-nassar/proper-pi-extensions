import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ExemplarIndex, exemplarNote, loadConfig } from "../llm-router.ts";

const row = (prompt: string, rates: Record<string, number>) =>
	JSON.stringify({ task_id: prompt.slice(0, 12), prompt, rates });

const CORPUS = [
	row("refactor the widget renderer to cache layout computation results", {
		"claude-sonnet-5": 1,
	}),
	row("write a standalone quicksort implementation with unit tests", {
		"gpt-5-6-terra": 0.5,
	}),
	row("investigate flaky websocket reconnect backoff timing", {
		"claude-opus-5": 0,
	}),
].join("\n");

async function withoutExemplarEnv(run: () => Promise<void>): Promise<void> {
	const previous = process.env.JUDGE_EXEMPLARS;
	delete process.env.JUDGE_EXEMPLARS;
	try {
		await run();
	} finally {
		if (previous !== undefined) process.env.JUDGE_EXEMPLARS = previous;
	}
}

// @lat: [[lat.md/proper-llm-router/tests#Exemplar fixtures]]
test("top() ranks overlapping rows and filters unrelated and identical ones", () => {
	const index = new ExemplarIndex(CORPUS);

	const hits = index.top("cache the widget layout computation results");
	assert.equal(hits.length, 1);
	assert.match(hits[0]?.prompt ?? "", /widget renderer/);

	// an exact corpus prompt is its own answer key (cosine 1 > 0.95)
	assert.deepEqual(
		index.top(
			"refactor the widget renderer to cache layout computation results",
		),
		[],
	);

	// no shared vocabulary scores below the 0.05 floor
	assert.deepEqual(index.top("completely disjoint cooking pasta sauce"), []);
});

test("exemplarNote reloads when exemplarsPath changes", async () => {
	await withoutExemplarEnv(async () => {
		const dir = await mkdtemp(join(tmpdir(), "llm-router-exemplars-"));
		try {
			const a = join(dir, "a.jsonl");
			const b = join(dir, "b.jsonl");
			await writeFile(a, CORPUS);
			await writeFile(
				b,
				row(
					"tune the garbage collector pause budget for the streaming service",
					{ "claude-opus-5": 1 },
				),
			);
			const base = loadConfig(join(dir, "missing.json"));

			const noteA = exemplarNote(
				{ ...base, exemplarsPath: a },
				"cache the widget layout computation results",
			);
			assert.match(noteA, /widget renderer/);
			assert.match(noteA, /claude-sonnet-5 PASS/);

			// the index must follow the configured path without a restart
			const noteB = exemplarNote(
				{ ...base, exemplarsPath: b },
				"tune the garbage collector pause budget carefully",
			);
			assert.doesNotMatch(noteB, /widget/);
			assert.match(noteB, /garbage collector/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

test("exemplar similarity reads the same task slice as the judge", async () => {
	await withoutExemplarEnv(async () => {
		const dir = await mkdtemp(join(tmpdir(), "llm-router-exemplar-slice-"));
		try {
			const corpus = join(dir, "corpus.jsonl");
			await writeFile(corpus, CORPUS);
			const cfg = {
				...loadConfig(join(dir, "missing.json")),
				exemplarsPath: corpus,
			};
			const tail = "cache the widget layout computation results";

			assert.match(exemplarNote(cfg, tail), /widget renderer/);
			// the same evidence past the judge's 4,000-character window is unread
			assert.equal(exemplarNote(cfg, `${"x".repeat(4000)} ${tail}`), "");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
