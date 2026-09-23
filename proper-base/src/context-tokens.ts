import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Component } from "@earendil-works/pi-tui";

const CONFIG_FILE_NAME = "proper-base.json";
const GLOBAL_KEY = "contextTokens";

/**
 * The hard input cap of OpenAI's 1,050,000-token models: the window minus
 * the 128,000 reserved output tokens. Probing the Codex backend through
 * CLIProxyAPI on 2026-09-22 rejected every listed model one token past it
 * (usage-counted 921,858 accepted, 921,859 refused; the rest is hidden
 * request framing), just as gpt-5.5 there stops at Pi's registered 272,000.
 * Codex's own catalog budgets 872,000, keeping 50,000 of headroom that Pi's
 * `reserveTokens` provides instead.
 */
const MAX_INPUT = 922_000;
const CODEX_MODELS = new Set([
	"gpt-6-astra",
	"gpt-6-sol",
	"gpt-6-luna",
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
]);
/** The API also serves GPT-5.5 and GPT-5.4 at 1,050,000 (Codex keeps GPT-5.5 at 272,000). */
const API_MODELS = new Set([...CODEX_MODELS, "gpt-5.5", "gpt-5.4"]);

export const CONTEXT_TOKENS_ENTRY = "proper-base-context-tokens";
export const TOKENS_USAGE = "Usage: /tokens [max|default] [global]";

export type ContextTokensMode = "max" | "default";
export type TokenLimits = { default: number; max: number };
export type TokensModel = {
	provider: string;
	id: string;
	contextWindow: number;
};
type CompactionSettings = { enabled: boolean; reserveTokens: number };
type BranchEntry = { type: string; customType?: string; data?: unknown };

/** The live AgentSession fields this module reads and writes. */
export type TokensSession = {
	agent: { state: { model: TokensModel | undefined } };
	settingsManager: {
		getCompactionSettings(model?: TokensModel): CompactionSettings;
	};
	sessionManager: { getBranch(): readonly BranchEntry[] };
};

/** The ModelRegistry call this module needs. */
export type TokensRegistry = {
	find(provider: string, id: string): TokensModel | undefined;
};

type JsonObject = Record<string, unknown>;

function readJsonObject(path: string): JsonObject | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as JsonObject)
			: undefined;
	} catch {
		return undefined;
	}
}

function isMode(value: unknown): value is ContextTokensMode {
	return value === "max" || value === "default";
}

/** Feature-detect the private AgentSession shape; a renamed field disables the command. */
export function asTokensSession(value: unknown): TokensSession | undefined {
	const session = value as Partial<TokensSession> | undefined;
	return session?.agent?.state &&
		typeof session.settingsManager?.getCompactionSettings === "function" &&
		typeof session.sessionManager?.getBranch === "function"
		? (session as TokensSession)
		: undefined;
}

/** `""` shows the state; otherwise `max|default` with an optional `global`. */
export function parseTokensArgs(
	args: string,
): { mode?: ContextTokensMode; global: boolean } | undefined {
	const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return { global: false };
	const [mode, scope, ...rest] = words;
	if (!isMode(mode) || rest.length || (scope && scope !== "global")) {
		return undefined;
	}
	return { mode, global: scope === "global" };
}

const COMPLETIONS = [
	{ value: "max", description: "Largest window for this session" },
	{ value: "default", description: "Standard window for this session" },
	{ value: "max global", description: "Largest window for every session" },
	{ value: "default global", description: "Standard window for every session" },
];

export function tokensArgumentCompletions(prefix: string) {
	const needle = prefix.trimStart().toLowerCase();
	// After a completed mode, list its scopes. The session scope leads and its
	// value equals the typed text, so Pi preselects it and Enter or Tab keeps
	// the choice session-only instead of turning it global.
	const mode = /^(max|default) $/.exec(needle)?.[1];
	const items = mode
		? COMPLETIONS.filter(({ value }) => value.startsWith(mode)).map((item) => ({
				...item,
				value: item.value === mode ? needle : item.value,
				label: item.value,
			}))
		: COMPLETIONS.filter(({ value }) => value.startsWith(needle)).map(
				(item) => ({ ...item, label: item.value }),
			);
	return items.length ? items : null;
}

