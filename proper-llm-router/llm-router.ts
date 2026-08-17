/**
 * llm-router pi extension — fully self-contained (2026-08-15).
 *
 * All routing lives HERE: judge call, CPA quota probe, backup-chain
 * resolution, exemplar few-shot. No python subprocess, no shim. Every
 * first input of a session (typed or slash command) is routed: the judge
 * picks an arm and the session switches to that cliproxyapi model.
 * Re-selecting llm-router/auto re-arms.
 *
 * Subagent children (pi-subagents) load this extension too: session_start
 * forces them back to llm-router/auto — clobbering the spawn's --model —
 * and their first input (the task) gets its own judge verdict. So every
 * child is routed per task; runs.run model= is a dead letter. To pin a
 * model on one spawn (e.g. retry a failed task on a stronger arm), the
 * parent prefixes the task with [[llm-router: <model>]]: parsed and
 * stripped in the input handler, quota-swap still applies. The convention
 * is advertised to the orchestrating LLM via a before_agent_start system
 * prompt suffix (skipped in leaf children, which cannot spawn).
 *
 * Config: ~/.pi/agent/llm-router.json (missing file/keys -> DEFAULTS),
 * editable in pi via /llm-router-config (model/effort pickers, JSON
 * editor, live judge test). Re-read on every routed prompt — no restart
 * needed. /llm-router switches the session back to llm-router/auto so
 * the next prompt gets routed.
 * {
 *   "judge": { "baseUrl": "...", "apiKeyEnv": "...", "model": "...",
 *              "effort": "medium" | null },   // any OpenAI-compatible
 *   "fallbackModel": "gpt-5.6-terra",         // used when the judge fails
 *   "cpaBase": "http://127.0.0.1:8317",       // arm availability probe
 *   "cpaKeyEnv": "ANTHROPIC_AUTH_TOKEN",
 *   "exemplarsPath": ".../exemplars.jsonl",   // optional few-shot corpus
 *   "quotaMaxPct": null,                      // gate: exclude arms >= this % used
 *   "cpaManagementKey": "",                   // plaintext; env fallback below
 *   "cpaManagementKeyEnv": "CPA_MANAGEMENT_KEY",
 *   "judgeModelOverrides": {                  // arm slot -> enabled CPA model
 *     "claude-fable-5": "another-enabled-model"
 *   },
 *   "commandPins": {                          // slash command -> fixed arm,
 *     "file": { "model": "claude-fable-5", "effort": "xhigh" }  // judge skipped
 *   }
 * }
 *
 * Quota: the judge is NEVER menu-filtered — it always sees all 7 slots.
 * Availability is checked after the verdict (probes run concurrently
 * with the judge call): CPA's /v1/models listing, plus — with
 * quotaMaxPct set and the CPA management key configured
 * (cpaManagementKey, or the env fallback) — per-account usage through
 * CPA's management api-call passthrough (claude: oauth/usage windows
 * incl. per-model 7d; codex: wham/usage used_percent). An out-of-quota
 * pick swaps to its fixed cross-harness partner (fable<->sol,
 * opus<->terra, sonnet->luna, haiku<->luna); both sides dead falls back
 * to fallbackModel. Usage is cached 60s; any probe failure skips the
 * threshold gate rather than blocking routing.
 * The judge needs strict json_schema response_format support; effort maps
 * to reasoning_effort (null for non-reasoning judges). Point judge.baseUrl
 * at another provider to keep routing when CPA is down.
 *
 * session_start forces fresh sessions back to llm-router/auto because pi
 * persists the last-set model as the default (LLM_ROUTER_OFF=1 disables).
 * llm-router/auto is a declarative placeholder in ~/.pi/agent/models.json;
 * no request should ever reach its endpoint — routing switches the session
 * before the agent loop runs.
 *
 * Env hooks kept from the python stack: JUDGE_EXEMPLARS=0 (skip few-shot),
 * CPA_MANAGEMENT_KEY (per-account min-auth checks),
 * CPA_SIMULATE_UNAVAILABLE="arm1,arm2" (test hook).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const PROVIDER = "llm-router";
const CPA_PROVIDER = "cliproxyapi";
const CONFIG_PATH = path.join(os.homedir(), ".pi/agent/llm-router.json");
const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface JudgeConfig {
	baseUrl: string;
	apiKeyEnv: string;
	model: string;
	effort: string | null;
}
// Pi 0.84.2 stops at max, while CLIProxyAPI already advertises ultra for
// supported GPT models. The compatibility patch below extends Pi's runtime
// list until core gains the same level natively.
export type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max"
	| "ultra";
export const THINKING_LEVELS: ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"ultra",
];

const ULTRA_SESSION_PATCH = Symbol.for("proper-llm-router.ultra-session-patch");
const ULTRA_THEME_PATCH = Symbol.for("proper-llm-router.ultra-theme-patch");

type UltraModel = {
	thinkingLevelMap?: Record<string, string | null | undefined>;
};
type UltraSession = {
	model?: UltraModel;
	getAvailableThinkingLevels(): string[];
	_clampThinkingLevel(level: string, available: string[]): string;
	[ULTRA_SESSION_PATCH]?: boolean;
};
type UltraTheme = {
	fg(color: string, text: string): string;
	getThinkingBorderColor(level: string): (text: string) => string;
	[ULTRA_THEME_PATCH]?: boolean;
};
type Constructor<T> = { prototype: T };

export function supportsUltraThinking(model: UltraModel | undefined): boolean {
	const mapped = model?.thinkingLevelMap?.ultra;
	return typeof mapped === "string" && mapped.trim().length > 0;
}

export function thinkingLevelsForModel(
	model: UltraModel | undefined,
): ThinkingLevel[] {
	return supportsUltraThinking(model)
		? THINKING_LEVELS
		: THINKING_LEVELS.filter((level) => level !== "ultra");
}

export function installUltraThinkingPrototype(
	Session: Constructor<UltraSession>,
): boolean {
	const prototype = Session.prototype;
	if (
		prototype[ULTRA_SESSION_PATCH] ||
		typeof prototype.getAvailableThinkingLevels !== "function" ||
		typeof prototype._clampThinkingLevel !== "function"
	) {
		return false;
	}

	const getAvailable = prototype.getAvailableThinkingLevels;
	const clamp = prototype._clampThinkingLevel;
	prototype.getAvailableThinkingLevels = function () {
		const levels = getAvailable.call(this);
		return supportsUltraThinking(this.model) && !levels.includes("ultra")
			? [...levels, "ultra"]
			: levels;
	};
	prototype._clampThinkingLevel = function (level, available) {
		if (level === "ultra" && !available.includes("ultra")) {
			return available.at(-1) ?? "off";
		}
		return clamp.call(this, level, available);
	};
	prototype[ULTRA_SESSION_PATCH] = true;
	return true;
}

export function installUltraThemePrototype(
	Theme: Constructor<UltraTheme>,
): boolean {
	const prototype = Theme.prototype;
	if (
		prototype[ULTRA_THEME_PATCH] ||
		typeof prototype.getThinkingBorderColor !== "function"
	) {
		return false;
	}

	const getBorderColor = prototype.getThinkingBorderColor;
	prototype.getThinkingBorderColor = function (level) {
		return level === "ultra"
			? (text) => this.fg("thinkingMax", text)
			: getBorderColor.call(this, level);
	};
	prototype[ULTRA_THEME_PATCH] = true;
	return true;
}

function hostPiDistDir(entry = process.argv[1]): string | undefined {
	if (!entry) return undefined;
	try {
		const dist = path.dirname(fs.realpathSync(entry));
		return fs.existsSync(path.join(dist, "core/agent-session.js"))
			? dist
			: undefined;
	} catch {
		return undefined;
	}
}

async function installUltraThinkingShim(): Promise<boolean> {
	const dist = hostPiDistDir();
	if (!dist) return false;
	try {
		const [sessionModule, themeModule] = await Promise.all([
			import(pathToFileURL(path.join(dist, "core/agent-session.js")).href),
			import(
				pathToFileURL(path.join(dist, "modes/interactive/theme/theme.js")).href
			),
		]);
		installUltraThinkingPrototype(sessionModule.AgentSession);
		installUltraThemePrototype(themeModule.Theme);
		return Boolean(
			sessionModule.AgentSession?.prototype?.[ULTRA_SESSION_PATCH] &&
				themeModule.Theme?.prototype?.[ULTRA_THEME_PATCH],
		);
	} catch {
		return false;
	}
}

export const ULTRA_THINKING_SHIM_INSTALLED = await installUltraThinkingShim();
export interface CommandPin {
	model: string; // arm key, CPA id, or unique fragment (resolveArm)
	effort: ThinkingLevel | null; // null = leave the session's thinking level
}
export interface Config {
	judge: JudgeConfig;
	fallbackModel: string;
	cpaBase: string;
	cpaKeyEnv: string;
	exemplarsPath: string;
	// exclude arms whose accounts have used >= this % of quota (null = off);
	// needs the CPA management key: cpaManagementKey, or exported under
	// cpaManagementKeyEnv as a fallback
	quotaMaxPct: number | null;
	cpaManagementKey: string;
	cpaManagementKeyEnv: string;
	// replace a judge arm's execution model while preserving that arm's
	// rubric use cases and stable schema selection key
	judgeModelOverrides: Record<string, string>;
	// slash commands routed without asking the judge (key = command name,
	// leading "/" optional). Quota swaps still apply to the pinned arm.
	commandPins: Record<string, CommandPin>;
}

const DEFAULTS: Config = {
	judge: {
		baseUrl: "http://127.0.0.1:8317/v1",
		apiKeyEnv: "ANTHROPIC_AUTH_TOKEN",
		model: "gpt-5.6-terra",
		effort: "medium",
	},
	fallbackModel: "gpt-5.6-terra",
	cpaBase: "http://127.0.0.1:8317",
	cpaKeyEnv: "ANTHROPIC_AUTH_TOKEN",
	exemplarsPath: path.join(EXTENSION_DIR, "exemplars.jsonl"),
	quotaMaxPct: null,
	cpaManagementKey: "",
	cpaManagementKeyEnv: "CPA_MANAGEMENT_KEY",
	judgeModelOverrides: {},
	commandPins: {
		file: { model: "claude-fable-5", effort: "xhigh" },
		triage: { model: "claude-fable-5", effort: "xhigh" },
		spec: { model: "claude-fable-5", effort: "xhigh" },
		"implement-ready": { model: "gpt-5-6-sol", effort: "xhigh" },
	},
};

function managementKey(cfg: Config): string {
	return cfg.cpaManagementKey || process.env[cfg.cpaManagementKeyEnv] || "";
}

async function validateManagementKey(
	cfg: Config,
): Promise<{ ok: boolean; detail: string }> {
	const key = managementKey(cfg);
	if (!key) return { ok: false, detail: "not set" };
	try {
		await fetchJson(
			`${cfg.cpaBase}/v0/management/auth-files`,
			{ headers: { Authorization: `Bearer ${key}` } },
			5_000,
		);
		return { ok: true, detail: "valid" };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return /^HTTP 40[13]/.test(msg)
			? { ok: false, detail: "invalid (rejected by CPA)" }
			: { ok: false, detail: `check failed: ${msg.slice(0, 60)}` };
	}
}

export function loadConfig(configPath = CONFIG_PATH): Config {
	try {
		const user = JSON.parse(fs.readFileSync(configPath, "utf8"));
		return {
			...DEFAULTS,
			...user,
			judge: { ...DEFAULTS.judge, ...(user.judge ?? {}) },
		};
	} catch {
		return DEFAULTS;
	}
}

export function saveConfig(cfg: Config): void {
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

// ---------------------------------------------------------------- arms
const ARMS: Record<string, { cpa: string }> = {
	"claude-haiku-4-5": { cpa: "claude-haiku-4-5-20251001" },
	"claude-sonnet-5": { cpa: "claude-sonnet-5" },
	"claude-opus-5": { cpa: "claude-opus-5" },
	"claude-fable-5": { cpa: "claude-fable-5" },
	"gpt-5-6-luna": { cpa: "gpt-5.6-luna" },
	"gpt-5-6-terra": { cpa: "gpt-5.6-terra" },
	"gpt-5-6-sol": { cpa: "gpt-5.6-sol" },
};
const CLAUDE_ARMS = new Set([
	"claude-haiku-4-5",
	"claude-sonnet-5",
	"claude-opus-5",
	"claude-fable-5",
]);
// Post-verdict quota swap: fixed cross-harness tier pairs. The judge is
// never menu-filtered; an out-of-quota pick swaps to its partner (both
// dead -> caller falls back). luna's return pair is haiku (cheap tier).
const SWAP: Record<string, string> = {
	"claude-fable-5": "gpt-5-6-sol",
	"gpt-5-6-sol": "claude-fable-5",
	"claude-opus-5": "gpt-5-6-terra",
	"gpt-5-6-terra": "claude-opus-5",
	"claude-sonnet-5": "gpt-5-6-luna",
	"claude-haiku-4-5": "gpt-5-6-luna",
	"gpt-5-6-luna": "claude-haiku-4-5",
};

// ---------------------------------------------------- sentinel override
// [[llm-router: <model>]] in a prompt pins the model instead of asking
// the judge. This is the per-spawn override channel for subagent tasks:
// the task string is the only value that reliably survives into the
// child's first input (env vars race across parallel children, and our
// session_start forcing clobbers pi-subagents' --model resolution).
export const SENTINEL_RE = /\[\[\s*llm-router\s*:\s*([^\]]+?)\s*\]\]/i;

/** Resolve a sentinel model name to an arm key. Accepts arm keys
 * ("gpt-5-6-sol"), CPA ids ("gpt-5.6-sol"), or any unique fragment
 * ("sol", "opus"); ambiguous or unknown -> null. Pure — see smoke.ts. */
