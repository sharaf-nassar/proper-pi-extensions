import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionContext,
	type ExtensionFactory,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

// @lat: [[lat.md/proper-base/tests#Verification#Context window fixture]]

import {
	asTokensSession,
	CONTEXT_TOKENS_ENTRY,
	ContextTokens,
	installTokensScopeCompletion,
	parseTokensArgs,
	type TokensModel,
	type TokensSession,
	tokensArgumentCompletions,
	tokensNotice,
} from "../src/context-tokens.ts";
import { installStickyDefaultsAdapter } from "../src/sticky-defaults.ts";

const CPA = "cliproxyapi";
const model = (
	provider: string,
	id: string,
	contextWindow = 272000,
): TokensModel => ({ provider, id, contextWindow });

async function withAgentDir(run: (agentDir: string) => Promise<void>) {
	const agentDir = await mkdtemp(join(tmpdir(), "context-tokens-"));
	try {
		await run(agentDir);
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
}

function harness(agentDir: string, registryModels: TokensModel[]) {
	const find = (provider: string, id: string) =>
		registryModels.find((m) => m.provider === provider && m.id === id);
	const branch: { type: string; customType?: string; data?: unknown }[] = [];
	const session: TokensSession = {
		agent: { state: { model: registryModels[0] } },
		settingsManager: {
			getCompactionSettings: () => ({ enabled: true, reserveTokens: 16384 }),
		},
		sessionManager: { getBranch: () => branch },
	};
	return {
		tokens: new ContextTokens(agentDir, () => CPA),
		session,
		registry: { find },
		find,
		choose: (mode: string | null) =>
			branch.push({
				type: "custom",
				customType: CONTEXT_TOKENS_ENTRY,
				data: { mode },
			}),
	};
}

test("/tokens accepts max or default with an optional trailing global", () => {
	assert.deepEqual(parseTokensArgs(""), { global: false });
	assert.deepEqual(parseTokensArgs(" MAX "), { mode: "max", global: false });
	assert.deepEqual(parseTokensArgs("default global"), {
		mode: "default",
		global: true,
	});
	for (const bad of ["global", "max session", "max global now", "huge"]) {
		assert.equal(parseTokensArgs(bad), undefined);
	}
	assert.deepEqual(
		tokensArgumentCompletions("max")?.map((item) => item.value),
		["max", "max global"],
	);
	assert.equal(tokensArgumentCompletions("x"), null);
	// After a completed mode the scopes follow, session first and preselected
	// by Pi because its value equals the typed text.
	assert.deepEqual(
		tokensArgumentCompletions("max ")?.map(({ value, label }) => [
			value,
			label,
		]),
		[
			["max ", "max"],
			["max global", "max global"],
		],
	);
	assert.deepEqual(
		tokensArgumentCompletions("default g")?.map(({ value }) => value),
		["default global"],
	);
});

test("Tab or a space after a /tokens mode opens the scope menu", () => {
	const editor = {
		text: "",
		showing: false,
		triggered: 0,
		getText() {
			return this.text;
		},
		isShowingAutocomplete() {
			return this.showing;
		},
		tryTriggerAutocomplete() {
			this.triggered++;
		},
		// Tab applies the open menu's selection and closes it, like Pi.
		handleInput(data: string) {
			if (data === "\t") {
				if (this.showing) this.text = "/tokens max";
				this.showing = false;
				return;
			}
			this.text += data;
		},
		render: () => [],
		invalidate() {},
	};
	const keybindings = {
		matches: (data: string, action: string) =>
			action === "tui.input.tab" && data === "\t",
	};
	installTokensScopeCompletion(editor, keybindings);
	installTokensScopeCompletion(editor, keybindings);

	editor.text = "/tokens m";
	editor.showing = true;
	editor.handleInput("\t");
	assert.equal(editor.text, "/tokens max ");
	assert.equal(editor.triggered, 1);

	// Tab on the session scope keeps the text and asks for nothing more.
	editor.handleInput("\t");
	assert.equal(editor.text, "/tokens max ");
	assert.equal(editor.triggered, 1);

	editor.text = "/tokens default";
	editor.handleInput(" ");
	assert.equal(editor.triggered, 2);

	// An open menu keeps its own refresh; other text and spaces ask nothing.
	editor.text = "/tokens max";
	editor.showing = true;
	editor.handleInput(" ");
	editor.showing = false;
	for (const text of ["/tokens max global", "/model max", "tokens max"]) {
		editor.text = text;
		editor.handleInput(" ");
		editor.handleInput("\t");
	}
	assert.equal(editor.triggered, 2);
});

test("session choice overrides global, and default restores the registry model", async () => {
	await withAgentDir(async (agentDir) => {
		const h = harness(agentDir, [model(CPA, "gpt-6-astra")]);
		const registryAstra = h.session.agent.state.model;

		// No choice anywhere: the registry default stays in place.
		assert.deepEqual(h.tokens.apply(h.session, h.registry), {
			window: 272000,
			limits: { default: 272000, max: 922000 },
		});
		assert.equal(h.session.agent.state.model, registryAstra);

		h.choose("max");
		assert.equal(h.tokens.apply(h.session, h.registry)?.window, 922000);
		const copy = h.session.agent.state.model;
		assert.notEqual(copy, registryAstra);
		assert.deepEqual(copy, { ...registryAstra, contextWindow: 922000 });
		// The shared registry object is never mutated.
		assert.equal(registryAstra?.contextWindow, 272000);

		// Global max applies once the session defers to it.
		h.tokens.setGlobalMode("max");
		h.choose("default");
		h.tokens.apply(h.session, h.registry);
		assert.equal(h.session.agent.state.model, registryAstra);
		h.choose(null);
		h.tokens.apply(h.session, h.registry);
		assert.equal(h.session.agent.state.model?.contextWindow, 922000);

		// A registry refresh drops the copy; the next apply restores it.
		h.session.agent.state.model = registryAstra;
		h.tokens.apply(h.session, h.registry);
		assert.equal(h.session.agent.state.model?.contextWindow, 922000);
	});
});

test("the guard windows every model write until it is removed", async () => {
	await withAgentDir(async (agentDir) => {
		const astra = model(CPA, "gpt-6-astra");
		const claude = model(CPA, "claude-opus-5", 1000000);
		const h = harness(agentDir, [astra, claude]);
		const state = h.session.agent.state;
		h.choose("max");
		const remove = h.tokens.guard(h.session, h.registry);
		// A registry refresh or model switch writes the registry object.
		state.model = astra;
		assert.equal(state.model?.contextWindow, 922000);
		assert.equal(astra.contextWindow, 272000);
		state.model = claude;
		assert.equal(state.model, claude);
		h.choose("default");
		state.model = astra;
		assert.equal(state.model, astra);

		// A reload installs a newer guard; the stale remover leaves it alone.
		h.choose("max");
		const removeNewer = h.tokens.guard(h.session, h.registry);
		remove();
		state.model = astra;
		assert.equal(state.model?.contextWindow, 922000);
		removeNewer();
		assert.equal(state.model?.contextWindow, 922000);
		state.model = astra;
		assert.equal(state.model, astra);
		assert.equal(
			Object.getOwnPropertyDescriptor(state, "model")?.writable,
			true,
		);
	});
});

test("each OpenAI backend gets its own hardcoded maximum", async () => {
	await withAgentDir(async (agentDir) => {
		const eligible: [TokensModel, number][] = [
			[model(CPA, "gpt-6-luna"), 922000],
			[model("openai-codex", "gpt-6-astra"), 922000],
			[model("openai-codex", "gpt-5.6-terra"), 922000],
			[model("openai", "gpt-6-astra"), 922000],
			[model("openai", "gpt-5.5"), 922000],
			[model("openai", "gpt-5.4"), 922000],
		];
		const ineligible = [
			model(CPA, "gpt-5.5"),
			model("openai-codex", "gpt-5.5"),
			model(CPA, "claude-opus-5", 1000000),
			model("anthropic", "gpt-6-astra"),
			model("openai", "gpt-5.4-mini", 400000),
			// A models.json override at or above the maximum is left alone.
			model(CPA, "gpt-6-sol", 922000),
		];
		const h = harness(agentDir, [...eligible.map(([m]) => m), ...ineligible]);
		h.tokens.setGlobalMode("max");
		for (const [candidate, max] of eligible) {
			h.session.agent.state.model = candidate;
			assert.equal(h.tokens.apply(h.session, h.registry)?.window, max);
			assert.equal(h.session.agent.state.model?.contextWindow, max);
		}
		for (const candidate of ineligible) {
			h.session.agent.state.model = candidate;
			assert.equal(h.tokens.apply(h.session, h.registry), undefined);
			assert.equal(h.session.agent.state.model, candidate);
		}
	});
});

test("a real AgentSession budgets compaction against the applied window", async () => {
	await withAgentDir(async (agentDir) => {
		const settings = SettingsManager.inMemory({
			compaction: {
				reserveTokens: 16384,
				modelOverrides: {
					"openai-codex/gpt-6-astra": { reserveTokens: 40000 },
				},
			},
		});
		const modelRuntime = await ModelRuntime.create({
			refreshOnCreate: false,
			modelsPath: null,
		});
		await modelRuntime.setRuntimeApiKey("openai-codex", "key");
		const astra = modelRuntime.getModel("openai-codex", "gpt-6-astra");
		assert.ok(astra);
		assert.equal(astra.contextWindow, 272000);
		let adapter: ReturnType<typeof installStickyDefaultsAdapter> | undefined;
		let ctx: ExtensionContext | undefined;
		let extensionApi: Parameters<ExtensionFactory>[0] | undefined;
		const loader = new DefaultResourceLoader({
			cwd: agentDir,
			agentDir,
			settingsManager: settings,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
					adapter = installStickyDefaultsAdapter(() => false);
					pi.on("session_start", (_event, context) => {
						ctx = context;
					});
					pi.on("session_shutdown", () => adapter?.restore());
				},
			],
		});
		await loader.reload();
		const { session } = await createAgentSession({
			cwd: agentDir,
			agentDir,
			model: astra,
			modelRuntime,
			settingsManager: settings,
			sessionManager: SessionManager.inMemory(agentDir),
			resourceLoader: loader,
		});
		await session.extensionRunner.emit({
			type: "session_start",
			reason: "startup",
		});
		try {
			assert.ok(ctx && adapter);
			const live = asTokensSession(adapter.session(ctx.sessionManager));
			assert.equal(live, session as unknown);
			assert.ok(live);
			session.sessionManager.appendCustomEntry(CONTEXT_TOKENS_ENTRY, {
				mode: "max",
			});
			const tokens = new ContextTokens(agentDir, () => CPA);
			const removeGuard = tokens.guard(live, ctx.modelRegistry);
			assert.equal(tokens.apply(live, ctx.modelRegistry)?.window, 922000);
			// Another extension re-registering a provider makes Pi write the
			// fresh registry object into the session with no event.
			extensionApi?.registerProvider("openai-codex", {
				baseUrl: "https://codex.test",
			});
			assert.equal(session.model?.contextWindow, 922000);
			assert.equal(
				(session.model as { baseUrl?: string }).baseUrl,
				"https://codex.test",
			);
			removeGuard();
			assert.equal(session.model?.contextWindow, 922000);
			assert.equal(session.getContextUsage()?.contextWindow, 922000);
			// Identity is unchanged, so the per-model compaction override applies.
			assert.equal(
				settings.getCompactionSettings(session.model).reserveTokens,
				40000,
			);
			assert.equal(astra.contextWindow, 272000);
		} finally {
			await session.extensionRunner.emit({
				type: "session_shutdown",
				reason: "quit",
			});
			session.dispose();
		}
	});
});