const SCOPE_INSTALLED = Symbol.for("pi-proper-base.tokens-scope-completion");
const MODE_TEXT = /^\/tokens (?:max|default)$/;
const SCOPE_TEXT = /^\/tokens (?:max|default) $/;

type ScopeEditor = Component & {
	getText?(): string;
	handleInput?(data: string): void;
	isShowingAutocomplete?(): boolean;
	tryTriggerAutocomplete?(): void;
	[SCOPE_INSTALLED]?: boolean;
};

/**
 * Offer the `global` scope after a `/tokens` mode. Pi reopens suggestions
 * only from typed letters and digits, and the separator is a space, so Tab
 * on a mode stops there, adds the space, and opens the scope menu, and a
 * typed space opens it too. Tab on a scope completes it and closes.
 */
export function installTokensScopeCompletion(
	editor: Component,
	keybindings: { matches(data: string, action: string): boolean },
): void {
	const target = editor as ScopeEditor;
	if (target[SCOPE_INSTALLED] || !target.handleInput || !target.getText) return;
	const handleInput = target.handleInput.bind(target);
	target.handleInput = (data: string) => {
		handleInput(data);
		if (target.isShowingAutocomplete?.()) return;
		const tab = keybindings.matches(data, "tui.input.tab");
		if (tab && MODE_TEXT.test(target.getText?.() ?? "")) handleInput(" ");
		else if (data !== " ") return;
		if (SCOPE_TEXT.test(target.getText?.() ?? ""))
			target.tryTriggerAutocomplete?.();
	};
	target[SCOPE_INSTALLED] = true;
}

const format = (tokens: number) => tokens.toLocaleString("en-US");

/**
 * Session and global context-window choices for OpenAI models.
 *
 * Pi registers these models at their standard window (272,000) although
 * the backend accepts more, so the choice only changes Pi's budgeting: the
 * session model is swapped for a copy carrying the chosen `contextWindow`,
 * which every compaction, overflow, and footer check reads live. The
 * provider/id identity is unchanged, so per-model compaction overrides keep
 * applying. The session choice is a branch entry; the global choice is
 * `contextTokens` in `proper-base.json`, re-read on every apply.
 */
export class ContextTokens {
	private readonly agentDir: string;
	private readonly cliproxyProviderId: () => string;

	constructor(agentDir: string, cliproxyProviderId: () => string) {
		this.agentDir = agentDir;
		this.cliproxyProviderId = cliproxyProviderId;
	}

	private configPath(): string {
		return join(this.agentDir, CONFIG_FILE_NAME);
	}

	globalMode(): ContextTokensMode | undefined {
		const value = readJsonObject(this.configPath())?.[GLOBAL_KEY];
		return isMode(value) ? value : undefined;
	}

	/** Preserves every other key. Write failures propagate to the caller. */
	setGlobalMode(mode: ContextTokensMode): void {
		const existing = readJsonObject(this.configPath()) ?? {};
		writeFileSync(
			this.configPath(),
			`${JSON.stringify({ ...existing, [GLOBAL_KEY]: mode }, null, "\t")}\n`,
		);
	}

	/** The latest session choice on this branch; `null` data follows global. */
	sessionMode(branch: readonly BranchEntry[]): ContextTokensMode | undefined {
		for (let index = branch.length - 1; index >= 0; index--) {
			const entry = branch[index];
			if (entry?.type !== "custom" || entry.customType !== CONTEXT_TOKENS_ENTRY)
				continue;
			const mode = (entry.data as { mode?: unknown } | undefined)?.mode;
			return isMode(mode) ? mode : undefined;
		}
		return undefined;
	}

	effectiveMode(branch: readonly BranchEntry[]): ContextTokensMode {
		return this.sessionMode(branch) ?? this.globalMode() ?? "default";
	}