export function resolveArm(name: string): string | null {
	const n = name.trim().toLowerCase().replace(/[\s.]/g, "-");
	if (ARMS[n]) return n;
	const hits = Object.keys(ARMS).filter(
		(arm) => arm.includes(n) || n.includes(arm),
	);
	return hits.length === 1 ? hits[0] : null;
}

// @lat: [[configuration#Judge model overrides]]
function judgeOverrides(cfg: Config): Map<string, string> {
	const overrides = new Map<string, string>();
	for (const [name, value] of Object.entries(cfg.judgeModelOverrides ?? {})) {
		const arm = resolveArm(name);
		const model = typeof value === "string" ? value.trim() : "";
		if (arm && model && model !== ARMS[arm].cpa) overrides.set(arm, model);
	}
	return overrides;
}

/** CPA model executed when the judge selects a stable arm slot. */
export function judgeCpaModel(cfg: Config, arm: string): string {
	return judgeOverrides(cfg).get(arm) ?? ARMS[arm]?.cpa ?? arm;
}

/** Replace arm labels in judge instructions while retaining stable schema
 * keys, so an arbitrary enabled CPA model inherits the original arm's
 * calibrated use cases without changing the verdict protocol. */
export function applyJudgeModelOverrides(
	cfg: Config,
	instructions: string,
): string {
	const overrides = judgeOverrides(cfg);
	if (!overrides.size) return instructions;
	const pattern = new RegExp(
		[...overrides.keys()]
			.sort((a, b) => b.length - a.length)
			.map((arm) => arm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join("|"),
		"g",
	);
	const replaced = instructions.replace(
		pattern,
		(arm) => `${overrides.get(arm)} [selection key: ${arm}]`,
	);
	return (
		"Model overrides are active. Each actual model below inherits the use cases " +
		"of its selection key. Return the selection key in JSON.\n\n" +
		replaced
	);
}

/** Extract the sentinel (if any) and the text with the marker removed.
 * Pure — see smoke.ts. */
export function parseSentinel(
	text: string,
): { name: string; stripped: string } | null {
	const m = SENTINEL_RE.exec(text);
	if (!m) return null;
	const before = text.slice(0, m.index);
	let after = text.slice(m.index + m[0].length);
	// collapse the seam so "Task: [[…]] fix X" strips to "Task: fix X"
	if (/\s$/.test(before)) after = after.replace(/^[ \t]+/, "");
	return { name: m[1], stripped: (before + after).trim() };
}

// ------------------------------------------------------- command pins
/** Fixed arm for a slash command, when configured — the judge is skipped
 * entirely (the pick is deterministic, so there is nothing to judge).
 * Config keys match with or without the leading "/", case-insensitively;
 * an unresolvable model name falls through to the judge. Pure — see
 * smoke.ts. */
export function commandPin(
	cfg: Config,
	text: string,
): { arm: string; effort: ThinkingLevel | null } | null {
	const m = /^\/([^\s]+)/.exec(text.trim());
	if (!m) return null;
	const want = m[1].toLowerCase();
	const hit = Object.entries(cfg.commandPins ?? {}).find(
		([k]) => k.replace(/^\//, "").toLowerCase() === want,
	);
	if (!hit) return null;
	const arm = resolveArm(hit[1].model);
	return arm ? { arm, effort: hit[1].effort ?? null } : null;
}

// Routing rubric (source of truth — calibrated against the measured
// llm-router-research corpus, subscription-r2 assembly).
const RUBRIC = `You are a routing judge for coding tasks in a quality-first setup.
Pick the cheapest model that fully handles the task WITHOUT quality loss;
escalate when scope is ambiguous or reasoning is deep.

  harness: claude (cheapest first) — repo/agentic lane
    - claude-haiku-4-5   (fast: narrow, well-reproduced repo fixes and
                          mechanical in-repo edits)
    - claude-sonnet-5    (balanced: routine multi-file work, test suites)
    - claude-opus-5      (powerful: cross-component diagnosis, high
                          blast-radius refactors)
    - claude-fable-5     (frontier: architecture, ambiguous scope)
  harness: codex (cheapest first) — self-contained/algorithmic lane
    - gpt-5-6-luna       (fast: trivial edits to code given in the prompt)
    - gpt-5-6-terra      (balanced: implementing well-specified functions,
                          endpoints, or classes from a clear spec)
    - gpt-5-6-sol        (powerful: hard algorithmic work, performance
                          optimization, tricky single-file logic)

Lane rule (measured, not stylistic): any task that requires working
inside an existing repository or project (bug fix, feature, tests,
refactor, "our X", named files) -> claude lane. On agentic repo tasks
the codex arms measured only 2-16% reliable vs 59-95% for claude arms.
The codex lane is ONLY for self-contained work where everything needed
is in the prompt itself: spec -> implementation, algorithm problems,
or edits to code pasted into the task.

Tier boundaries (apply in order, first match wins):
1. Concurrency/distributed correctness, protocol or migration design, or
   scope you cannot pin down from the prompt -> claude-fable-5.
2. Diagnosing behavior across components/services, or changes with high
   blast radius (auth, data loss, hot paths) -> claude-opus-5. Routine
   multi-file work with clear scope does NOT need opus (sonnet measured
   reliable on 82% of opus-passing tasks) -> claude-sonnet-5.
3. Repo bug fix or small feature with a clear reproduction/description
   and a localized likely cause -> claude-haiku-4-5 (measured reliable
   on 59% of agentic repo fixes, covering 77% of what sonnet passes).
   Vague report, several suspect areas, or touches tests+docs+code
   together -> claude-sonnet-5.
4. Self-contained single-file work where correctness is subtle
   (boundary conditions, complexity bounds, performance targets)
   -> gpt-5-6-sol.
5. Implementation fully specified and mechanical -> gpt-5-6-terra
   (or claude-sonnet-5 if it must integrate into a repo).
6. Mechanical one-line/one-symbol edits: inside a repo
   -> claude-haiku-4-5; on pasted/standalone code -> gpt-5-6-luna.

Tie-break: when torn between two adjacent tiers, ALWAYS pick the higher
tier (quality-first).
Reply with JSON only.`;

// ----------------------------------------------------------- exemplars
// Port of exemplars.py: TF-IDF cosine top-K measured-outcome few-shot,
// excluding near-identical matches (cosine > 0.95) so evals on corpus
// tasks don't get an answer key. Measured on gt_eval: +3 picked-passing,
// +2 exact-optimal.
interface Exemplar {
	prompt: string;
	rates: Record<string, number>;
}

function tokenize(text: string): string[] {
	return text.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [];
}

function termFreq(text: string): Map<string, number> {
	const tf = new Map<string, number>();
	for (const t of tokenize(text)) tf.set(t, (tf.get(t) ?? 0) + 1);
	return tf;
}

export class ExemplarIndex {
	rows: Exemplar[] = [];
	private vecs: Map<string, number>[] = [];
	private df = new Map<string, number>();

	constructor(jsonl: string) {
		for (const line of jsonl.split("\n")) {
			if (!line.trim()) continue;
			try {
				this.rows.push(JSON.parse(line) as Exemplar);
			} catch (e) {
				if (e instanceof SyntaxError)
					throw new SyntaxError(`invalid exemplar JSONL: ${e.message}`);
				throw e;
			}
		}
		for (const r of this.rows) {
			const tf = termFreq(r.prompt);
			this.vecs.push(tf);
			for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
		}
	}

	private tfidf(tf: Map<string, number>): Map<string, number> {
		const v = new Map<string, number>();
		let norm = 0;
		for (const [t, c] of tf) {
			const w = c * Math.log(this.rows.length / (1 + (this.df.get(t) ?? 0)));
			v.set(t, w);
			norm += w * w;
		}
		norm = Math.sqrt(norm) || 1;
		for (const [t, w] of v) v.set(t, w / norm);
		return v;
	}

	top(text: string, k = 3): Exemplar[] {
		const q = this.tfidf(termFreq(text));
		const scored = this.rows.map((row, i) => {
			const d = this.tfidf(this.vecs[i]);
			let cos = 0;
			for (const [t, w] of q) cos += w * (d.get(t) ?? 0);
			return { cos, row };
		});
		scored.sort((a, b) => b.cos - a.cos);
		// skip near-identical (answer key) and unrelated (misleading neighbors)
		return scored
			.filter((s) => s.cos >= 0.05 && s.cos <= 0.95)
			.slice(0, k)
			.map((s) => s.row);
	}
}

let exemplarIndex: ExemplarIndex | null | undefined; // undefined = not tried

export function exemplarNote(cfg: Config, task: string): string {
	if (process.env.JUDGE_EXEMPLARS === "0") return "";
	if (exemplarIndex === undefined) {
		try {
			exemplarIndex = new ExemplarIndex(
				fs.readFileSync(cfg.exemplarsPath, "utf8"),
			);
		} catch {
			exemplarIndex = null; // corpus absent: route without few-shot
		}
	}
	if (!exemplarIndex) return "";
	const lines = exemplarIndex.top(task).map((row) => {
		const head = row.prompt.split(/\s+/).join(" ").slice(0, 110);
		const outcome = Object.entries(row.rates)
			.sort((a, b) => b[1] - a[1])
			.map(([a, s]) => `${a} ${s === 1.0 ? "PASS" : s > 0 ? "flaky" : "FAIL"}`)
			.join(", ");
		return `- similar past task (${head}...): ${outcome}`;
	});
	if (!lines.length) return "";
	return (
		"\nMeasured verifier outcomes on similar past tasks (PASS = reliable, weigh heavily):\n" +
		lines.join("\n")
	);
}

// --------------------------------------------------------------- quota
// Port of cpa_quota.py. CPA hides a model from /v1/models once no account
// serves it, so listed == at least one account has quota.
async function fetchJson(
	url: string,
	init: RequestInit = {},
	timeoutMs = 10_000,
	signal?: AbortSignal,
): Promise<any> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), timeoutMs);
	try {
		const sig = signal ? AbortSignal.any([ctl.signal, signal]) : ctl.signal;
		const res = await fetch(url, { ...init, signal: sig });
		const text = await res.text();
		// fetch resolves on HTTP errors; a 401/500 JSON body must not be
		// mistaken for data (an empty auth-count map would zero every arm)
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
		return JSON.parse(text);
	} finally {
		clearTimeout(timer);
	}
}

