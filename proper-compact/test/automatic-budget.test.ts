import assert from "node:assert/strict";
import { test } from "node:test";
import { checkpoint, fixture, model, response, usage } from "./fixture.ts";

for (const [contextWindow, sourceLength] of [
	[272000, 800000],
	[32768, 40000],
] as const) {
	for (const mode of ["compaction", "branch"] as const) {
		test(`automatic budgets cover ${mode} source in a ${contextWindow}-token session window`, async (t) => {
			const f = await fixture(t);
			const selected = { ...model, contextWindow };
			f.runner.getModel = () => selected;
			f.session.agent.state.model = selected;
			const source = `${"x".repeat(sourceLength)}TRAILING_EVIDENCE`;
			f.populate(source);
			const evidence = "y".repeat(contextWindow === 272000 ? 4500 : 2000);
			f.complete(() => response(checkpoint(evidence)));
			const summary =
				mode === "compaction"
					? await f.session.compact("KEEP_FOCUS")
					: (
							await f.runner.emit({
								type: "session_before_tree",
								preparation: {
									targetId: "target",
									oldLeafId: f.manager.getLeafId(),
									commonAncestorId: null,
									entriesToSummarize: f.manager.getBranch(),
									userWantsSummary: true,
									customInstructions: "KEEP_FOCUS",
								},
								signal: new AbortController().signal,
							})
						)?.summary;
			assert.match(summary?.summary ?? "", /## Goal/);
			assert.ok(f.calls.length > 1 && f.calls.length <= 4);
			const chunks = f.calls.map(([, request, options]) => {
				const prompt = request.messages[1].content;
				assert.match(prompt, /KEEP_FOCUS/);
				assert.ok(options.maxTokens > 8192);
				return prompt
					.split("# Conversation\n")[1]
					.split("\n\n# Instructions\n")[0];
			});
			assert.ok(chunks.join("").includes(source));
			assert.ok(f.calls[1][1].messages[1].content.includes(evidence));
			assert.equal(
				summary.usage.totalTokens,
				usage.totalTokens * f.calls.length,
			);
			assert.equal(f.fallbacks(), 0);
			assert.deepEqual(f.errors, []);
			assert.equal(selected.maxTokens, model.maxTokens);
		});
	}
}

test("automatic output allowance does not enlarge the retained checkpoint limit", async (t) => {
	const f = await fixture(t);
	f.populate();
	f.complete(() => response(checkpoint("x".repeat(5000))));
	const result = await f.session.compact();
	assert.equal(result.summary, "STOCK FALLBACK");
	assert.equal(f.fallbacks(), 1);
	assert.ok(f.notices.some((notice) => notice.includes("over budget")));
	assert.equal(f.calls[0][2].maxTokens, model.maxTokens);
});

test("reasoning output does not consume the retained checkpoint byte allowance", async (t) => {
	const f = await fixture(t);
	f.populate();
	f.complete(() => {
		const result = response();
		result.content.unshift({
			type: "thinking",
			thinking: "PRIVATE_REASONING".repeat(4000),
		});
		return result;
	});
	const result = await f.session.compact();
	assert.match(result.summary, /## Goal/);
	assert.doesNotMatch(result.summary, /PRIVATE_REASONING/);
	assert.equal(f.fallbacks(), 0);
	assert.equal(f.calls[0][2].maxTokens, model.maxTokens);
});
