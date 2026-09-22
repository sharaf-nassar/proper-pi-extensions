import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	DEFAULTS,
	loadConfig,
	parseConfig,
	parseSummary,
	planChunks,
	saveConfig,
} from "../compact.ts";
import { serializeMessages } from "../context.ts";
import {
	addTool,
	assistant,
	checkpoint,
	fixture,
	model,
	response,
	usage,
	user,
} from "./fixture.ts";

// @lat: [[proper-compact/tests#Configuration and validation]]
test("configuration rejects ambiguous models, invalid budgets and unknown settings", async (t) => {
	const f = await fixture(t);
	assert.deepEqual(await loadConfig(f.configPath), DEFAULTS);
	for (const patch of [
		{ model: "unqualified" },
		{ thinking: ["low"] },
		{ thinking: "ultra" },
		{ maxCalls: 0 },
		{ maxCalls: 1.5 },
		{ maxOutputTokens: 0 },
		{ timeoutMs: Infinity },
		{ enabled: "yes" },
		{ typo: true },
		{ onError: "ignore" },
	]) {
		assert.throws(() => parseConfig(patch));
	}
	await saveConfig(f.configPath, {
		...DEFAULTS,
		model: "provider/models/summary",
		thinking: null,
	});
	assert.equal(
		(await loadConfig(f.configPath)).model,
		"provider/models/summary",
	);
	await writeFile(f.configPath, "{broken");
	await assert.rejects(loadConfig(f.configPath), /Invalid JSON/);
	await f.commands
		.get("compact-config")
		.handler('{"enabled":false}', f.runner.createContext());
	assert.equal(await readFile(f.configPath, "utf8"), "{broken");
	assert.equal(f.calls.length, 0);
});