// ---------------------------------------------------- quota threshold
// CPA's management API can call the upstream provider usage endpoints
// with each stored credential (POST /api-call; CPA substitutes $TOKEN$).
// Claude accounts report per-window utilization percentages (five_hour,
// seven_day, plus per-model 7d windows); codex accounts report
// used_percent per rate-limit window. All values are 0-100 (they feed
// the management panel's percent meters directly).
const CLAUDE_WINDOW_ARMS: Record<string, string> = {
	seven_day_opus: "claude-opus-5",
	seven_day_sonnet: "claude-sonnet-5",
	iguana_necktie: "claude-fable-5", // CPA panel maps this key to "seven-day-fable"
};
// The window objects above are often null; the authoritative per-model
// percentages live in the limits[] array, scoped by model display name
// (probed live 2026-08-15: weekly_scoped percent=85 scope.model "Fable").
const CLAUDE_MODEL_ARMS: Record<string, string> = {
	fable: "claude-fable-5",
	opus: "claude-opus-5",
	sonnet: "claude-sonnet-5",
	haiku: "claude-haiku-4-5",
};

export interface AccountUsage {
	type: "claude" | "codex";
	general: number; // max % used across the account-wide windows
	models: Record<string, number>; // arm -> % used in its model window
}

class UpstreamRateLimitError extends Error {}

