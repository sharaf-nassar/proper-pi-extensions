import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmdirSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type BeforeAgentStartEvent,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_PROMPTS } from "./defaults.ts";

export const CONFIG_FILE = "proper-model-prompts.json";
export const SECTION = "proper_model_prompts";

export type Position = "prepend" | "append";

/** Pi's run modes: the terminal UI, RPC clients, JSON streams, and `pi -p`. */
const MODES = ["tui", "rpc", "json", "print"] as const;
export type Mode = (typeof MODES)[number];

export interface ModelPrompt {
	models: string[];
	position: Position;
	/** Run modes the prompt applies in; every mode when absent. */
	modes?: Mode[];
	text: string;
}

interface ModelRef {
	provider: string;
	id: string;
}

/** A configuration problem the user must fix; reported, never thrown to Pi. */
export class ConfigError extends Error {}

const ENTRY_KEYS = new Set(["models", "position", "modes", "text", "file"]);
const CONFIG_KEYS = new Set([
	"defaults",
	"offerForegroundSubagents",
	"prompts",
]);
// Path problems the user can fix; any other read failure is unexpected.
const PATH_ERRORS = new Set([
	"EACCES",
	"EISDIR",
	"ELOOP",
	"ENAMETOOLONG",
	"ENOTDIR",
	"EPERM",
]);
// Shared across duplicate module instances, so the first loaded copy of this
// extension owns each prompt build and a second copy stays silent.
const CLAIMED = Symbol.for("proper-model-prompts.claimed");

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// @lat: [[proper-model-prompts#Model matching]]
/**
 * `*` matches any run of characters, including `/`. Patterns are
 * case-insensitive and match either `provider/id` or the bare model id.
 */
export function matchesModel(pattern: string, model: ModelRef): boolean {
	const source = pattern
		.trim()
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join(".*");
	const regex = new RegExp(`^${source}$`, "i");
	return regex.test(`${model.provider}/${model.id}`) || regex.test(model.id);
}

const isExclusion = (pattern: string) => pattern.trim().startsWith("!");

/** One pattern matches and no `!` pattern does, whatever their order. */
export function selectsModel(patterns: string[], model: ModelRef): boolean {
	return (
		patterns.some((p) => !isExclusion(p) && matchesModel(p, model)) &&
		!patterns.some(
			(p) => isExclusion(p) && matchesModel(p.trim().slice(1), model),
		)
	);
}

/** Returns undefined for a missing file; other unreadable files are config errors. */
function readText(path: string, where: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return undefined;
		if (code && PATH_ERRORS.has(code))
			throw new ConfigError(`${where}: cannot read ${path} (${code})`);
		throw error;
	}
}

function readPromptFile(file: string, base: string, where: string): string {
	const path = file.startsWith("~/")
		? join(homedir(), file.slice(2))
		: resolve(base, file);
	const text = readText(path, where);
	if (text === undefined)
		throw new ConfigError(`${where}: cannot read ${path} (ENOENT)`);
	return text;
}

function parseEntry(entry: unknown, where: string, base: string): ModelPrompt {
	if (!isRecord(entry)) throw new ConfigError(`${where}: expected an object`);
	const unknown = Object.keys(entry).filter((key) => !ENTRY_KEYS.has(key));
	if (unknown.length > 0)
		throw new ConfigError(`${where}: unknown key ${unknown.join(", ")}`);
	const { models, position = "append", modes, text, file } = entry;
	if (
		!Array.isArray(models) ||
		models.length === 0 ||
		!models.every((model) => typeof model === "string" && model.trim())
	)
		throw new ConfigError(
			`${where}: models must be a non-empty list of model patterns`,
		);
	const exclusions = models.filter(isExclusion);
	if (exclusions.length === models.length)
		throw new ConfigError(`${where}: models needs a pattern without !`);
	if (exclusions.some((pattern) => !pattern.trim().slice(1).trim()))
		throw new ConfigError(`${where}: ! must be followed by a pattern`);
	if (position !== "prepend" && position !== "append")
		throw new ConfigError(`${where}: position must be "prepend" or "append"`);
	if (
		modes !== undefined &&
		(!Array.isArray(modes) ||
			modes.length === 0 ||
			!modes.every((mode) => MODES.includes(mode)))
	)
		throw new ConfigError(
			`${where}: modes must be a non-empty list of ${MODES.join(", ")}`,
		);
	if ((text === undefined) === (file === undefined))
		throw new ConfigError(`${where}: set exactly one of text or file`);
	if (text !== undefined && typeof text !== "string")
		throw new ConfigError(`${where}: text must be a string`);
	if (file !== undefined && (typeof file !== "string" || !file.trim()))
		throw new ConfigError(`${where}: file must be a path`);
	const body = (
		typeof file === "string" ? readPromptFile(file, base, where) : `${text}`
	).trim();
	if (!body) throw new ConfigError(`${where}: prompt text is empty`);
	return { models, position, ...(modes && { modes }), text: body };
}