test("notices report the compaction trigger for the chosen window", () => {
	const base = {
		modelId: "gpt-6-astra",
		mode: "default",
		scope: "session" as const,
		window: 272000,
		limits: { default: 272000, max: 922000 },
		compaction: { enabled: true, reserveTokens: 16384 },
	};
	assert.deepEqual(tokensNotice({ ...base, contextTokens: 100000 }), {
		message:
			"Context window default for this session: gpt-6-astra now uses 272,000 tokens. Compaction triggers above 255,616 tokens (reserve 16,384).",
		level: "info",
	});
	const past = tokensNotice({ ...base, contextTokens: 400000 });
	assert.equal(past.level, "warning");
	assert.match(
		past.message,
		/400,000-token context is past it, so the next request compacts first/,
	);
	const off = tokensNotice({
		...base,
		compaction: { enabled: false, reserveTokens: 16384 },
		contextTokens: 400000,
	});
	assert.equal(off.level, "warning");
	assert.match(
		off.message,
		/Auto-compaction is off; the current 400,000-token context already exceeds the window/,
	);
	assert.match(
		tokensNotice({
			...base,
			scope: "status",
			mode: "max, set globally",
			window: 922000,
			contextTokens: null,
		}).message,
		/^gpt-6-astra: 922,000-token context window \(max, set globally; default 272,000, max 922,000\)\. Compaction triggers above 905,616/,
	);
});