function apiCallBody(resp: any): any {
	const code = Number(resp?.status_code ?? 0);
	if (code === 429) throw new UpstreamRateLimitError("api-call upstream 429");
	if (code < 200 || code >= 300) throw new Error(`api-call upstream ${code}`);
	const body = resp?.body;
	if (typeof body !== "string") return body;
	try {
		return JSON.parse(body);
	} catch (e) {
		if (e instanceof SyntaxError)
			throw new SyntaxError(`invalid api-call JSON body: ${e.message}`);
		throw e;
	}
}

async function accountUsages(cfg: Config): Promise<AccountUsage[] | null> {
	const key = managementKey(cfg);
	if (!key) return null;
	const mgmt = `${cfg.cpaBase}/v0/management`;
	const headers = {
		Authorization: `Bearer ${key}`,
		"Content-Type": "application/json",
	};
	const files = (await fetchJson(`${mgmt}/auth-files`, { headers })).files ?? [];
	const active = files.filter(
		(f: any) =>
			!f.disabled &&
			!f.unavailable &&
			(f.provider === "claude" || f.provider === "codex"),
	);
	const usages = await Promise.all(
		active.map(async (f: any): Promise<AccountUsage | null> => {
			const call = (url: string, extra: Record<string, string> = {}) =>
				fetchJson(`${mgmt}/api-call`, {
					method: "POST",
					headers,
					body: JSON.stringify({
						auth_index: f.auth_index,
						method: "GET",
						url,
						header: {
							Authorization: "Bearer $TOKEN$",
							"Content-Type": "application/json",
							...extra,
						},
					}),
				});
			try {
				if (f.provider === "claude") {
					const body = apiCallBody(
						await call("https://api.anthropic.com/api/oauth/usage", {
							"anthropic-beta": "oauth-2025-04-20",
						}),
					);
					let general = 0;
					const models: Record<string, number> = {};
					for (const [k, v] of Object.entries(body ?? {})) {
						const u = (v as any)?.utilization;
						if (typeof u !== "number") continue;
						const arm = CLAUDE_WINDOW_ARMS[k];
						if (arm) models[arm] = Math.max(models[arm] ?? 0, u);
						else if (k === "five_hour" || k === "seven_day")
							general = Math.max(general, u);
					}
					// limits[]: authoritative per-model weekly percentages;
					// unscoped entries (session, weekly_all) feed general
					for (const lim of Array.isArray(body?.limits) ? body.limits : []) {
						const pct = lim?.percent;
						if (typeof pct !== "number") continue;
						const arm =
							CLAUDE_MODEL_ARMS[(lim?.scope?.model?.display_name ?? "").toLowerCase()];
						if (arm) models[arm] = Math.max(models[arm] ?? 0, pct);
						else if (!lim?.scope) general = Math.max(general, pct);
					}
					return { type: "claude", general, models };
				}
				const body = apiCallBody(
					await call("https://chatgpt.com/backend-api/wham/usage"),
				);
				// live shape: rate_limit.{primary,secondary}_window.used_percent
				// (rate_limits kept as a fallback for other CPA versions)
				let general = 0;
				for (const w of Object.values(
					body?.rate_limit ?? body?.rate_limits ?? {},
				)) {
					const u = (w as any)?.used_percent ?? (w as any)?.usedPercent;
					if (typeof u === "number") general = Math.max(general, u);
				}
				return { type: "codex", general, models: {} };
			} catch (e) {
				if (e instanceof UpstreamRateLimitError)
					return { type: f.provider, general: 100, models: {} };
				return null; // one unknown account failure never blocks routing
			}
		}),
	);
	const ok = usages.filter(Boolean) as AccountUsage[];
	return ok.length ? ok : null;
}

// usage moves slowly; don't pay ~5 upstream calls on every routed prompt
let quotaCache: { at: number; usages: AccountUsage[] | null } | undefined;
const QUOTA_CACHE_MS = 60_000;

async function cachedAccountUsages(
	cfg: Config,
): Promise<AccountUsage[] | null> {
	if (!quotaCache || Date.now() - quotaCache.at > QUOTA_CACHE_MS) {
		let usages: AccountUsage[] | null = null;
		try {
			usages = await accountUsages(cfg);
		} catch {
			// management API unreachable/unauthorized: gate skips, routing lives
		}
		quotaCache = { at: Date.now(), usages };
	}
	return quotaCache.usages;
}

/** Arms whose AVERAGE usage across the lane's accounts is >= maxPct
 * (two keys at 100 and 80 -> 90). An account's effective % for an arm
 * is the worse of its account-wide and arm-specific windows. Pure —
 * see smoke.ts. */
export function quotaBlockedArms(
	usages: AccountUsage[],
	maxPct: number,
): Set<string> {
	const blocked = new Set<string>();
	for (const arm of Object.keys(ARMS)) {
		const type = CLAUDE_ARMS.has(arm) ? "claude" : "codex";
		const accounts = usages.filter((u) => u.type === type);
		if (!accounts.length) continue; // no data for this lane: don't block
		const avg =
			accounts.reduce((s, u) => s + Math.max(u.general, u.models[arm] ?? 0), 0) /
			accounts.length;
		if (avg >= maxPct) blocked.add(arm);
	}
	return blocked;
}

export interface ArmStatus {
	available: boolean;
	auths: number | null;
}