test("only complete bounded structured text is accepted", () => {
	assert.match(parseSummary(response(), 32768), /## Goal/);
	for (const reason of ["length", "error", "aborted", "toolUse"])
		assert.throws(() => parseSummary(response(checkpoint(), reason), 32768));
	for (const text of [
		"",
		"Answer instead",
		checkpoint().replace("## Progress", "## Goal"),
		checkpoint().replace("## Goal\nSOURCE_EVIDENCE", "## Goal\n"),
		checkpoint().replace("</summary>", ""),
	])
		assert.throws(() => parseSummary(response(text), 32768));
	const tool = response();
	tool.content.push({
		type: "toolCall",
		id: "injected",
		name: "bash",
		arguments: { command: "false" },
	});
	assert.throws(() => parseSummary(tool, 32768), /tool call/);
	assert.throws(() => parseSummary(response(), 10), /over budget/);
});

// @lat: [[proper-compact/tests#Evidence and chunking]]
test("serialization preserves interior and trailing evidence, status, and distinct repeated calls", async (t) => {
	const f = await fixture(t);
	f.manager.appendMessage(user("Never remove authorization."));
	addTool(
		f.manager,
		"before",
		"A".repeat(4000) +
			"INTERIOR_FAILURE" +
			"B".repeat(4000) +
			"TRAILING_FAILURE",
	);
	addTool(f.manager, "after", "ETIMEDOUT", true);
	const branch = f.manager.getBranch();
	const messages: any[] = branch
		.filter((e) => e.type === "message")
		.map((e: any) => e.message);
	const before = JSON.stringify(messages);
	const serialized = serializeMessages(messages, branch, "history");
	for (const text of [
		"INTERIOR_FAILURE",
		"TRAILING_FAILURE",
		"ETIMEDOUT",
		'"isError":false',
		'"isError":true',
		'"entryId"',
	])
		assert.ok(serialized.includes(text));
	assert.equal(JSON.stringify(messages), before);
	const chunks = planChunks(
		`${serialized.repeat(8)}日本語😀`,
		"old",
		"split-turn",
		"keep evidence",
		6000,
		1024,
		16,
	);
	assert.ok(chunks.length > 1);
	assert.equal(chunks.join(""), `${serialized.repeat(8)}日本語😀`);
	for (const chunk of chunks) assert.ok(!/[\uD800-\uDBFF]$/.test(chunk));
	assert.throws(
		() =>
			planChunks(serialized.repeat(100), "old", "history", "", 6000, 1024, 1),
		/maxCalls/,
	);
});

// @lat: [[proper-compact/tests#Native compaction lifecycle]]
test("native AgentSession persists custom summary, boundary and usage without rewriting history", async (t) => {
	const f = await fixture(t);
	const resultId = f.populate();
	const boundary = f.manager.getLeafId();
	const original = structuredClone(f.manager.getEntry(resultId));
	const result = await f.session.compact("FOCUS_SENTINEL");
	assert.equal(result.firstKeptEntryId, boundary);
	assert.deepEqual(result.usage, usage);
	assert.deepEqual(f.manager.getEntry(resultId), original);
	assert.ok(
		JSON.stringify(f.calls[0][1]).includes("INTERIOR_OR_TRAILING_FAILURE"),
	);
	assert.ok(JSON.stringify(f.calls[0][1]).includes("FOCUS_SENTINEL"));
	assert.equal(f.calls[0][2].maxTokens, DEFAULTS.maxOutputTokens);
	assert.equal(f.calls[0][0].maxTokens, DEFAULTS.maxOutputTokens);
	assert.equal(f.calls[0][2].reasoning, "low");
	assert.equal(f.calls[0][2].cacheRetention, "none");
	assert.equal(f.calls[0][2].maxRetries, 0);
	assert.equal(f.fallbacks(), 0);
	assert.deepEqual(f.errors, []);
	const saved: any = f.manager
		.getEntries()
		.find((entry) => entry.type === "compaction");
	assert.deepEqual(saved.usage, usage);
	assert.ok(
		f.session.agent.state.messages.some(
			(message: any) => message.role === "compactionSummary",
		),
	);
});

test("split turns and three successive compactions retain focus and prior checkpoint input", async (t) => {
	const f = await fixture(t);
	f.manager.appendMessage(user("Original request with invariant."));
	f.manager.appendMessage({
		...assistant("Public early progress."),
		content: [
			{
				type: "thinking",
				thinking: "PRIVATE_THINKING_SENTINEL",
				thinkingSignature: "PRIVATE_SIGNATURE_SENTINEL",
			},
			{ type: "text", text: "Public early progress." },
		],
	});
	addTool(f.manager, "prefix", `${"log ".repeat(1500)}PREFIX_FAILURE`, true);
	f.manager.appendMessage(assistant("Retained suffix reasoning. ".repeat(30)));
	for (let cycle = 1; cycle <= 3; cycle++) {
		f.complete(() => response(checkpoint(`CYCLE_${cycle}`)));
		const result = await f.session.compact("SPLIT_FOCUS");
		const request = f.calls.at(-1)[1];
		const input = JSON.stringify(request);
		const prompt = request.messages[1].content;
		assert.ok(input.includes("SPLIT_FOCUS"));
		assert.match(prompt, /# Conversation\n/);
		assert.match(prompt, /\n\n# Instructions\nCreate or update/);
		assert.match(prompt, /Later messages are retained separately/);
		assert.match(prompt, /do not infer or reconstruct later messages/);
		if (cycle === 1) {
			assert.ok(input.includes("turn-prefix"));
			assert.ok(input.includes("PREFIX_FAILURE"));
			assert.ok(input.includes("Public early progress."));
			assert.ok(
				prompt.indexOf("PREFIX_FAILURE") < prompt.indexOf("# Instructions"),
			);
			assert.doesNotMatch(
				input,
				/PRIVATE_THINKING_SENTINEL|PRIVATE_SIGNATURE_SENTINEL|Retained suffix reasoning/,
			);
		} else assert.ok(input.includes(`CYCLE_${cycle - 1}`));
		assert.match(result.summary, new RegExp(`CYCLE_${cycle}`));
		f.manager.appendMessage(user(`New request ${cycle}`));
		f.manager.appendMessage(assistant("Intermediate findings"));
		f.manager.appendMessage(user("Retained request. ".repeat(40)));
	}
	assert.equal(f.calls.length, 3);
	assert.deepEqual(f.errors, []);
});

test("oversized source is fully covered by bounded sequential calls with summed usage", async (t) => {
	const f = await fixture(t);
	await saveConfig(f.configPath, {
		...DEFAULTS,
		maxInputTokens: 6000,
		maxOutputTokens: 1024,
		maxCalls: 8,
	});
	const source =
		"x".repeat(14000) +
		"INTERIOR_CRITICAL" +
		"y".repeat(14000) +
		"TAIL_CRITICAL";
	f.populate(source);
	const result = await f.session.compact();
	assert.ok(f.calls.length > 1);
	const chunks = f.calls.map(
		(call) =>
			call[1].messages[1].content
				.split("# Conversation\n")[1]
				.split("\n\n# Instructions\n")[0],
	);
	assert.ok(chunks.join("").includes(source));
	assert.equal(result.usage.totalTokens, usage.totalTokens * f.calls.length);
	assert.equal(result.usage.reasoning, usage.reasoning * f.calls.length);
	assert.equal(result.usage.cost.total, usage.cost.total * f.calls.length);
	assert.notEqual(f.calls[0][2].sessionId, f.calls[1][2].sessionId);
	assert.deepEqual(f.errors, []);
});

// @lat: [[proper-compact/tests#Failure and cancellation]]
test("invalid output uses explicit stock fallback and preserves failed-attempt usage metadata", async (t) => {
	const f = await fixture(t);
	f.populate();
	f.complete(() => response(checkpoint(), "length"));
	const result = await f.session.compact();
	assert.equal(result.summary, "STOCK FALLBACK");
	assert.equal(f.fallbacks(), 1);
	assert.ok(f.notices.some((notice) => notice.includes("truncation applies")));
	const attempt: any = f.manager
		.getEntries()
		.find((entry) => entry.type === "custom");
	assert.equal(attempt.data.status, "failed");
	assert.deepEqual(attempt.data.usage, usage);
	assert.deepEqual(f.errors, []);
});

test("plain-text refusals fall back or cancel without persisting a custom checkpoint", async (t) => {
	for (const onError of ["stock", "cancel"] as const) {
		await t.test(onError, async (t) => {
			const f = await fixture(t);
			f.populate();
			await saveConfig(f.configPath, { ...DEFAULTS, onError });
			const before = f.manager.buildSessionContext().messages;
			const refusal = "This request was blocked due to reasoning_extraction.";
			f.complete(() => response(refusal));
			if (onError === "stock") {
				assert.equal((await f.session.compact()).summary, "STOCK FALLBACK");
			} else {
				await assert.rejects(f.session.compact(), /cancelled/);
				assert.deepEqual(f.manager.buildSessionContext().messages, before);
			}
			const summaries = f.manager
				.getEntries()
				.filter((entry) => entry.type === "compaction");
			assert.deepEqual(
				summaries.map((entry) => entry.summary),
				onError === "stock" ? ["STOCK FALLBACK"] : [],
			);
			assert.equal(f.fallbacks(), onError === "stock" ? 1 : 0);
			assert.equal(f.calls.length, 1);
			const attempt: any = f.manager
				.getEntries()
				.find((entry) => entry.type === "custom");
			assert.equal(attempt.data.status, "failed");
			assert.deepEqual(attempt.data.usage, usage);
			assert.deepEqual(f.errors, []);
		});
	}
});

test("cancel policy leaves native context intact and capacity preflight spends nothing", async (t) => {
	const f = await fixture(t);
	f.populate("x".repeat(100000));
	await saveConfig(f.configPath, {
		...DEFAULTS,
		maxInputTokens: 6000,
		maxOutputTokens: 1024,
		maxCalls: 1,
		onError: "cancel",
	});
	const before = f.manager.buildSessionContext().messages;
	await assert.rejects(f.session.compact(), /cancelled/);
	assert.deepEqual(f.manager.buildSessionContext().messages, before);
	assert.equal(f.calls.length, 0);
	assert.equal(f.fallbacks(), 0);
	assert.deepEqual(f.errors, []);
});

test("shutdown interrupts an uncooperative completion and never writes into a replacement session", async (t) => {
	const f = await fixture(t);
	f.populate();
	let started: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		started = resolve;
	});
	f.complete(() => {
		started();
		return new Promise(() => {});
	});
	const pending = f.session.compact();
	await ready;
	await f.runner.emit({ type: "session_shutdown", reason: "new" });
	await assert.rejects(pending, /cancelled/);
	assert.equal(
		f.manager
			.getEntries()
			.filter((entry) => entry.type === "custom" || entry.type === "compaction")
			.length,
		0,
	);
	assert.equal(f.fallbacks(), 0);
	assert.deepEqual(f.errors, []);
	await f.runner.emit({ type: "session_start", reason: "new" });
	f.complete(() => response());
	assert.match((await f.session.compact()).summary, /## Goal/);
});

test("deadline bounds an uncooperative provider", async (t) => {
	const f = await fixture(t);
	f.populate();
	await saveConfig(f.configPath, {
		...DEFAULTS,
		timeoutMs: 1000,
		onError: "cancel",
	});
	f.complete(() => new Promise(() => {}));
	// Keep the test process alive while AbortSignal.timeout's unref'ed timer runs.
	const keepAlive = setInterval(() => {}, 2000);
	try {
		await assert.rejects(f.session.compact(), /cancelled/);
	} finally {
		clearInterval(keepAlive);
	}
	assert.ok(f.notices.some((notice) => notice.includes("deadline exceeded")));
	assert.equal(f.fallbacks(), 0);
	assert.deepEqual(f.errors, []);
});

test("disabled configuration delegates without inference", async (t) => {
	const f = await fixture(t);
	f.populate();
	await saveConfig(f.configPath, { ...DEFAULTS, enabled: false });
	await f.session.compact();
	assert.equal(f.calls.length, 0);
	assert.equal(f.fallbacks(), 1);
});

// @lat: [[proper-compact/tests#Provider routing]]
test("real registry runtime forwards request-time endpoint, headers and environment", async (t) => {
	const f = await fixture(t);
	f.populate();
	const seen: any[] = [];
	const runtime: any = Object.create(ModelRuntime.prototype);
	runtime.models = {
		getProvider: () => ({
			streamSimple(...args: any[]) {
				seen.push(args);
				const stream = createAssistantMessageEventStream();
				stream.push({ type: "done", reason: "stop", message: response() });
				return stream;
			},
		}),
	};
	runtime.getAuth = async () => ({
		auth: {
			apiKey: "fixture-only",
			baseUrl: "http://127.0.0.1:2",
			headers: { "X-Fixture": "yes" },
		},
		env: { FIXTURE_ENV: "yes" },
	});
	const registry = new ModelRegistry(runtime);
	f.registry.streamSimple = registry.streamSimple.bind(registry);
	await f.session.compact();
	assert.equal(seen.length, 1);
	assert.equal(seen[0][0].baseUrl, "http://127.0.0.1:2");
	assert.equal(seen[0][0].maxTokens, DEFAULTS.maxOutputTokens);
	assert.equal(seen[0][2].headers["X-Fixture"], "yes");
	assert.equal(seen[0][2].env.FIXTURE_ENV, "yes");
	assert.equal(seen[0][1].messages[0].role, "system");
	assert.equal(
		seen[0][1].messages.some((message: any) => message.toolsAdded?.length),
		false,
	);
	assert.equal(model.maxTokens, 128000);
	assert.deepEqual(f.errors, []);
});