	/**
	 * Limits for a registry model, or `undefined` when it has no larger
	 * window. The default is the registry's own value, including any
	 * `models.json` override.
	 */
	limitsFor(model: TokensModel): TokenLimits | undefined {
		const models =
			model.provider === "openai"
				? API_MODELS
				: model.provider === "openai-codex" ||
						model.provider === this.cliproxyProviderId()
					? CODEX_MODELS
					: undefined;
		return models?.has(model.id) && MAX_INPUT > model.contextWindow
			? { default: model.contextWindow, max: MAX_INPUT }
			: undefined;
	}

	/** The model carrying the effective window, or the model unchanged. */
	private windowed(
		model: TokensModel | undefined,
		session: TokensSession,
		registry: TokensRegistry,
	): TokensModel | undefined {
		if (!model) return model;
		const base = registry.find(model.provider, model.id) ?? model;
		const limits = this.limitsFor(base);
		if (!limits) return model;
		const mode = this.effectiveMode(session.sessionManager.getBranch());
		const window = mode === "max" ? limits.max : limits.default;
		if (model.contextWindow === window) return model;
		return window === base.contextWindow
			? base
			: { ...base, contextWindow: window };
	}

	/**
	 * Swap the session model for one carrying the effective window. Returns
	 * the applied window, or `undefined` when the model is ineligible.
	 */
	apply(
		session: TokensSession,
		registry: TokensRegistry,
	): { window: number; limits: TokenLimits } | undefined {
		const state = session.agent.state;
		const next = this.windowed(state.model, session, registry);
		if (next !== state.model) state.model = next;
		if (!next) return undefined;
		const limits = this.limitsFor(
			registry.find(next.provider, next.id) ?? next,
		);
		return limits && { window: next.contextWindow, limits };
	}

	/**
	 * Keep the effective window across every write to the session model.
	 * Model switches, session restore, and any extension's provider
	 * (re)registration put the registry object back without an event, so the
	 * setter windows each model as it lands. Global changes made by another
	 * process still need `apply`. Returns the uninstaller.
	 */
	guard(session: TokensSession, registry: TokensRegistry): () => void {
		const state = session.agent.state;
		let model = state.model;
		const get = () => model;
		Object.defineProperty(state, "model", {
			configurable: true,
			enumerable: true,
			get,
			set: (next: TokensModel | undefined) => {
				model = this.windowed(next, session, registry);
			},
		});
		return () => {
			if (Object.getOwnPropertyDescriptor(state, "model")?.get !== get) return;
			Object.defineProperty(state, "model", {
				configurable: true,
				enumerable: true,
				writable: true,
				value: model,
			});
		};
	}
}

/** Feedback for `/tokens`, including where compaction will now trigger. */
export function tokensNotice(options: {
	modelId: string;
	/** The chosen mode, or for status its label and source. */
	mode: string;
	scope: "session" | "global" | "status";
	window: number;
	limits: TokenLimits;
	compaction: CompactionSettings;
	contextTokens: number | null | undefined;
}): { message: string; level: "info" | "warning" } {
	const { modelId, mode, scope, window, limits, compaction, contextTokens } =
		options;
	const where =
		scope === "global"
			? " for all sessions"
			: scope === "session"
				? " for this session"
				: "";
	const lead =
		scope === "status"
			? `${modelId}: ${format(window)}-token context window (${mode}; default ${format(limits.default)}, max ${format(limits.max)}).`
			: `Context window ${mode}${where}: ${modelId} now uses ${format(window)} tokens.`;
	if (!compaction.enabled) {
		const over = contextTokens != null && contextTokens > window;
		return {
			message: `${lead} Auto-compaction is off${over ? `; the current ${format(contextTokens)}-token context already exceeds the window.` : "."}`,
			level: over ? "warning" : "info",
		};
	}
	const threshold = window - compaction.reserveTokens;
	const trigger = `Compaction triggers above ${format(Math.max(0, threshold))} tokens (reserve ${format(compaction.reserveTokens)}).`;
	if (contextTokens != null && contextTokens > threshold) {
		return {
			message: `${lead} ${trigger} The current ${format(contextTokens)}-token context is past it, so the next request compacts first.`,
			level: "warning",
		};
	}
	return { message: `${lead} ${trigger}`, level: "info" };
}