export async function armAvailability(
	cfg: Config,
	modelIds: Record<string, string> = {},
): Promise<Record<string, ArmStatus>> {
	const key = process.env[cfg.cpaKeyEnv] ?? "";
	const models = await fetchJson(`${cfg.cpaBase}/v1/models`, {
		headers: { Authorization: `Bearer ${key}` },
	});
	const listed = new Set<string>(
		(models.data ?? []).map((m: { id: string }) => m.id),
	);

	let authCounts: Map<string, number> | null = null;
	const mgmtKey = managementKey(cfg);
	if (mgmtKey) {
		try {
			const perAuth = await fetchJson(
				`${cfg.cpaBase}/v0/management/auth-files/models`,
				{
					headers: { Authorization: `Bearer ${mgmtKey}` },
				},
			);
			authCounts = new Map();
			for (const entry of Array.isArray(perAuth)
				? perAuth
				: (perAuth.data ?? [])) {
				for (const mid of entry.models ?? []) {
					const id = typeof mid === "object" ? mid.id : mid;
					authCounts.set(id, (authCounts.get(id) ?? 0) + 1);
				}
			}
		} catch {
			authCounts = null; // mgmt API optional — fall back to listing only
		}
	}

	// quota-threshold gate: arms whose accounts have used >= quotaMaxPct
	// are treated as unavailable, exactly like a quota-exceeded arm
	let overQuota = new Set<string>();
	if (cfg.quotaMaxPct != null) {
		const usages = await cachedAccountUsages(cfg);
		if (usages) overQuota = quotaBlockedArms(usages, cfg.quotaMaxPct);
	}

	const simulated = new Set(
		(process.env.CPA_SIMULATE_UNAVAILABLE ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
	const out: Record<string, ArmStatus> = {};
	for (const [arm, spec] of Object.entries(ARMS)) {
		const model = modelIds[arm] ?? spec.cpa;
		const auths = authCounts?.get(model) ?? (authCounts ? 0 : null);
		let ok = listed.has(model);
		if (auths !== null) ok = ok && auths >= 1;
		const quotaArm = resolveArm(model);
		if ((quotaArm && overQuota.has(quotaArm)) || simulated.has(arm)) ok = false;
		out[arm] = { available: ok, auths };
	}
	return out;
}

/** Post-verdict check: keep the pick if it has quota, else its swap
 * partner; both dead throws (caller falls back). Pure — see smoke.ts. */
export function resolveVerdictModel(
	model: string,
	avail: Record<string, ArmStatus>,
): { final: string; swapped: boolean } {
	if (avail[model]?.available) return { final: model, swapped: false };
	const partner = SWAP[model];
	if (avail[partner]?.available) return { final: partner, swapped: true };
	throw new Error(`${model} and swap partner ${partner} are both out of quota`);
}

// --------------------------------------------------------------- judge
export interface Verdict {
	harness: string;
	model: string;
	rationale: string;
	cpa_model: string;
	latency_s: number;
	swapped_from?: string;
	overridden_from?: string;
	arms_out_of_quota?: string[];
	quota_gate_skipped?: boolean; // threshold set but no usage data (bad key?)
}

async function judgeCall(
	cfg: Config,
	instructions: string,
	task: string,
	menu: string[],
	signal?: AbortSignal,
): Promise<any> {
	const schema = {
		type: "object",
		properties: {
			harness: { type: "string", enum: ["claude", "codex"] },
			model: { type: "string", enum: menu },
			rationale: { type: "string", maxLength: 500 },
		},
		required: ["harness", "model", "rationale"],
		additionalProperties: false,
	};
	const body: Record<string, unknown> = {
		model: cfg.judge.model,
		messages: [
			{ role: "system", content: instructions },
			{ role: "user", content: task.slice(0, 4000) },
		],
		response_format: {
			type: "json_schema",
			json_schema: { name: "routing_verdict", strict: true, schema },
		},
	};
	if (cfg.judge.effort) body.reasoning_effort = cfg.judge.effort;
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	const key = process.env[cfg.judge.apiKeyEnv] ?? "";
	if (key) headers.Authorization = `Bearer ${key}`;

	let last = "";
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const resp = await fetchJson(
				`${cfg.judge.baseUrl.replace(/\/+$/, "")}/chat/completions`,
				{ method: "POST", headers, body: JSON.stringify(body) },
				60_000,
				signal,
			);
			const text = resp?.choices?.[0]?.message?.content;
			if (text) return JSON.parse(text);
			last = JSON.stringify(resp).slice(0, 200);
		} catch (e) {
			// user cancellation must not burn the retry
			if (signal?.aborted) throw new Error("judge cancelled");
			last = `transport: ${e}`;
		}
	}
	throw new Error(
		`judge ${cfg.judge.model} returned no verdict twice (last: ${last})`,
	);
}

/** Routing verdict for one task. The judge always sees seven stable slots;
 * configured targets replace their prompt labels and execution CPA IDs.
 * Quota is checked after the verdict and can swap to a partner slot. */
export async function route(
	cfg: Config,
	task: string,
	signal?: AbortSignal,
): Promise<Verdict> {
	const instructions = applyJudgeModelOverrides(
		cfg,
		RUBRIC + exemplarNote(cfg, task),
	);
	const modelIds = Object.fromEntries(
		Object.keys(ARMS).map((arm) => [arm, judgeCpaModel(cfg, arm)]),
	);
	const t0 = Date.now();
	// availability probes run while the judge thinks
	const [verdict, avail] = await Promise.all([
		judgeCall(cfg, instructions, task, Object.keys(ARMS), signal),
		armAvailability(cfg, modelIds),
	]);
	verdict.latency_s = Math.round((Date.now() - t0) / 100) / 10;

	const { final, swapped } = resolveVerdictModel(verdict.model, avail);
	if (swapped) {
		verdict.swapped_from = verdict.model;
		verdict.model = final;
		verdict.harness = CLAUDE_ARMS.has(final) ? "claude" : "codex";
	}
	const cpaModel = modelIds[final];
	if (cpaModel !== ARMS[final].cpa) {
		verdict.overridden_from = final;
		verdict.model = cpaModel;
		const targetArm = resolveArm(cpaModel);
		if (targetArm)
			verdict.harness = CLAUDE_ARMS.has(targetArm) ? "claude" : "codex";
	}
	verdict.cpa_model = cpaModel;
	const down = Object.keys(avail)
		.filter((a) => !avail[a].available)
		.sort();
	if (down.length) verdict.arms_out_of_quota = down;
	// cached: free second call — flags a configured-but-inactive gate
	if (cfg.quotaMaxPct != null && !(await cachedAccountUsages(cfg))) {
		verdict.quota_gate_skipped = true;
	}
	return verdict as Verdict;
}

// ----------------------------------------------------------- extension
// notice colors (pi-tui renders ANSI in notify text; \x1b[39m/22 reset
// only what we set, so pi's own notify styling survives around it)
const fgc = (c: number, s: string) => `\x1b[${c}m${s}\x1b[39m`;
const green = (s: string) => fgc(32, s);
const yellow = (s: string) => fgc(33, s);
const cyan = (s: string) => fgc(36, s);
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;

/** Apply the quota gate to an already-decided arm (sentinel or command
 * pin): swap to the partner when it is out of quota, and — probe down or
 * both sides dead — keep the pick with a visible notice rather than
 * blocking the prompt. Returns the arm plus a notice suffix. */
async function quotaFinal(
	cfg: Config,
	arm: string,
): Promise<{ final: string; extra: string }> {
	try {
		const r = resolveVerdictModel(arm, await armAvailability(cfg));
		return {
			final: r.final,
			extra: r.swapped ? yellow(` (swapped from ${arm}: no quota)`) : "",
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			final: arm,
			extra: yellow(` [quota check skipped: ${msg.slice(0, 60)}]`),
		};
	}
}

