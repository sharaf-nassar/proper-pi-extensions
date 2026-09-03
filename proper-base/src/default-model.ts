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

/** The model identity Pi's startup default is keyed by. */
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

/** Whether the active model follows into Pi's startup defaults. */
export function stickyModelEnabled(agentDir: string): boolean {
	return (
		readJsonObject(join(agentDir, CONFIG_FILE_NAME))?.stickyModel !== false
	);
}

/**
 * Record the active model as Pi's startup default.
 *
 * Pi writes `defaultProvider`/`defaultModel` only when Ctrl+S is pressed in the
 * `/model` picker; a plain selection lives and dies with the session, so a new
 * session silently reopens on whichever model was saved last. Extensions get no
 * access to Pi's settings manager, so the two keys are rewritten in the agent
 * directory's `settings.json` directly, preserving every other key and Pi's
 * two-space format.
 *
 * Writing from outside is safe against Pi's own saves: its settings writer
 * re-reads the file under a lock and merges back only the fields it marked
 * modified, so unrelated keys written here survive. An absent or damaged
 * settings file is left alone rather than replaced with a two-key one, and an
 * unchanged selection writes nothing, so restores and repeated cycling through
 * the same model cause no churn. The routing placeholder is never stored,
 * because Pi cannot start on it.
 *
 * ponytail: read-modify-write without Pi's lock. A Pi settings write landing
 * inside this function's own read/write pair would be overwritten; take the
 * lock if extensions ever get access to it.
 */
export function persistDefaultModel(
	agentDir: string,
	model: DefaultModel,
): boolean {
	if (model.provider === PLACEHOLDER_PROVIDER) return false;
	if (!stickyModelEnabled(agentDir)) return false;
	const path = join(agentDir, SETTINGS_FILE_NAME);
	const settings = readJsonObject(path);
	if (!settings) return false;
	if (
		settings.defaultProvider === model.provider &&
		settings.defaultModel === model.id
	) {
		return false;
	}
	try {
		const updated = {
			...settings,
			defaultProvider: model.provider,
			defaultModel: model.id,
		};
		writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
		return true;
	} catch {
		return false;
	}
}
