import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { DEFAULTS, loadConfig, resolveModel, saveConfig } from "../compact.ts";
import { serializeEntry, serializeMessages } from "../context.ts";
import { addTool, fixture, model, response, usage, user } from "./fixture.ts";

// @lat: [[proper-compact/tests#Failure and cancellation]]
test("a delivered response is accounted before a queued cancellation", async (t) => {
	const f = await fixture(t);
	f.populate();
	f.complete(() => {
		// Let Promise.race settle with the result, then abort before its caller resumes.
		queueMicrotask(() => queueMicrotask(() => f.session.abortCompaction()));
		return response();
	});
	await assert.rejects(f.session.compact(), /cancelled/i);
	const attempt: any = f.manager
		.getEntries()
		.find((entry) => entry.type === "custom");
	assert.equal(attempt.data.status, "cancelled");
	assert.deepEqual(attempt.data.usage, usage);
	assert.equal(f.fallbacks(), 0);
	assert.equal(
		f.manager.getEntries().some((entry) => entry.type === "compaction"),
		false,
	);
	assert.deepEqual(f.errors, []);
});

test("repeated session_start invalidates the previous generation without shutdown", async (t) => {
	const f = await fixture(t);
	f.populate();
	let started: () => void = () => {};
	let finish: (result: any) => void = () => {};
	const ready = new Promise<void>((resolve) => {
		started = resolve;
	});
	f.complete(
		() =>
			new Promise((resolve) => {
				finish = resolve;
				started();
			}),
	);
	const pending = f.session.compact();
	await ready;
	await f.runner.emit({ type: "session_start", reason: "resume" });
	finish(response());
	await assert.rejects(pending, /cancelled/i);
	assert.equal(
		f.manager
			.getEntries()
			.some((entry) => entry.type === "custom" || entry.type === "compaction"),
		false,
	);
	assert.equal(f.fallbacks(), 0);
	f.complete(() => response());
	assert.match((await f.session.compact()).summary, /## Goal/);
	assert.deepEqual(f.errors, []);
});

// @lat: [[proper-compact/tests#Evidence and chunking]]
test("native custom, branch, and compaction projections retain source IDs", async (t) => {
	const f = await fixture(t);
	f.populate();
	const custom = f.manager.appendCustomMessageEntry(
		"annotation",
		"PUBLIC_ANNOTATION",
		true,
		{ secret: "PRIVATE_METADATA" },
	);
	f.manager.branchWithSummary(custom, "Branch summary");
	f.manager.appendCompaction("Earlier checkpoint", custom, 10000);
	const entries = f.manager.getBranch();
	const projection = f.manager.buildSessionProjection();
	const serialized = serializeMessages(projection.messages, entries, "history");
	assert.deepEqual(
		serialized.split("\n").map((line) => JSON.parse(line).entryId),
		projection.entries
			.filter(({ messages }) =>
				messages.some((message) => message.role !== "system"),
			)
			.map(({ sourceEntry }) => sourceEntry.id),
	);
	for (const { sourceEntry, messages } of projection.entries) {
		if (messages.length)
			assert.equal(
				JSON.parse(serializeEntry(sourceEntry)).entryId,
				sourceEntry.id,
			);
	}
	assert.doesNotMatch(serialized, /PRIVATE_METADATA/);
});

test("native compaction preserves replacement provenance and omits edited-out messages", async (t) => {
	const f = await fixture(t);
	const sources = [
		[f.manager.appendMessage(user("OLD_USER")), "NEW_USER"],
		[f.manager.appendMessage(response("OLD_ASSISTANT")), "NEW_ASSISTANT"],
		[addTool(f.manager, "edited-tool", "OLD_TOOL"), "NEW_TOOL"],
		[
			f.manager.appendCustomMessageEntry("annotation", "OLD_CUSTOM", true),
			"NEW_CUSTOM",
		],
	] as const;
	const originals = sources.map(([id]) =>
		structuredClone(f.manager.getEntry(id)),
	);
	for (const [id, text] of sources) {
		f.manager.appendContextEdit(id, { content: "SUPERSEDED_REPLACEMENT" });
		f.manager.appendContextEdit(id, { content: text });
	}
	const omitted = f.manager.appendMessage(response("OMITTED_ATTEMPT"));
	f.manager.appendContextEdit(omitted, null);
	f.manager.appendMessage(user("Retained request. ".repeat(40)));
	await f.session.compact();
	const transcript = f.calls[0][1].messages[1].content
		.split("# Conversation\n")[1]
		.split("\n\n# Instructions\n")[0];
	assert.doesNotMatch(
		transcript,
		/OLD_|SUPERSEDED_REPLACEMENT|OMITTED_ATTEMPT/,
	);
	const records = transcript
		.split("\n")
		.map((line: string) => JSON.parse(line));
	for (const [id, text] of sources) {
		const record = records.find((candidate: any) => candidate.entryId === id);
		assert.ok(record, `Missing provenance for ${text}`);
		assert.ok(JSON.stringify(record.content).includes(text));
	}
	assert.deepEqual(
		sources.map(([id]) => f.manager.getEntry(id)),
		originals,
	);
	assert.deepEqual(f.errors, []);
});

test("indistinguishable projections expose candidate IDs rather than inventing provenance", async (t) => {
	const f = await fixture(t);
	const id = f.manager.appendCustomMessageEntry(
		"annotation",
		"Same text",
		true,
	);
	const first = f.manager.getEntry(id);
	assert.ok(first);
	const second = { ...first, id: "another-source", parentId: first.id };
	const messages = sessionEntryToContextMessages(second);
	const record = JSON.parse(
		serializeMessages(messages, [first, second], "history"),
	);
	assert.equal(record.entryId, undefined);
	assert.deepEqual(record.entryIds, [first.id, second.id]);
});

// @lat: [[proper-compact/tests#Provider routing]]
test("pending provider overflow requires an earlier clearing hook or a different model", async (t) => {
	for (const order of ["before", "after", "different-model"] as const) {
		await t.test(order, async (t) => {
			const f = await fixture(t);
			f.populate();
			let pending = true;
			const clear = () => {
				pending = false;
			};
			const hooks = f.handlers.get("session_before_compact");
			assert.ok(hooks);
			if (order === "before") hooks.unshift(clear);
			else hooks.push(clear);
			if (order === "different-model") {
				f.registry.getAvailable = () => [model, { ...model, id: "other" }];
				await saveConfig(f.configPath, {
					...DEFAULTS,
					model: `${model.provider}/other`,
				});
			}
			// Model the installed CPA wrapper's pending-key and clearing-hook contract.
			f.complete((selected) => {
				if (
					pending &&
					selected.provider === model.provider &&
					selected.id === model.id
				) {
					pending = false;
					return response("synthetic proactive overflow", "error");
				}
				return response();
			});
			const result = await f.session.compact();
			if (order === "after") {
				assert.equal(result.summary, "STOCK FALLBACK");
				assert.equal(f.fallbacks(), 1);
				assert.ok(
					f.notices.some((notice) => notice.includes("truncation applies")),
				);
			} else {
				assert.match(result.summary, /## Goal/);
				assert.equal(f.fallbacks(), 0);
			}
			assert.deepEqual(f.errors, []);
		});
	}
});

// @lat: [[proper-compact/tests#Configuration and validation]]
test("configuration command validates updates and model selection respects scope", async (t) => {
	const f = await fixture(t);
	const ctx = f.runner.createContext();
	const command = f.commands.get("compact-config");
	await command.handler('{"thinking":null,"maxCalls":2}', ctx);
	assert.equal((await loadConfig(f.configPath)).maxCalls, 2);
	for (const patch of ["[]", "{broken", '{"unknown":true}'])
		await command.handler(patch, ctx);
	assert.equal((await loadConfig(f.configPath)).maxCalls, 2);
	assert.equal(resolveModel(ctx, `${model.provider}/${model.id}`).id, model.id);
	assert.throws(() => resolveModel(ctx, "missing/model"), /unavailable/);
	assert.throws(
		() => resolveModel({ ...ctx, model: undefined }, null),
		/unavailable/,
	);
	assert.throws(
		() =>
			resolveModel(
				{
					...ctx,
					scopedModels: [
						{ model: { ...model, id: "different" }, thinkingLevel: "low" },
					],
				},
				null,
			),
		/scope/,
	);
	assert.throws(
		() => resolveModel({ ...ctx, model: { ...model, contextWindow: 0 } }, null),
		/unusable/,
	);
});