export default function (pi: ExtensionAPI) {
	let routed = false;

	function findCpaModel(ctx: ExtensionContext, id: string) {
		return (
			ctx.modelRegistry.find(CPA_PROVIDER, id) ??
			ctx.modelRegistry
				.getAll()
				.find((m) => m.provider === CPA_PROVIDER && m.id.startsWith(`${id}-`))
		);
	}

	pi.on("session_start", async (event, ctx) => {
		routed = false;
		if (process.env.LLM_ROUTER_OFF === "1") return;
		if (event.reason === "startup" || event.reason === "new") {
			if (ctx.model?.provider !== PROVIDER) {
				const auto = ctx.modelRegistry.find(PROVIDER, "auto");
				if (auto) await pi.setModel(auto);
			}
		}
	});

	pi.on("model_select", (event) => {
		if (event.model?.provider === PROVIDER) routed = false; // re-armed
	});

	// Advertise the sentinel to the orchestrating LLM. Children spawned by
	// pi-subagents re-route through the judge (our session_start forcing
	// wins over the spawn's --model), so runs.run model= silently does
	// nothing — the task-text sentinel is the only per-spawn override that
	// survives, and the model only uses conventions it can see. Skipped in
	// leaf children (PI_SUBAGENT_CHILD without fanout): they cannot spawn,
	// the paragraph would be dead text in their system prompt.
	const SENTINEL_HELP =
		"## Subagent model override (llm-router)\n" +
		"Spawned subagents are model-routed automatically per task; a model= option in the " +
		"spawn call is ignored. To pin a model on one spawn (e.g. retrying a failed task on " +
		'a stronger model), prefix that task string with "[[llm-router: <model>]]", e.g. ' +
		'task: "[[llm-router: claude-opus-5]] Fix the race in …". The marker is stripped ' +
		"before the child sees it. Models, weakest to strongest: repo/agentic work — " +
		"claude-haiku-4-5, claude-sonnet-5, claude-opus-5, claude-fable-5; self-contained/" +
		"algorithmic work — gpt-5.6-luna, gpt-5.6-terra, gpt-5.6-sol.";
	pi.on("before_agent_start", (event) => {
		if (process.env.LLM_ROUTER_OFF === "1") return;
		if (
			process.env.PI_SUBAGENT_CHILD === "1" &&
			process.env.PI_SUBAGENT_FANOUT_CHILD !== "1"
		)
			return;
		return { systemPrompt: `${event.systemPrompt}\n\n${SENTINEL_HELP}` };
	});

	// Route the FIRST input of a session — typed prompt or slash command —
	// before the agent loop, and switch the session so the reply streams
	// natively from the routed model, the footer shows it, and workflow
	// children inherit it. llm-router/auto must never serve a request.
	pi.on("input", async (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER || routed) return { action: "continue" };
		if (!event.text.trim()) return { action: "continue" };

		// our own commands (/llm-router, /llm-router-config) are pure UI —
		// never route or switch on them
		if (/^\/llm-router\b/.test(event.text)) return { action: "continue" };

		const cfg = loadConfig();
		// pinned slash command (/file, /implement-ready, …): the model is
		// configured, so skip the judge entirely — but keep the quota swap
		// so a dead arm still degrades to its partner
		const pin = commandPin(cfg, event.text);
		if (pin) {
			const { final, extra } = await quotaFinal(cfg, pin.arm);
			const model = findCpaModel(ctx, ARMS[final].cpa);
			if (model && (await pi.setModel(model))) {
				routed = true;
				// after setModel: pi clamps the level to the new model
				// (older pi has no setThinkingLevel — pin the model anyway)
				if (pin.effort && typeof pi.setThinkingLevel === "function")
					(pi.setThinkingLevel as unknown as (level: string) => void)(pin.effort);
				const eff = pin.effort ? dim(` @${pin.effort}`) : "";
				ctx.ui.notify(
					`llm-router: ${cyan(final)}${eff} ${dim("(pinned command)")}${extra}`,
					"info",
				);
				return { action: "continue" };
			}
			ctx.ui.notify(
				`llm-router: pinned model ${ARMS[final].cpa} not switchable — routing normally`,
				"error",
			);
		}

		// bare slash command: no task text to judge — switch to the fallback
		// so nothing ever reaches the llm-router/auto placeholder endpoint
		if (/^\/\S+\s*$/.test(event.text)) {
			const fb = findCpaModel(ctx, cfg.fallbackModel);
			if (fb && (await pi.setModel(fb))) {
				routed = true;
				ctx.ui.notify(
					`llm-router: bare command, no task to judge — using ${cfg.fallbackModel}`,
					"info",
				);
			}
			return { action: "continue" };
		}

		// [[llm-router: <model>]] — forced pick from the spawning session
		// (or the user): honor it instead of consulting the judge, but keep
		// the post-verdict quota swap so a dead arm degrades to its partner
		// instead of failing a retry the same way. Unknown names fall
		// through to the judge; the marker is stripped either way.
		const sentinel = parseSentinel(event.text);
		if (sentinel) {
			const arm = resolveArm(sentinel.name);
			if (!arm) {
				ctx.ui.notify(
					yellow(
						`llm-router: unknown forced model "${sentinel.name}" — asking the judge instead`,
					),
					"warning",
				);
			} else {
				// forced means forced: a down probe degrades to an ungated
				// switch with a notice, never to a blocked prompt
				const { final, extra } = await quotaFinal(cfg, arm);
				const forced = findCpaModel(ctx, ARMS[final].cpa);
				if (forced && (await pi.setModel(forced))) {
					routed = true;
					ctx.ui.notify(
						`llm-router: ${cyan(final)} ${dim("(forced)")}${extra}`,
						"info",
					);
					return {
						action: "transform",
						text: sentinel.stripped,
						images: event.images,
					};
				}
				ctx.ui.notify(
					`llm-router: forced model ${ARMS[final].cpa} not switchable — asking the judge instead`,
					"error",
				);
			}
		}
		const taskText = sentinel ? sentinel.stripped : event.text;
		ctx.ui.notify(
			green(`llm-router: asking ${cfg.judge.model} which model fits this task…`),
			"info",
		);
		// Esc while the judge is consulted aborts the request and swallows
		// the prompt entirely — session stays unrouted, next prompt re-routes
		const cancel = new AbortController();
		const offEsc =
			typeof ctx.ui.onTerminalInput === "function"
				? ctx.ui.onTerminalInput((data: string) => {
						if (data !== "\x1b") return undefined;
						cancel.abort();
						return { consume: true };
					})
				: undefined;
		let targetId = cfg.fallbackModel;
		let note: string;
		let failed = false;
		try {
			const v = await route(cfg, taskText, cancel.signal);
			targetId = v.cpa_model;
			// clean pick: neutral, model in cyan; swap: model + clause in
			// amber — a subtle warning, not an error. Rationale is capped
			// instead of slicing the composed string (ANSI-safe).
			const rat =
				v.rationale.length > 150 ? `${v.rationale.slice(0, 149)}…` : v.rationale;
			const picked = v.swapped_from ? yellow(v.model) : cyan(v.model);
			const swap = v.swapped_from
				? yellow(` (swapped from ${v.swapped_from}: no quota)`)
				: "";
			const override = v.overridden_from
				? dim(` (override for ${v.overridden_from})`)
				: "";
			const gate = v.quota_gate_skipped
				? yellow(" [quota gate SKIPPED — check management key]")
				: "";
			note = `llm-router: ${picked}${swap}${override}${gate} ${dim(`(${v.latency_s}s)`)} — ${rat}`;
		} catch (e) {
			if (cancel.signal.aborted) {
				// finally still unsubscribes before this returns
				ctx.ui.notify(
					yellow("llm-router: judge cancelled — prompt discarded"),
					"info",
				);
				return { action: "handled" };
			}
			failed = true;
			note =
				`llm-router failed (${e instanceof Error ? e.message : e}); falling back to ${cfg.fallbackModel}`.slice(
					0,
					220,
				);
		} finally {
			offEsc?.();
		}

		const model =
			findCpaModel(ctx, targetId) ?? findCpaModel(ctx, cfg.fallbackModel);
		if (model && (await pi.setModel(model))) {
			routed = true;
			ctx.ui.notify(note, failed ? "error" : "info");
		} else {
			ctx.ui.notify(`${note} (no switchable cliproxyapi model found!)`, "error");
		}
		return sentinel
			? { action: "transform", text: sentinel.stripped, images: event.images }
			: { action: "continue" };
	});

	// green ✓ for the currently-configured entry; \x1b[39m resets only the
	// foreground so the select row's own styling survives (pi-tui renders
	// ANSI in item strings — same pattern piolium uses)
	const CHECK = " \x1b[32m✓\x1b[39m";
	const stripCheck = (s: string) =>
		s.endsWith(CHECK) ? s.slice(0, -CHECK.length) : s;

	// Masked single-line prompt for secrets (ctx.ui.custom component:
	// render(width) + handleInput(data), done(value) closes). Renders
	// bullets only; supports typing, backspace, bracketed paste.
	// Resolves undefined on esc/ctrl-c.
	function maskedInput(
		ctx: ExtensionContext,
		title: string,
	): Promise<string | undefined> {
		if (typeof ctx.ui.custom !== "function") {
			return ctx.ui.editor(title, ""); // older pi: visible fallback
		}
		return ctx.ui.custom(
			(tui: any, theme: any, _kb: any, done: (v: string | undefined) => void) => {
				let value = "";
				return {
					invalidate() {},
					// pi-tui aborts if a rendered line exceeds the terminal —
					// clip every line to the width we're given (content is
					// clipped BEFORE styling, so no ANSI-aware measuring needed)
					render(width: number): string[] {
						const w = Math.max(10, Math.floor(width) || 80);
						const clip = (s: string) => (s.length > w ? `${s.slice(0, w - 1)}…` : s);
						const dots = Math.max(0, Math.min(value.length, w - 3));
						return [
							theme.fg("accent", clip(title)),
							"",
							clip("  " + "•".repeat(dots)) + theme.fg("dim", "▏"),
							"",
							theme.fg("dim", clip("  enter save · esc cancel · empty clears")),
						];
					},
					handleInput(data: string): void {
						if (data === "\r" || data === "\n") return done(value);
						if (data === "\x1b" || data === "\x03") return done(undefined);
						if (data === "\x7f" || data === "\b") value = value.slice(0, -1);
						else if (data.startsWith("\x1b[200~"))
							value += data
								.slice(6)
								.split("\x1b[201~")
								.join("")
								.replace(/[\x00-\x1f\x7f]/g, "");
						else if (!data.startsWith("\x1b"))
							value += data.replace(/[\x00-\x1f\x7f]/g, "");
						// other \x1b… sequences (arrows etc.): ignored
						tui.requestRender();
					},
				};
			},
		);
	}

	// /llm-router: switch the session back to llm-router/auto — the next
	// prompt gets routed again (model_select re-arms, but set routed
	// directly too in case setModel doesn't echo an event).
	pi.registerCommand("llm-router", {
		description:
			"Switch this session to llm-router/auto (next prompt gets routed)",
		handler: async (_args: string, ctx: ExtensionContext) => {
			const auto = ctx.modelRegistry.find(PROVIDER, "auto");
			if (auto && (await pi.setModel(auto))) {
				routed = false;
				ctx.ui.notify("llm-router: active — next prompt picks the model", "info");
			} else {
				ctx.ui.notify(
					"llm-router: llm-router/auto not found in model registry",
					"error",
				);
			}
		},
	});

	// /llm-router-config: configure the router inside pi. Persists to
	// CONFIG_PATH; routing re-reads the file per prompt, so changes apply
	// immediately.
	pi.registerCommand("llm-router-config", {
		description:
			"Configure llm-router: judge provider/model/effort, fallback; test the judge",
		handler: async (_args: string, ctx: ExtensionContext) => {
			if (!ctx.hasUI) return;
			// key validity: the select title is static once shown, so give
			// the probe a 400ms head start — local CPA answers in ms, so the
			// first render normally shows the real status. Only a slow/down
			// CPA leaves "checking…", and then the result lands as a notify
			// (the title catches up on the next action's re-render).
			let keyNote = "checking…";
			let menuOpen = false;
			const refreshKeyStatus = () => {
				keyNote = "checking…";
				return validateManagementKey(loadConfig()).then((r) => {
					keyNote = r.ok
						? "\x1b[32m✓ valid\x1b[39m"
						: `\x1b[31m✗ ${r.detail}\x1b[39m`;
					if (menuOpen) {
						ctx.ui.notify(
							`llm-router: management key ${r.detail}`,
							r.ok ? "info" : "error",
						);
					}
				});
			};
			await Promise.race([
				refreshKeyStatus(),
				new Promise((r) => setTimeout(r, 400)),
			]);
			menuOpen = true;
			for (;;) {
				const cfg = loadConfig();
				const summary =
					`judge: ${cfg.judge.model}@${cfg.judge.effort ?? "no-effort"} via ${cfg.judge.baseUrl}\n` +
					`fallback: ${cfg.fallbackModel}` +
					` | quota gate: ${cfg.quotaMaxPct == null ? "off" : `${cfg.quotaMaxPct}%`}` +
					` | key: ${keyNote}` +
					` | overrides: ${judgeOverrides(cfg).size}` +
					` | pinned commands: ${Object.keys(cfg.commandPins ?? {}).length}`;
				let action = await ctx.ui.select(`llm-router config\n${summary}`, [
					"Judge",
					"Pinned commands",
					"Quota threshold",
					"CPA management key",
					"Edit full config (JSON)",
					"Test judge",
					"Done",
				]);
				if (!action || action === "Done") return;
				if (action === "Judge") {
					const judgeAction = await ctx.ui.select("Judge settings", [
						"Model",
						"Effort",
						"Overrides",
					]);
					if (!judgeAction) continue;
					action = `Judge ${judgeAction.toLowerCase()}`;
				}

				if (action === "Judge model") {
					let ids: string[] = [];
					try {
						const key = process.env[cfg.judge.apiKeyEnv] ?? "";
						const models = await fetchJson(
							`${cfg.judge.baseUrl.replace(/\/+$/, "")}/models`,
							{
								headers: key ? { Authorization: `Bearer ${key}` } : {},
							},
						);
						ids = (models.data ?? []).map((m: { id: string }) => m.id).sort();
					} catch {
						// provider unreachable: fall through to manual entry
					}
					// only offer the arm models the router is calibrated on; a
					// non-CPA provider (no arm ids in its listing) keeps its full
					// catalog, and "(enter manually)" always allows any id
					const armIds = new Set(Object.values(ARMS).map((a) => a.cpa));
					const armOnly = ids.filter((id) => armIds.has(id));
					if (armOnly.length) ids = armOnly;
					// "id [provider]" like /model: pi registry provider when the id
					// is registered there, else the judge endpoint's host
					const providerOf = new Map<string, string>(
						ctx.modelRegistry.getAll().map((m) => [m.id, m.provider]),
					);
					let host = "judge endpoint";
					try {
						host = new URL(cfg.judge.baseUrl).host;
					} catch {
						// keep placeholder for unparseable baseUrl
					}
					const items = ids
						.slice(0, 40)
						.map(
							(id) =>
								`${id} [${providerOf.get(id) ?? host}]${id === cfg.judge.model ? CHECK : ""}`,
						);
					const pick = await ctx.ui.select(
						`Judge model (current: ${cfg.judge.model})`,
						[...items, "(enter manually)"],
					);
					if (!pick) continue;
					const model =
						pick === "(enter manually)"
							? (await ctx.ui.editor("Judge model id", cfg.judge.model))?.trim()
							: stripCheck(pick).replace(/ \[[^\]]*\]$/, "");
					if (model) saveConfig({ ...cfg, judge: { ...cfg.judge, model } });
				} else if (action === "Judge effort") {
					const efforts = [
						"minimal",
						"low",
						"medium",
						"high",
						"xhigh",
						"none (non-reasoning judge)",
					];
					const current = cfg.judge.effort ?? "none (non-reasoning judge)";
					const pick = await ctx.ui.select(
						`Judge reasoning effort (current: ${cfg.judge.effort ?? "none"})`,
						efforts.map((e) => (e === current ? e + CHECK : e)),
					);
					if (!pick) continue;
					const clean = stripCheck(pick);
					saveConfig({
						...cfg,
						judge: { ...cfg.judge, effort: clean.startsWith("none") ? null : clean },
					});
				} else if (action === "Judge overrides") {
					const arms = Object.keys(ARMS);
					const rows = arms.map((arm) => `${arm} → ${judgeCpaModel(cfg, arm)}`);
					const row = await ctx.ui.select("Judge model slot to override", rows);
					if (!row) continue;
					const arm = arms[rows.indexOf(row)];
					let ids: string[];
					try {
						const key = process.env[cfg.cpaKeyEnv] ?? "";
						const models = await fetchJson(`${cfg.cpaBase}/v1/models`, {
							headers: key ? { Authorization: `Bearer ${key}` } : {},
						});
						ids = [
							...new Set<string>(
								(models.data ?? [])
									.map((model: { id?: string }) => model.id)
									.filter((id: unknown): id is string => typeof id === "string"),
							),
						].sort((a, b) => a.localeCompare(b));
					} catch (e) {
						ctx.ui.notify(`llm-router: model list failed (${e})`, "error");
						continue;
					}
					if (!ids.length) {
						ctx.ui.notify("llm-router: CPA reported no enabled models", "error");
						continue;
					}
					const current = judgeCpaModel(cfg, arm);
					const reset = `(use default: ${ARMS[arm].cpa})`;
					const pick = await ctx.ui.select(
						`Enabled CPA model for ${arm} (current: ${current})`,
						[...ids.map((id) => (id === current ? id + CHECK : id)), reset],
					);
					if (!pick) continue;
					const target = pick === reset ? ARMS[arm].cpa : stripCheck(pick);
					const overrides = Object.fromEntries(
						Object.entries(cfg.judgeModelOverrides ?? {}).filter(
							([name]) => resolveArm(name) !== arm,
						),
					);
					if (target !== ARMS[arm].cpa) overrides[arm] = target;
					saveConfig({ ...cfg, judgeModelOverrides: overrides });
				} else if (action === "Pinned commands") {
					// slash commands that bypass the judge: pick one (or add
					// one), then its arm and thinking effort
					const pins = Object.entries(cfg.commandPins ?? {});
					const rows = pins.map(
						([name, p]) =>
							`/${name.replace(/^\//, "")} → ${p.model}${p.effort ? ` @ ${p.effort}` : ""}`,
					);
					const ADD = "(pin another command)";
					const row = await ctx.ui.select(
						"Slash commands pinned to a model (judge skipped; quota swap still applies)",
						[...rows, ADD],
					);
					if (!row) continue;
					const name =
						row === ADD
							? (await ctx.ui.editor("Command name (without the /)", ""))
									?.trim()
									.replace(/^\//, "")
							: pins[rows.indexOf(row)][0];
					if (!name) continue;
					const current = cfg.commandPins?.[name];
					const REMOVE = "(remove pin)";
					const modelPick = await ctx.ui.select(
						`Model for /${name.replace(/^\//, "")}`,
						[
							...Object.keys(ARMS).map((a) => (a === current?.model ? a + CHECK : a)),
							...(current ? [REMOVE] : []),
						],
					);
					if (!modelPick) continue;
					if (modelPick === REMOVE) {
						const rest = { ...cfg.commandPins };
						delete rest[name];
						saveConfig({ ...cfg, commandPins: rest });
						continue;
					}
					const SESSION = "(leave session default)";
					const selectedArm = resolveArm(stripCheck(modelPick));
					const selectedModel = selectedArm
						? findCpaModel(ctx, ARMS[selectedArm].cpa)
						: undefined;
					const efforts = thinkingLevelsForModel(
						selectedModel as unknown as UltraModel,
					);
					const effortPick = await ctx.ui.select(
						`Thinking effort for /${name.replace(/^\//, "")}`,
						[...efforts, SESSION].map((e) =>
							e === (current?.effort ?? SESSION) ? e + CHECK : e,
						),
					);
					if (!effortPick) continue;
					const effort = stripCheck(effortPick);
					saveConfig({
						...cfg,
						commandPins: {
							...cfg.commandPins,
							[name]: {
								model: stripCheck(modelPick),
								effort: effort === SESSION ? null : (effort as ThinkingLevel),
							},
						},
					});
				} else if (action === "Quota threshold") {
					const cur = cfg.quotaMaxPct == null ? "off" : `${cfg.quotaMaxPct}%`;
					const title =
						`Exclude arms with >= this % quota used (current: ${cur})` +
						(managementKey(cfg)
							? ""
							: "\nNOTE: no CPA management key configured — gate is inactive until set");
					const opts = ["off", "50%", "75%", "80%", "90%", "95%"];
					const pick = await ctx.ui.select(
						title,
						opts.map((o) => (o === cur ? o + CHECK : o)),
					);
					if (!pick) continue;
					const clean = stripCheck(pick);
					saveConfig({
						...cfg,
						quotaMaxPct: clean === "off" ? null : Number.parseInt(clean, 10),
					});
				} else if (action === "CPA management key") {
					const state = cfg.cpaManagementKey
						? "set in config"
						: process.env[cfg.cpaManagementKeyEnv]
							? `unset (falling back to $${cfg.cpaManagementKeyEnv})`
							: "not set";
					const edited = await maskedInput(
						ctx,
						`CPA management key (${state}) — stored plaintext in llm-router.json; empty clears`,
					);
					if (edited === undefined) continue;
					saveConfig({ ...cfg, cpaManagementKey: edited.trim() });
					ctx.ui.notify(
						edited.trim()
							? "llm-router: management key saved"
							: "llm-router: management key cleared",
						"info",
					);
					void refreshKeyStatus();
				} else if (action === "Edit full config (JSON)") {
					const edited = await ctx.ui.editor(
						"llm-router config",
						JSON.stringify(cfg, null, 2),
					);
					if (edited === undefined) continue;
					try {
						const parsed = JSON.parse(edited);
						saveConfig({
							...DEFAULTS,
							...parsed,
							judge: { ...DEFAULTS.judge, ...(parsed.judge ?? {}) },
						});
						ctx.ui.notify("llm-router: config saved", "info");
					} catch (e) {
						ctx.ui.notify(
							`llm-router: invalid JSON, config unchanged (${e})`,
							"error",
						);
					}
				} else if (action === "Test judge") {
					ctx.ui.notify(`llm-router: testing ${cfg.judge.model}…`, "info");
					try {
						const v = await route(cfg, "fix typo in README.md: 'teh' -> 'the'");
						ctx.ui.notify(
							`llm-router: judge OK (${v.latency_s}s) — picked ${v.model}: ${v.rationale}`.slice(
								0,
								220,
							),
							"info",
						);
					} catch (e) {
						ctx.ui.notify(
							`llm-router: judge FAILED — ${e instanceof Error ? e.message : e}`.slice(
								0,
								220,
							),
							"error",
						);
					}
				}
			}
		},
	});
}