interface Config {
	defaults?: boolean;
	offerForegroundSubagents?: boolean;
	prompts?: unknown[];
}

/** The file's top-level settings, or undefined when there is no file. */
function readConfig(path: string): Config | undefined {
	const source = readText(path, path);
	if (source === undefined) return undefined;
	let config: unknown;
	try {
		config = JSON.parse(source);
	} catch (error) {
		throw new ConfigError(`${path}: ${(error as SyntaxError).message}`);
	}
	const flags = (value: Record<string, unknown>) =>
		[value.defaults, value.offerForegroundSubagents].every(
			(flag) => flag === undefined || typeof flag === "boolean",
		);
	if (
		!isRecord(config) ||
		Object.keys(config).some((key) => !CONFIG_KEYS.has(key)) ||
		!flags(config) ||
		(config.prompts !== undefined && !Array.isArray(config.prompts))
	)
		throw new ConfigError(
			`${path}: expected an object with optional "defaults" (true or false), "offerForegroundSubagents" (true or false), and "prompts" (a list)`,
		);
	return config as Config;
}

// @lat: [[proper-model-prompts#Configuration]]
/**
 * The built-in prompts, unless the file sets `defaults` to false, followed by
 * the file's own prompts. A missing file means the built-in prompts only.
 */
export function loadPrompts(path: string): ModelPrompt[] {
	const config = readConfig(path);
	if (config === undefined) return [...DEFAULT_PROMPTS];
	const own = (config.prompts ?? []).map((entry, index) =>
		parseEntry(entry, `${path} prompts[${index}]`, dirname(path)),
	);
	return config.defaults === false ? own : [...DEFAULT_PROMPTS, ...own];
}

// @lat: [[proper-model-prompts#Run modes]]
export function promptsFor(
	prompts: ModelPrompt[],
	model: ModelRef,
	mode: Mode,
): ModelPrompt[] {
	return prompts.filter(
		(prompt) =>
			(!prompt.modes || prompt.modes.includes(mode)) &&
			selectsModel(prompt.models, model),
	);
}

const joinBlocks = (...parts: string[]) => parts.filter(Boolean).join("\n\n");

/**
 * True for the first caller on a prompt build. Pi creates fresh options for
 * every build, so the claim never outlives one prompt.
 */
export function claimBuild(options: object): boolean {
	const marked = options as { [CLAIMED]?: true };
	if (marked[CLAIMED]) return false;
	marked[CLAIMED] = true;
	return true;
}

// @lat: [[proper-model-prompts#Composition]]
/**
 * Appended text is always recorded as a structured section, so other
 * extensions' sections and Pi's prompt deltas keep working. Only a
 * whole-prompt replacement can put text before Pi's preamble, so prepending
 * uses one. Pi sends a replacement instead of the sections, so any replacement
 * also carries the appended text, and one made by an earlier extension is
 * extended in place instead of being discarded.
 */
