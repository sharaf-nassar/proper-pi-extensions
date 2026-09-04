import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SETTINGS_FILE_NAME = "settings.json";
const CONFIG_FILE_NAME = "proper-base.json";
/**
 * proper-llm-router's routing placeholder. Its provider is registered by an
 * extension and carries no credentials, so Pi's startup resolver skips it and
 * silently falls back; the router re-selects it at every session start anyway.
 */
const PLACEHOLDER_PROVIDER = "llm-router";

/** The model identity Pi's startup defaults are keyed by. */
export type DefaultModel = { provider: string; id: string };

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

/** Whether the session's model and effort follow into Pi's startup defaults. */
export function stickyDefaultsEnabled(agentDir: string): boolean {
	return (
		readJsonObject(join(agentDir, CONFIG_FILE_NAME))?.stickyDefaults !== false
	);
}

function settingsPath(agentDir: string): string {
	return join(agentDir, SETTINGS_FILE_NAME);
}

/**
 * Pi's settings, or nothing when persistence is off or the file is absent or
 * damaged. A damaged file is never replaced with a defaults-only one.
 */
function openSettings(agentDir: string): JsonObject | undefined {
	if (!stickyDefaultsEnabled(agentDir)) return undefined;
	return readJsonObject(settingsPath(agentDir));
}

/**
 * Replace Pi's settings file, preserving every other key and its two-space
 * format. Writing from outside is safe against Pi's own saves: its settings
 * writer re-reads the file under a lock and merges back only the fields it
 * marked modified, so keys written here survive.
 *
 * ponytail: read-modify-write without Pi's lock. A Pi settings write landing
 * inside one of these read/write pairs would be overwritten; take the lock if
 * extensions ever get access to it.
 */
function writeSettings(agentDir: string, settings: JsonObject): boolean {
	try {
		writeFileSync(
			settingsPath(agentDir),
			`${JSON.stringify(settings, null, 2)}\n`,
			"utf8",
		);
		return true;
	} catch {
		return false;
	}
}

function perModelLevel(
	settings: JsonObject,
	model: DefaultModel,
): unknown | undefined {
	const levels = settings.modelThinkingLevels;
	if (!levels || typeof levels !== "object") return undefined;
	return (levels as JsonObject)[`${model.provider}/${model.id}`];
}

/**
 * Record the active model as Pi's startup default.
 *
 * Pi writes `defaultProvider`/`defaultModel` only when Ctrl+S is pressed in the
 * `/model` picker; a plain selection lives and dies with the session, so a new
 * session silently reopens on whichever model was saved last. Extensions get no
 * access to Pi's settings manager, so the two keys are rewritten directly.
 *
 * An unchanged selection writes nothing, so restores and repeated cycling
 * through the same model cause no churn. The routing placeholder is never
 * stored, because Pi cannot start on it.
 */
export function persistDefaultModel(
	agentDir: string,
	model: DefaultModel,
): boolean {
	if (model.provider === PLACEHOLDER_PROVIDER) return false;
	const settings = openSettings(agentDir);
	if (!settings) return false;
	if (
		settings.defaultProvider === model.provider &&
		settings.defaultModel === model.id
	) {
		return false;
	}
	return writeSettings(agentDir, {
		...settings,
		defaultProvider: model.provider,
		defaultModel: model.id,
	});
}

/**
 * Record the active thinking level as Pi's startup default.
 *
 * Persisting the level is what makes it hold, not merely what makes it
 * reappear. Pi recomputes the level on every model switch from
 * `modelThinkingLevels`, then `defaultThinkingLevel`, and only then the level
 * in effect, so a session-only choice does not survive the next `/model`,
 * `Ctrl+P`, `/clear`, or routed prompt: the saved default overwrites it mid
 * session. Writing the same key the resolver reads keeps the current choice
 * both durable and stable across switches.
 *
 * The event carries the level after Pi clamps it to the model, so moving to a
 * model that cannot reach the current level records the level actually in
 * effect. A level matching a `modelThinkingLevels` entry for the current model
 * is not stored: that rule is per model, and promoting it to the global default
 * would hand it to every model without one.
 */
export function persistDefaultThinkingLevel(
	agentDir: string,
	level: string,
	model: DefaultModel | undefined,
): boolean {
	const settings = openSettings(agentDir);
	if (!settings) return false;
	if (settings.defaultThinkingLevel === level) return false;
	if (model && perModelLevel(settings, model) === level) return false;
	return writeSettings(agentDir, {
		...settings,
		defaultThinkingLevel: level,
	});
}
