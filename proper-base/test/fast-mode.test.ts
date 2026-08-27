import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// @lat: [[lat.md/proper-base/tests#Verification#Fast tier fixture]]

import {
	FastOverlay,
	fastToggleNotice,
	isFastToggle,
} from "../src/fast-mode.ts";
import { installRecorder } from "../src/recorder.ts";

const SOL = { provider: "cliproxyapi", id: "gpt-5.6-sol" };

async function withAgentDir(
	run: (agentDir: string) => Promise<void>,
): Promise<void> {
	const agentDir = await mkdtemp(join(tmpdir(), "fast-mode-"));
	try {
		await writeFile(
			join(agentDir, "cliproxyapi.json"),
			`${JSON.stringify({ baseUrl: "http://127.0.0.1:1", apiKey: "k", fast: false }, null, 2)}\n`,
		);
		await writeFile(
			join(agentDir, "cliproxyapi-models.json"),
			JSON.stringify({ fastModelIds: ["gpt-5.6-sol", "gpt-5.6-terra"] }),
		);
		await run(agentDir);
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
}

test("only a bare /fast submission is the session toggle", () => {
	assert.equal(isFastToggle("/fast"), true);
	assert.equal(isFastToggle("  /fast  "), true);
	assert.equal(isFastToggle("/fast now"), false);
	assert.equal(isFastToggle("/fast-global"), false);
	assert.equal(isFastToggle("fast"), false);
});

test("session fast adds the priority tier for capable models only", async () => {
	await withAgentDir(async (agentDir) => {
		const overlay = new FastOverlay(agentDir, {});
		const payload = { model: "gpt-5.6-sol", input: [] };

		// Off: an untouched payload returns undefined so pi keeps it.
		assert.equal(overlay.rewritePayload(payload, SOL), undefined);

		assert.equal(overlay.toggleSession(), true);
		assert.deepEqual(overlay.rewritePayload(payload, SOL), {
			...payload,
			service_tier: "priority",
		});
		// Already-injected payloads and non-object payloads stay untouched.
		assert.equal(
			overlay.rewritePayload({ ...payload, service_tier: "priority" }, SOL),
			undefined,
		);
		assert.equal(overlay.rewritePayload("payload", SOL), undefined);
		// Other providers and non-capable models never gain the tier.
		assert.equal(
			overlay.rewritePayload(payload, {
				provider: "openai",
				id: "gpt-5.6-sol",
			}),
			undefined,
		);
		assert.equal(
			overlay.rewritePayload(payload, { provider: "cliproxyapi", id: "o1" }),
			undefined,
		);

		// Session state is process-local and resets for a new session.
		overlay.resetSession();
		assert.equal(overlay.isSessionEnabled(), false);
		assert.equal(overlay.rewritePayload(payload, SOL), undefined);
	});
});

test("fast off strips a stale provider-injected priority tier", async () => {
	await withAgentDir(async (agentDir) => {
		const overlay = new FastOverlay(agentDir, {});
		const injected = { model: "gpt-5.6-sol", service_tier: "priority" };
		assert.deepEqual(overlay.rewritePayload(injected, SOL), {
			model: "gpt-5.6-sol",
		});
		// Other tiers are user intent, not provider fast residue.
		assert.equal(
			overlay.rewritePayload({ service_tier: "default" }, SOL),
			undefined,
		);
	});
});

test("the global flag is re-read from the provider config per request", async () => {
	await withAgentDir(async (agentDir) => {
		const overlay = new FastOverlay(agentDir, {});
		const payload = { input: [] };
		assert.equal(overlay.rewritePayload(payload, SOL), undefined);

		// Another session toggles the shared file; this one sees it live.
		const other = new FastOverlay(agentDir, {});
		assert.equal(other.toggleGlobal(), true);
		assert.deepEqual(overlay.rewritePayload(payload, SOL), {
			input: [],
			service_tier: "priority",
		});
		assert.equal(other.toggleGlobal(), false);
		assert.equal(overlay.rewritePayload(payload, SOL), undefined);

		// The write preserves the provider's other keys and file format.
		const raw = await readFile(join(agentDir, "cliproxyapi.json"), "utf8");
		assert.ok(raw.endsWith("}\n"));
		assert.deepEqual(JSON.parse(raw), {
			baseUrl: "http://127.0.0.1:1",
			apiKey: "k",
			fast: false,
		});
	});
});

test("CLIPROXYAPI_FAST and provider id follow the provider's grammar", async () => {
	await withAgentDir(async (agentDir) => {
		const overlay = new FastOverlay(agentDir, { CLIPROXYAPI_FAST: "on" });
		assert.equal(overlay.isGlobalEnabled(), true);
		// Invalid env values fall back to the file.
		assert.equal(
			new FastOverlay(agentDir, {
				CLIPROXYAPI_FAST: "maybe",
			}).isGlobalEnabled(),
			false,
		);
		const renamed = new FastOverlay(agentDir, {
			CLIPROXYAPI_PROVIDER_ID: "cpa-dev",
		});
		assert.equal(renamed.providerId(), "cpa-dev");
		assert.equal(renamed.rewritePayload({ a: 1 }, SOL), undefined);
	});
});

test("a rewritten models cache refreshes the capability set", async () => {
	await withAgentDir(async (agentDir) => {
		const overlay = new FastOverlay(agentDir, {});
		overlay.toggleSession();
		const cachePath = join(agentDir, "cliproxyapi-models.json");
		assert.equal(overlay.supportsModel(SOL), true);

		await writeFile(cachePath, JSON.stringify({ fastModelIds: ["o1"] }));
		const later = new Date(Date.now() + 5000);
		await utimes(cachePath, later, later);
		assert.equal(overlay.supportsModel(SOL), false);
		assert.equal(
			overlay.supportsModel({ provider: "cliproxyapi", id: "o1" }),
			true,
		);

		// A missing cache means no capable models rather than a failure.
		await rm(cachePath);
		assert.equal(overlay.supportsModel(SOL), false);
	});
});

test("toggle feedback names the scope and surviving other scope", () => {
	const on = fastToggleNotice({
		scope: "session",
		enabled: true,
		otherEnabled: false,
		modelSupported: true,
	});
	assert.deepEqual(on, {
		message: "Fast mode enabled for this session.",
		level: "info",
	});
	assert.equal(
		fastToggleNotice({
			scope: "global",
			enabled: true,
			otherEnabled: false,
			modelSupported: false,
		}).level,
		"warning",
	);
	assert.equal(
		fastToggleNotice({
			scope: "session",
			enabled: false,
			otherEnabled: true,
			modelSupported: true,
		}).message,
		"Fast mode disabled for this session. Global Fast mode is still on.",
	);
	assert.equal(
		fastToggleNotice({
			scope: "global",
			enabled: false,
			otherEnabled: true,
			modelSupported: false,
		}).message,
		"Fast mode disabled globally for all sessions. This session's Fast mode is still on.",
	);
});

test("the recorder consume hook swallows /fast before pi sees it", () => {
	const submitted: string[] = [];
	const recorded: string[] = [];
	const consumed: string[] = [];
	const editor: { onSubmit?: (text: string) => void } = {
		onSubmit: (text) => submitted.push(text),
	};
	installRecorder(
		editor,
		(text) => recorded.push(text),
		(text) => text,
		(text) => {
			if (text.trim() !== "/fast") return false;
			consumed.push(text);
			return true;
		},
	);

	editor.onSubmit?.("/fast");
	editor.onSubmit?.("hello");
	assert.deepEqual(consumed, ["/fast"]);
	assert.deepEqual(recorded, ["hello"]);
	assert.deepEqual(submitted, ["hello"]);
});