export function applyPrompts(
	event: Pick<BeforeAgentStartEvent, "systemPrompt" | "systemPromptOptions">,
	prompts: ModelPrompt[],
): void {
	const options = event.systemPromptOptions;
	const text = (position: Position) =>
		prompts
			.filter((prompt) => prompt.position === position)
			.map((prompt) => prompt.text)
			.join("\n\n");
	const prepend = text("prepend");
	const append = text("append");
	const replaced = options.forceSystemPrompt;
	if (append) options.sections[SECTION] = append;
	if (replaced !== undefined) {
		const block = append && `<${SECTION}>\n${append}\n</${SECTION}>`;
		options.forceSystemPrompt = joinBlocks(prepend, replaced, block);
	} else if (prepend) {
		// Rendered after the section is set, so Pi's own text includes it.
		options.forceSystemPrompt = joinBlocks(prepend, event.systemPrompt);
	}
}

// The directory Pi loaded this package from, as pi-subagents should name it.
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const FOREGROUND_LIST = "subagents.defaultSubagentOnlyExtensions";
// Shared across duplicate module instances, so one offer is made per session.
const OFFERED = Symbol.for("proper-model-prompts.offered");

/** A settings.json problem the user can fix by editing the file themselves. */
class SetupError extends Error {}

function parseSettings(source: string): Record<string, unknown> {
	let settings: unknown;
	try {
		settings = JSON.parse(source.replace(/^\uFEFF/, ""));
	} catch {
		throw new SetupError("it is not valid JSON");
	}
	if (!isRecord(settings)) throw new SetupError("it is not a JSON object");
	return settings;
}

/**
 * Whether pi-subagents' foreground list names `dir` by an absolute or `~/`
 * path. Relative entries resolve against each child's working directory, so
 * they never count.
 */
function listsPackage(settings: Record<string, unknown>, dir: string): boolean {
	const subagents = settings.subagents;
	const list = isRecord(subagents)
		? subagents.defaultSubagentOnlyExtensions
		: undefined;
	if (!Array.isArray(list)) return false;
	const target = realpathSync(dir);
	return list.some((entry) => {
		if (typeof entry !== "string") return false;
		const path = entry.startsWith("~/")
			? join(homedir(), entry.slice(2))
			: entry;
		return (
			isAbsolute(path) && existsSync(path) && realpathSync(path) === target
		);
	});
}

/**
 * Pi guards settings.json with proper-lockfile, whose lock is a directory next
 * to the file. Taking the same lock keeps either write from being lost.
 */
function withSettingsLock(file: string, write: () => void): void {
	const lock = `${file}.lock`;
	for (let attempt = 1; ; attempt++) {
		try {
			mkdirSync(lock);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (attempt === 10)
				throw new SetupError("another Pi process has it locked");
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
		}
	}
	try {
		write();
	} finally {
		rmdirSync(lock);
	}
}

