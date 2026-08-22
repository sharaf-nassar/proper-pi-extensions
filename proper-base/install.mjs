/**
 * npm `postinstall` hook.
 *
 * Pi has no package install hook of its own, so a default that another
 * extension reads only from `settings.json` is written here: once, when the
 * package is installed, never from a running session. Plain JavaScript because
 * npm runs this with bare `node`.
 *
 * Runs for `pi install npm:proper-base`, for git sources, and for `npm
 * install` in a local checkout. A local path registered with `pi install
 * /path/to/proper-base` is only recorded in settings, so it seeds when that
 * checkout's own `npm install` runs.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Pi's user agent directory: `PI_CODING_AGENT_DIR`, else `~/.pi/agent`. */
export function agentDir() {
	const configured = process.env.PI_CODING_AGENT_DIR;
	if (!configured) return join(homedir(), ".pi", "agent");
	return configured.startsWith("~/")
		? join(homedir(), configured.slice(2))
		: configured;
}

function asObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value
		: undefined;
}

/**
 * Give pi-subagents' packaged `worker` agent a fresh context by default.
 *
 * `worker` ships `defaultContext: fork`, which replays the parent transcript
 * into every child. When parent and child resolve to the same model, Pi keeps
 * the inherited signed thinking blocks and Anthropic rejects the request with
 * "`thinking` blocks in the latest assistant message cannot be modified".
 *
 * Returns true only when the file was rewritten.
 */
export function seedWorkerContext(dir) {
	const file = join(dir, "settings.json");
	let settings;
	try {
		settings = asObject(JSON.parse(readFileSync(file, "utf-8")));
	} catch {
		// No settings file yet, or one Pi itself cannot read. Writing here would
		// destroy content we failed to parse, so leave it untouched.
		return false;
	}
	if (!settings) return false;

	const subagents = asObject(settings.subagents) ?? {};
	const overrides = asObject(subagents.agentOverrides) ?? {};
	if ("worker" in overrides) return false;

	settings.subagents = {
		...subagents,
		agentOverrides: { ...overrides, worker: { defaultContext: "fresh" } },
	};

	// Rename onto the target so a crash mid-write cannot truncate settings.
	const staged = `${file}.proper-base`;
	writeFileSync(staged, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
	renameSync(staged, file);
	return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		if (seedWorkerContext(agentDir())) {
			console.log(
				"proper-base: set subagents.agentOverrides.worker.defaultContext to fresh",
			);
		}
	} catch (error) {
		// A failed convenience default must never fail the install.
		console.warn(`proper-base: could not seed settings.json: ${error}`);
	}
}
