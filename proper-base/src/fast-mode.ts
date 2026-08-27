import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE_NAME = "cliproxyapi.json";
const MODELS_CACHE_FILE_NAME = "cliproxyapi-models.json";
const DEFAULT_PROVIDER_ID = "cliproxyapi";
const PRIORITY_TIER = "priority";
const FAST_COMMAND = "/fast";

type JsonObject = Record<string, unknown>;

/** The request-model fields this module reads. */
export type FastModel = { provider: string; id: string };

export type FastNotice = { message: string; level: "info" | "warning" };

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

/** Mirror of the provider's boolean-setting grammar for `CLIPROXYAPI_FAST`. */
function parseBooleanSetting(value: string): boolean | undefined {
	switch (value.trim().toLowerCase()) {
		case "1":
		case "true":
		case "yes":
		case "on":
			return true;
		case "0":
		case "false":
		case "no":
		case "off":
			return false;
		default:
			return undefined;
	}
}

/** Whether submitted editor text is exactly the `/fast` toggle. */
export function isFastToggle(text: string): boolean {
	return text.trim() === FAST_COMMAND;
}

/**
 * Session and global Fast preferences layered over the CLIProxyAPI provider.
 *
 * The provider's own `/fast` persists one flag and refreshes it only at
 * extension load, so it is neither session-scoped nor live across sessions.
 * This overlay owns the final `service_tier` decision instead: the session
 * flag lives in memory and dies with the session, while the global flag is
 * the provider's persisted `fast` key, re-read on every request so a toggle
 * in one session reaches every running session's next request.
 */
export class FastOverlay {
	private sessionEnabled = false;
	private modelsCache: { mtimeMs: number; ids: Set<string> } | undefined;
	private readonly agentDir: string;
	private readonly env: Record<string, string | undefined>;

	constructor(
		agentDir: string,
		env: Record<string, string | undefined> = process.env,
	) {
		this.agentDir = agentDir;
		this.env = env;
	}

	private configPath(): string {
		return join(this.agentDir, CONFIG_FILE_NAME);
	}

	/** Session Fast is never persisted; a new session always starts off. */
	resetSession(): void {
		this.sessionEnabled = false;
	}

	isSessionEnabled(): boolean {
		return this.sessionEnabled;
	}

	toggleSession(): boolean {
		this.sessionEnabled = !this.sessionEnabled;
		return this.sessionEnabled;
	}

	/**
	 * The provider's Fast default: `CLIPROXYAPI_FAST` when set, else the
	 * persisted `fast` key. Re-read per call so other sessions' writes count.
	 */
	isGlobalEnabled(): boolean {
		const envValue = this.env.CLIPROXYAPI_FAST;
		if (envValue !== undefined) {
			const parsed = parseBooleanSetting(envValue);
			if (parsed !== undefined) return parsed;
		}
		return readJsonObject(this.configPath())?.fast === true;
	}

	/**
	 * Flip the persisted global flag, preserving every other config key and
	 * the provider's own file format. Write failures propagate to the caller.
	 */
	toggleGlobal(): boolean {
		const existing = readJsonObject(this.configPath()) ?? {};
		const next = !this.isGlobalEnabled();
		writeFileSync(
			this.configPath(),
			`${JSON.stringify({ ...existing, fast: next }, null, 2)}\n`,
			"utf8",
		);
		return next;
	}

	/** The configured provider id the overlay scopes itself to. */
	providerId(): string {
		const envId = this.env.CLIPROXYAPI_PROVIDER_ID?.trim();
		if (envId) return envId;
		const fileId = readJsonObject(this.configPath())?.providerId;
		return typeof fileId === "string" && fileId.trim()
			? fileId.trim()
			: DEFAULT_PROVIDER_ID;
	}

	/** Whether the provider's cached catalog marks this model Fast-capable. */
	supportsModel(model: FastModel | undefined): boolean {
		if (!model || model.provider !== this.providerId()) return false;
		const path = join(this.agentDir, MODELS_CACHE_FILE_NAME);
		let mtimeMs: number;
		try {
			mtimeMs = statSync(path).mtimeMs;
		} catch {
			this.modelsCache = undefined;
			return false;
		}
		if (this.modelsCache?.mtimeMs !== mtimeMs) {
			const ids = readJsonObject(path)?.fastModelIds;
			this.modelsCache = {
				mtimeMs,
				ids: new Set(
					Array.isArray(ids)
						? ids.filter((id): id is string => typeof id === "string")
						: [],
				),
			};
		}
		return this.modelsCache.ids.has(model.id);
	}

	/**
	 * The replacement payload for pi's `before_provider_request`, or
	 * `undefined` to keep it. Adds `service_tier` when Fast is on for a
	 * capable model of this provider, and strips a priority tier the
	 * provider's stale in-memory flag injected when Fast is off, so a global
	 * toggle takes effect on every running session's next request.
	 */
	rewritePayload(payload: unknown, model: FastModel | undefined): unknown {
		if (!model || model.provider !== this.providerId()) return undefined;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			return undefined;
		}
		const record = payload as JsonObject;
		const effective = this.sessionEnabled || this.isGlobalEnabled();
		if (effective && this.supportsModel(model)) {
			if (record.service_tier === PRIORITY_TIER) return undefined;
			return { ...record, service_tier: PRIORITY_TIER };
		}
		if (!effective && record.service_tier === PRIORITY_TIER) {
			const { service_tier: _dropped, ...rest } = record;
			return rest;
		}
		return undefined;
	}
}

/** User-facing toggle feedback shared by `/fast` and `/fast-global`. */
export function fastToggleNotice(options: {
	scope: "session" | "global";
	enabled: boolean;
	otherEnabled: boolean;
	modelSupported: boolean;
}): FastNotice {
	const { scope, enabled, otherEnabled, modelSupported } = options;
	const where =
		scope === "session" ? "for this session" : "globally for all sessions";
	if (!enabled) {
		const residual = otherEnabled
			? scope === "session"
				? " Global Fast mode is still on."
				: " This session's Fast mode is still on."
			: "";
		return {
			message: `Fast mode disabled ${where}.${residual}`,
			level: "info",
		};
	}
	if (!modelSupported) {
		return {
			message: `Fast mode enabled ${where}, but the current model does not support it.`,
			level: "warning",
		};
	}
	return { message: `Fast mode enabled ${where}.`, level: "info" };
}