function addToForegroundList(settingsPath: string, dir: string): void {
	withSettingsLock(settingsPath, () => {
		const source = readText(settingsPath, settingsPath);
		const settings = source === undefined ? {} : parseSettings(source);
		const subagents = settings.subagents ?? {};
		const list = isRecord(subagents)
			? (subagents.defaultSubagentOnlyExtensions ?? [])
			: undefined;
		if (
			!isRecord(subagents) ||
			!Array.isArray(list) ||
			!list.every((entry) => typeof entry === "string")
		)
			throw new SetupError(`its ${FOREGROUND_LIST} is not a list of paths`);
		if (listsPackage(settings, dir)) return;
		settings.subagents = {
			...subagents,
			defaultSubagentOnlyExtensions: [...list, dir],
		};
		const end = source?.endsWith("\n") ? "\n" : "";
		writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}${end}`);
	});
}

const inside = (dir: string, parent: string) => {
	const path = relative(parent, dir);
	return path !== "" && !path.startsWith("..") && !isAbsolute(path);
};

/**
 * Whether Pi installed this copy for one project or one run. The global list
 * applies to every project, so only a personal install belongs in it. Pi puts
 * project npm and git installs under `.pi/npm` and `.pi/git`, and `pi -e`
 * sources under the agent directory's `tmp/extensions`.
 */
export function isScopedInstall(dir: string, agentDir: string): boolean {
	const parts = dir.split(sep);
	const managed = parts.some(
		(part, index) =>
			part === ".pi" &&
			(parts[index + 1] === "npm" || parts[index + 1] === "git"),
	);
	const personal = ["npm", "git"].some((kind) =>
		inside(dir, join(agentDir, kind)),
	);
	return (managed && !personal) || inside(dir, join(agentDir, "tmp"));
}

// @lat: [[proper-model-prompts#Foreground subagent offer]]
/**
 * Foreground pi-subagents children load only the extensions in the user's
 * foreground list. The first terminal session that finds pi-subagents without
 * this package in that list asks once: yes adds it, no is remembered in this
 * package's configuration. Nothing changes without an answer.
 */
async function offerForegroundSubagents(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	configPath: string,
	packageDir: string,
): Promise<void> {
	if (ctx.mode !== "tui") return;
	if (!pi.getAllTools().some((tool) => tool.name === "subagent")) return;
	const agentDir = dirname(configPath);
	if (isScopedInstall(realpathSync(packageDir), realpathSync(agentDir))) return;
	const root = globalThis as { [OFFERED]?: WeakSet<object> };
	if (!root[OFFERED]) root[OFFERED] = new WeakSet();
	const offered = root[OFFERED];
	if (offered.has(ctx.sessionManager)) return;
	offered.add(ctx.sessionManager);
	const settingsPath = join(agentDir, "settings.json");
	const manual = `add ${packageDir} to ${FOREGROUND_LIST} in ${settingsPath}`;
	try {
		if (readConfig(configPath)?.offerForegroundSubagents === false) return;
		const source = readText(settingsPath, settingsPath);
		const settings = source === undefined ? {} : parseSettings(source);
		if (listsPackage(settings, packageDir)) return;
	} catch (error) {
		// A broken file is reported when prompts load, or is Pi's to report.
		if (error instanceof ConfigError || error instanceof SetupError) return;
		throw error;
	}
	const accepted = await ctx.ui.confirm(
		"Load proper-model-prompts in foreground subagents?",
		`pi-subagents loads only the extensions listed in its ${FOREGROUND_LIST} setting into foreground subagents, so they don't get these prompts yet. Background subagents already do.\n\nYes adds this package to that list in ${settingsPath}. No stops this question.`,
	);
	try {
		if (accepted) {
			addToForegroundList(settingsPath, packageDir);
			ctx.ui.notify(
				`proper-model-prompts: added ${packageDir} to ${FOREGROUND_LIST} in ${settingsPath}.`,
				"info",
			);
		} else {
			const config = readConfig(configPath) ?? {};
			const declined = { ...config, offerForegroundSubagents: false };
			writeFileSync(configPath, `${JSON.stringify(declined, null, 2)}\n`);
			ctx.ui.notify(
				`proper-model-prompts: foreground subagents won't load it. To change that later, ${manual}.`,
				"info",
			);
		}
	} catch (error) {
		if (!(error instanceof ConfigError || error instanceof SetupError))
			throw error;
		const reason =
			error instanceof SetupError
				? `${settingsPath}: ${error.message}`
				: error.message;
		ctx.ui.notify(
			accepted
				? `proper-model-prompts: could not update ${reason}. To load it in foreground subagents, ${manual}.`
				: `proper-model-prompts: could not save your answer (${reason}), so it will ask again.`,
			"warning",
		);
	}
}

export default function properModelPrompts(
	pi: ExtensionAPI,
	configPath = join(getAgentDir(), CONFIG_FILE),
	packageDir = PACKAGE_DIR,
): void {
	const reported = new Set<string>();
	pi.on("session_start", async (_event, ctx) => {
		reported.clear();
		await offerForegroundSubagents(pi, ctx, configPath, packageDir);
	});
	// @lat: [[proper-model-prompts#Timing]]
	pi.on("before_agent_start", (event, ctx) => {
		if (!claimBuild(event.systemPromptOptions)) return;
		const model = ctx.model;
		if (!model) return;
		let prompts: ModelPrompt[];
		try {
			prompts = promptsFor(loadPrompts(configPath), model, ctx.mode);
		} catch (error) {
			if (!(error instanceof ConfigError)) throw error;
			if (!reported.has(error.message)) {
				reported.add(error.message);
				ctx.ui.notify(`proper-model-prompts: ${error.message}`, "error");
			}
			return;
		}
		if (prompts.length > 0) applyPrompts(event, prompts);
	});
}
