/**
 * llm-router pi extension — fully self-contained (2026-08-15).
 *
 * All routing lives HERE: judge call, optional CPA quota probe,
 * backup-chain resolution, exemplar few-shot. No python subprocess, no
 * shim. Every first input of a session (typed or slash command) is routed:
 * the judge picks an arm and the session switches to an available Pi model.
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
 *   "judge": { "model": "...",               // authenticated Pi model
 *              "effort": "medium" | null,
 *              "fast": false },              // priority service tier
 *   "fallbackModel": "gpt-5.6-terra",         // id or provider/id
 *   "cpaBase": "http://127.0.0.1:8317",       // optional quota management API
 *   "exemplarsPath": ".../exemplars.jsonl",   // optional few-shot corpus
 *   "quotaMaxPct": null,                      // gate: exclude arms >= this % used
 *   "cpaManagementKey": "",                   // plaintext; env fallback below
 *   "cpaManagementKeyEnv": "CPA_MANAGEMENT_KEY",
 *   "judgeModelOverrides": {                  // arm slot -> id or provider/id
 *     "claude-fable-5": "anthropic/claude-fable-5"
 *   },
 *   "commandPins": {                          // slash command -> fixed arm,
 *     "file": { "model": "claude-fable-5", "effort": "xhigh" }  // judge skipped
 *   }
 * }
 *
 * Quota: the judge is NEVER menu-filtered — it always sees all 7 slots.
 * Availability is checked after the verdict (checks run concurrently
 * with the judge call). An arm is down when its target is missing from
 * Pi's authenticated model registry, which reports configured auth, not
 * live upstream capacity. The only exhaustion signal is the opt-in gate:
 * when quotaMaxPct plus a CPA management key are configured, CPA-backed
 * targets also use per-account usage through CPA's management api-call
 * passthrough (claude: oauth/usage incl. per-model 7d; codex: wham/usage
 * used_percent). An out-of-quota pick swaps to its fixed cross-lane partner
 * (fable<->sol, opus<->terra, sonnet->luna, haiku<->luna); both sides dead
 * falls back to fallbackModel. Usage is cached 60s; usage failures skip the
 * threshold gate. The judge always uses one strict Pi model-registry tool call.
 *
 * session_start forces fresh sessions back to llm-router/auto because pi
 * persists the last-set model as the default (LLM_ROUTER_OFF=1 disables).
 * The factory self-registers llm-router/auto via pi.registerProvider();
 * a manual ~/.pi/agent/models.json entry is optional and composes above
 * it. No request should ever reach the placeholder endpoint — routing
 * switches the session before the agent loop runs.
 *
 * Env hooks kept from the python stack: JUDGE_EXEMPLARS=0 (skip few-shot),
 * CPA_MANAGEMENT_KEY (per-account usage checks),
 * CPA_SIMULATE_UNAVAILABLE="arm1,arm2" (test hook).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type SelectItem,
	SelectList,
	Text,
} from "@earendil-works/pi-tui";

const PROVIDER = "llm-router";
const CPA_PROVIDER = "cliproxyapi";
const CONFIG_PATH = path.join(os.homedir(), ".pi/agent/llm-router.json");
const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface JudgeConfig {
	model: string;
	effort: string | null;
	// request the provider's priority service tier when supported
	fast: boolean;
}
// Pi 0.84.4 stops at max, while CLIProxyAPI already advertises ultra for
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

async function installUltraThinkingShim(): Promise<boolean> {
	try {
		// Pi's extension loader resolves this bare specifier to the running
		// host tree in both layouts — a jiti alias on unbundled entries and
		// virtual modules under the bundled npm bin — so the patch lands on
		// the same AgentSession and Theme classes the live process uses. The
		// former argv[1] dist probe found no core/ beside dist/bundle/cli.js
		// and silently skipped ultra on standard npm installs.
		const host = (await import(
			"@earendil-works/pi-coding-agent"
		)) as unknown as {
			AgentSession?: Constructor<UltraSession>;
			Theme?: Constructor<UltraTheme>;
		};
		if (!host.AgentSession || !host.Theme) return false;
		installUltraThinkingPrototype(host.AgentSession);
		installUltraThemePrototype(host.Theme);
		return Boolean(
			host.AgentSession.prototype[ULTRA_SESSION_PATCH] &&
				host.Theme.prototype[ULTRA_THEME_PATCH],
		);
	} catch {
		return false;
	}
}

export const ULTRA_THINKING_SHIM_INSTALLED = await installUltraThinkingShim();
export interface CommandPin {
	model: string; // arm key, model id, or unique fragment (resolveArm)
	effort: ThinkingLevel | null; // null = leave the session's thinking level
}
export interface Config {
	judge: JudgeConfig;
	fallbackModel: string;
	cpaBase: string;
	exemplarsPath: string;
	// exclude arms whose accounts have used >= this % of quota (null = off);
	// needs the CPA management key: cpaManagementKey, or exported under
	// cpaManagementKeyEnv as a fallback
	quotaMaxPct: number | null;
	cpaManagementKey: string;
	cpaManagementKeyEnv: string;
	// replace a judge arm's execution model with an id or provider/id while
	// preserving that arm's rubric use cases and stable schema selection key
	judgeModelOverrides: Record<string, string>;
	// slash commands routed without asking the judge (key = command name,
	// leading "/" optional). Quota swaps still apply to the pinned arm.
	commandPins: Record<string, CommandPin>;
}

const DEFAULTS: Config = {
	judge: {
		model: "gpt-5.6-terra",
		effort: "medium",
		fast: false,
	},
	fallbackModel: "gpt-5.6-terra",
	cpaBase: "http://127.0.0.1:8317",
	exemplarsPath: path.join(EXTENSION_DIR, "exemplars.jsonl"),
	quotaMaxPct: null,
	cpaManagementKey: "",
	cpaManagementKeyEnv: "CPA_MANAGEMENT_KEY",
	judgeModelOverrides: {},
	commandPins: {
		file: { model: "claude-fable-5", effort: "xhigh" },
		triage: { model: "claude-fable-5", effort: "xhigh" },
		spec: { model: "claude-fable-5", effort: "xhigh" },
		refine: { model: "claude-fable-5", effort: "xhigh" },
		"implement-ready": { model: "gpt-5-6-sol", effort: "xhigh" },
	},
};

function managementKey(cfg: Config): string {
	return cfg.cpaManagementKey || process.env[cfg.cpaManagementKeyEnv] || "";
}

function mergeConfig(user: Record<string, unknown>): Config {
	const top = { ...user };
	delete top.cpaKeyEnv;
	const judge = { ...((top.judge ?? {}) as Record<string, unknown>) };
	delete judge.baseUrl;
	delete judge.apiKeyEnv;
	return {
		...DEFAULTS,
		...top,
		judge: { ...DEFAULTS.judge, ...judge },
	} as Config;
}

export function loadConfig(configPath = CONFIG_PATH): Config {
	try {
		return mergeConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
	} catch {
		return DEFAULTS;
	}
}

export function saveConfig(cfg: Config): void {
	fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`);
}

// ---------------------------------------------------------------- arms
const ARMS = {
	"claude-haiku-4-5": { model: "claude-haiku-4-5" },
	"claude-sonnet-5": { model: "claude-sonnet-5" },
	"claude-opus-5": { model: "claude-opus-5" },
	"claude-fable-5": { model: "claude-fable-5" },
	"gpt-5-6-luna": { model: "gpt-5.6-luna" },
	"gpt-5-6-terra": { model: "gpt-5.6-terra" },
	"gpt-5-6-sol": { model: "gpt-5.6-sol" },
} as const;
type Arm = keyof typeof ARMS;

export interface ModelTarget {
	provider: string;
	id: string;
}

type RegistryModel = ReturnType<
	ExtensionContext["modelRegistry"]["getAvailable"]
>[number];
type ArmTargets = Partial<Record<Arm, ModelTarget>>;

function modelIdRank(candidate: string, wanted: string): number {
	const id = candidate.toLowerCase();
	const target = wanted.toLowerCase();
	if (id === target) return 0;
	return id.startsWith(`${target}-`) || id.startsWith(`${target}@`) ? 1 : 2;
}

/** Resolve id or provider/id against Pi's authenticated model snapshot.
 * Unqualified duplicate IDs prefer CPA for backward compatibility, then
 * the direct provider for that model family. */
export function resolveModelTarget<T extends ModelTarget>(
	name: string,
	models: readonly T[],
): T | undefined {
	const value = name.trim();
	if (!value) return undefined;
	const slash = value.indexOf("/");
	const explicit = slash > 0;
	const provider = explicit ? value.slice(0, slash) : undefined;
	const wanted = explicit ? value.slice(slash + 1) : value;
	const family = wanted.toLowerCase();
	const preferred = family.includes("claude")
		? [
				CPA_PROVIDER,
				"anthropic",
				"amazon-bedrock",
				"google-vertex",
				"anthropic-vertex",
				"github-copilot",
			]
		: family.includes("gpt")
			? [
					CPA_PROVIDER,
					"openai-codex",
					"openai",
					"azure-openai-responses",
					"github-copilot",
				]
			: [CPA_PROVIDER];
	return models
		.filter(
			(model) =>
				(!explicit || model.provider === provider) &&
				modelIdRank(model.id, wanted) < 2,
		)
		.sort((a, b) => {
			const ap = preferred.indexOf(a.provider);
			const bp = preferred.indexOf(b.provider);
			const providerRank =
				(ap < 0 ? preferred.length : ap) - (bp < 0 ? preferred.length : bp);
			if (!explicit && providerRank) return providerRank;
			const id = modelIdRank(a.id, wanted) - modelIdRank(b.id, wanted);
			return (
				id ||
				providerRank ||
				`${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`)
			);
		})
		.at(0);
}

function cpaConfigured(models: readonly ModelTarget[]): boolean {
	return models.some((model) => model.provider === CPA_PROVIDER);
}

function isArm(value: string): value is Arm {
	return value in ARMS;
}
const CLAUDE_ARMS = new Set([
	"claude-haiku-4-5",
	"claude-sonnet-5",
	"claude-opus-5",
	"claude-fable-5",
]);
// Post-verdict availability swap: fixed cross-lane tier pairs. The judge
// is never menu-filtered; an unavailable pick swaps to its partner (both
// unavailable -> caller falls back). Luna's return pair is Haiku.
const SWAP: Record<Arm, Arm> = {
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
 * ("gpt-5-6-sol"), default IDs ("gpt-5.6-sol"), or any unique fragment
 * ("sol", "opus"); ambiguous or unknown -> null. Pure — see smoke.ts. */
export function resolveArm(name: string): Arm | null {
	const normalized = name.trim().toLowerCase().replace(/[\s.]/g, "-");
	if (isArm(normalized)) return normalized;
	const hits = (Object.keys(ARMS) as Arm[]).filter(
		(arm) => arm.includes(normalized) || normalized.includes(arm),
	);
	return hits.length === 1 ? (hits.at(0) ?? null) : null;
}

// Rebuilt several times per routed prompt (once per arm through armTargets,
// plus route() itself); each prompt loads a fresh Config object, so entries
// age out with their config.
const judgeOverridesCache = new WeakMap<Config, Map<Arm, string>>();

// @lat: [[configuration#Judge model overrides]]
function judgeOverrides(cfg: Config): Map<Arm, string> {
	const hit = judgeOverridesCache.get(cfg);
	if (hit) return hit;
	const overrides = new Map<Arm, string>();
	for (const [name, value] of Object.entries(cfg.judgeModelOverrides ?? {})) {
		const arm = resolveArm(name);
		const model = typeof value === "string" ? value.trim() : "";
		if (arm && model && model !== ARMS[arm].model) overrides.set(arm, model);
	}
	judgeOverridesCache.set(cfg, overrides);
	return overrides;
}

/** Configured model name executed when the judge selects an arm slot. */
export function judgeModelName(cfg: Config, arm: string): string {
	return isArm(arm) ? (judgeOverrides(cfg).get(arm) ?? ARMS[arm].model) : arm;
}

function armTargets(
	cfg: Config,
	models: readonly ModelTarget[],
	withOverrides: boolean,
): ArmTargets {
	return Object.fromEntries(
		(Object.keys(ARMS) as Arm[]).flatMap((arm) => {
			const name = withOverrides ? judgeModelName(cfg, arm) : ARMS[arm].model;
			const target = resolveModelTarget(name, models);
			return target
				? [[arm, { provider: target.provider, id: target.id }]]
				: [];
		}),
	) as ArmTargets;
}

/** Replace arm labels in judge instructions while retaining stable schema
 * keys, so an arbitrary enabled model inherits the original arm's
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
	const replaced = instructions.replace(pattern, (arm) => {
		const model = isArm(arm) ? overrides.get(arm) : undefined;
		return `${model ?? arm} [selection key: ${arm}]`;
	});
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
	const name = m.at(1);
	if (!name) return null;
	const before = text.slice(0, m.index);
	let after = text.slice(m.index + m[0].length);
	// collapse the seam so "Task: [[…]] fix X" strips to "Task: fix X"
	if (/\s$/.test(before)) after = after.replace(/^[ \t]+/, "");
	return { name, stripped: (before + after).trim() };
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
): { arm: Arm; effort: ThinkingLevel | null } | null {
	const m = /^\/([^\s]+)/.exec(text.trim());
	if (!m) return null;
	const want = m.at(1)?.toLowerCase();
	if (!want) return null;
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

/** Characters of the task the judge reads. Exemplar similarity scores the
 * same slice, so retrieval reflects the text behind the verdict and a giant
 * paste does not pay tokenization it cannot influence. */
const JUDGE_TASK_CHARS = 4000;

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
	private docs: Map<string, number>[] = [];
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
		const tfs: Map<string, number>[] = [];
		for (const r of this.rows) {
			const tf = termFreq(r.prompt);
			tfs.push(tf);
			for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
		}
		// Document vectors are fixed once df is complete. Normalizing them here
		// makes each query one dot product per row instead of re-weighting the
		// whole corpus per call (measured 2.2ms -> 0.2ms on the shipped corpus).
		this.docs = tfs.map((tf) => this.tfidf(tf));
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
			const d = this.docs.at(i);
			if (!d) throw new Error("exemplar vector index is incomplete");
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

// One index per corpus path. Config is re-read on every routed prompt, so a
// changed exemplarsPath takes effect on the next route instead of silently
// keeping the old corpus; in-place edits to the same file still need a
// restart. null = load failed for this path: route without few-shot.
let exemplarIndex: { path: string; index: ExemplarIndex | null } | undefined;

export function exemplarNote(cfg: Config, task: string): string {
	if (process.env.JUDGE_EXEMPLARS === "0") return "";
	let cached = exemplarIndex;
	if (cached?.path !== cfg.exemplarsPath) {
		let index: ExemplarIndex | null = null;
		try {
			index = new ExemplarIndex(fs.readFileSync(cfg.exemplarsPath, "utf8"));
		} catch {
			index = null; // corpus absent: route without few-shot
		}
		cached = { path: cfg.exemplarsPath, index };
		exemplarIndex = cached;
	}
	if (!cached.index) return "";
	const lines = cached.index.top(task.slice(0, JUDGE_TASK_CHARS)).map((row) => {
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
// CPA's /v1/models is deliberately NOT an availability signal: its registry
// keeps a model listed while every account sits in quota cooldown
// (modelRegistrationAvailability), so listed never implied spare quota.
// Exhaustion is only visible through the management usage API below.
async function fetchJson<T = unknown>(
	url: string,
	init: RequestInit = {},
	timeoutMs = 10_000,
	signal?: AbortSignal,
): Promise<T> {
	const timeout = AbortSignal.timeout(timeoutMs);
	const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
	const res = await fetch(url, { ...init, signal: combined });
	const text = await res.text();
	// fetch resolves on HTTP errors; a 401/500 JSON body must not be
	// mistaken for data.
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
	return JSON.parse(text) as T;
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

type ApiCallResponse = { status_code?: unknown; body?: unknown };
type AuthFile = {
	auth_index?: number;
	disabled?: boolean;
	provider?: "claude" | "codex";
	unavailable?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function apiCallBody(resp: ApiCallResponse): unknown {
	const code = Number(resp.status_code ?? 0);
	if (code === 429) throw new UpstreamRateLimitError("api-call upstream 429");
	if (code < 200 || code >= 300) throw new Error(`api-call upstream ${code}`);
	const { body } = resp;
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
	const { files = [] } = await fetchJson<{ files?: AuthFile[] }>(
		`${mgmt}/auth-files`,
		{ headers },
	);
	const active = files.filter(
		(file): file is AuthFile & { provider: "claude" | "codex" } =>
			!file.disabled &&
			!file.unavailable &&
			(file.provider === "claude" || file.provider === "codex"),
	);
	const usages = await Promise.all(
		active.map(async (file): Promise<AccountUsage | null> => {
			const call = (url: string, extra: Record<string, string> = {}) =>
				fetchJson<ApiCallResponse>(`${mgmt}/api-call`, {
					method: "POST",
					headers,
					body: JSON.stringify({
						auth_index: file.auth_index,
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
				if (file.provider === "claude") {
					const body = apiCallBody(
						await call("https://api.anthropic.com/api/oauth/usage", {
							"anthropic-beta": "oauth-2025-04-20",
						}),
					);
					let general = 0;
					const models: Record<string, number> = {};
					const bodyRecord = asRecord(body) ?? {};
					for (const [key, value] of Object.entries(bodyRecord)) {
						const utilization = asRecord(value)?.utilization;
						if (typeof utilization !== "number") continue;
						const arm = CLAUDE_WINDOW_ARMS[key];
						if (arm) {
							models[arm] = Math.max(models[arm] ?? 0, utilization);
						} else if (key === "five_hour" || key === "seven_day") {
							general = Math.max(general, utilization);
						}
					}
					// limits[]: authoritative per-model weekly percentages;
					// unscoped entries (session, weekly_all) feed general
					const limits = bodyRecord.limits;
					for (const value of Array.isArray(limits) ? limits : []) {
						const limit = asRecord(value);
						const percent = limit?.percent;
						if (typeof percent !== "number") continue;
						const scope = asRecord(limit?.scope);
						const model = asRecord(scope?.model);
						const displayName = model?.display_name;
						const arm =
							typeof displayName === "string"
								? CLAUDE_MODEL_ARMS[displayName.toLowerCase()]
								: undefined;
						if (arm) models[arm] = Math.max(models[arm] ?? 0, percent);
						else if (!scope) general = Math.max(general, percent);
					}
					return { type: "claude", general, models };
				}
				const body = apiCallBody(
					await call("https://chatgpt.com/backend-api/wham/usage"),
				);
				// live shape: rate_limit.{primary,secondary}_window.used_percent
				// (rate_limits kept as a fallback for other CPA versions)
				let general = 0;
				const bodyRecord = asRecord(body);
				const windows = asRecord(
					bodyRecord?.rate_limit ?? bodyRecord?.rate_limits,
				);
				// burst throttles 429 chat requests while used_percent stays low
				// (observed live: weekly window 70% during "would exceed your
				// account's rate limit"); the endpoint flags those states via
				// the allowed/limit_reached booleans instead
				if (windows?.allowed === false || windows?.limit_reached === true)
					general = 100;
				for (const value of Object.values(windows ?? {})) {
					const window = asRecord(value);
					const used = window?.used_percent ?? window?.usedPercent;
					if (typeof used === "number") general = Math.max(general, used);
				}
				return { type: "codex", general, models: {} };
			} catch (e) {
				if (e instanceof UpstreamRateLimitError)
					return { type: file.provider, general: 100, models: {} };
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
			accounts.reduce(
				(s, u) => s + Math.max(u.general, u.models[arm] ?? 0),
				0,
			) / accounts.length;
		if (avg >= maxPct) blocked.add(arm);
	}
	return blocked;
}

export interface ArmStatus {
	available: boolean;
}

export async function armAvailability(
	cfg: Config,
	targets: ArmTargets,
): Promise<Record<string, ArmStatus>> {
	const hasCpaTarget = Object.values(targets).some(
		(target) => target?.provider === CPA_PROVIDER,
	);
	let overQuota = new Set<string>();
	if (hasCpaTarget && cfg.quotaMaxPct != null) {
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
	for (const arm of Object.keys(ARMS) as Arm[]) {
		const target = targets[arm];
		let ok = Boolean(target);
		if (target?.provider === CPA_PROVIDER) {
			const quotaArm = resolveArm(target.id);
			if (quotaArm && overQuota.has(quotaArm)) ok = false;
		}
		if (simulated.has(arm)) ok = false;
		out[arm] = { available: ok };
	}
	return out;
}

/** Post-verdict check: keep the pick if available, else its swap partner;
 * both unavailable throws so the caller can use its fallback. */
export function resolveVerdictModel(
	model: string,
	avail: Record<string, ArmStatus>,
): { final: Arm; swapped: boolean } {
	if (!isArm(model)) throw new Error(`judge returned unknown arm ${model}`);
	if (avail[model]?.available) return { final: model, swapped: false };
	const partner = SWAP[model];
	if (avail[partner]?.available) return { final: partner, swapped: true };
	throw new Error(`${model} and swap partner ${partner} are both unavailable`);
}

// --------------------------------------------------------------- judge
export interface Verdict {
	arm: string;
	provider: string;
	model: string;
	rationale: string;
	latency_s: number;
	swapped_from?: string;
	overridden_from?: string;
	arms_unavailable?: string[];
	quota_gate_skipped?: boolean; // threshold set but no usage data (bad key?)
}

type JudgeResult = Pick<Verdict, "model" | "rationale">;
export type JudgeRunner = (
	instructions: string,
	task: string,
	menu: string[],
	signal?: AbortSignal,
) => Promise<JudgeResult>;
function registryJudgeRunner(
	ctx: ExtensionContext,
	cfg: Config,
	model: RegistryModel,
): JudgeRunner {
	return async (instructions, task, menu, signal) => {
		const schema = {
			type: "object",
			properties: {
				model: { type: "string", enum: menu },
				rationale: { type: "string", maxLength: 500 },
			},
			required: ["model", "rationale"],
			additionalProperties: false,
		};
		const options: Record<string, unknown> = {
			signal,
			maxRetries: 0,
			timeoutMs: 60_000,
			maxTokens: 512,
			cacheRetention: "none",
		};
		if (cfg.judge.effort) {
			if (
				model.api === "anthropic-messages" ||
				model.api === "bedrock-converse-stream"
			) {
				options.reasoning = cfg.judge.effort;
			} else if (
				model.api === "google-generative-ai" ||
				model.api === "google-vertex"
			) {
				options.thinking = { enabled: true, level: cfg.judge.effort };
			} else {
				options.reasoningEffort = cfg.judge.effort;
			}
		}
		if (cfg.judge.fast) options.serviceTier = "priority";
		if (
			model.api === "anthropic-messages" ||
			model.api === "bedrock-converse-stream"
		) {
			options.toolChoice = { type: "tool", name: "route_model" };
		} else if (
			model.api === "google-generative-ai" ||
			model.api === "google-vertex"
		) {
			options.toolChoice = "any";
		} else if (model.api.endsWith("codex-responses")) {
			options.toolChoice = "required";
		} else {
			options.toolChoice = {
				type: "function",
				function: { name: "route_model" },
			};
		}

		let last = "";
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const response = await ctx.modelRegistry.complete(
					model,
					{
						systemPrompt: instructions,
						messages: [
							{
								role: "user",
								content: task.slice(0, JUDGE_TASK_CHARS),
								timestamp: Date.now(),
							},
						],
						tools: [
							{
								name: "route_model",
								description: "Choose the model slot for this coding task.",
								parameters: schema as never,
								constrainedSampling: {
									type: "json_schema",
									strict: "require",
								},
							},
						],
					},
					options as never,
				);
				const call = response.content.find(
					(part) => part.type === "toolCall" && part.name === "route_model",
				);
				const selected =
					call?.type === "toolCall" ? call.arguments.model : undefined;
				const rationale =
					call?.type === "toolCall" ? call.arguments.rationale : undefined;
				if (
					typeof selected === "string" &&
					menu.includes(selected) &&
					typeof rationale === "string"
				) {
					return { model: selected, rationale };
				}
				last = "judge returned no valid route_model call";
			} catch (e) {
				if (signal?.aborted) throw new Error("judge cancelled");
				last = `transport: ${e}`;
			}
		}
		throw new Error(
			`judge ${model.provider}/${model.id} returned no verdict twice (last: ${last})`,
		);
	};
}

export interface RouteRuntime {
	models: readonly ModelTarget[];
	judge: JudgeRunner;
}

/** Routing verdict for one task. The judge always sees seven stable slots;
 * configured targets replace their prompt labels and execution models.
 * Availability is checked after the verdict and can swap to a partner slot. */
export async function route(
	cfg: Config,
	task: string,
	signal: AbortSignal | undefined,
	runtime: RouteRuntime,
): Promise<Verdict> {
	const instructions = applyJudgeModelOverrides(
		cfg,
		RUBRIC + exemplarNote(cfg, task),
	);
	const targets = armTargets(cfg, runtime.models, true);
	const t0 = Date.now();
	const [judged, avail] = await Promise.all([
		runtime.judge(instructions, task, Object.keys(ARMS), signal),
		armAvailability(cfg, targets),
	]);
	const { final, swapped } = resolveVerdictModel(judged.model, avail);
	const target = targets[final];
	if (!target) throw new Error(`no available model for ${final}`);
	const verdict: Verdict = {
		arm: final,
		provider: target.provider,
		model: target.id,
		rationale: judged.rationale,
		latency_s: Math.round((Date.now() - t0) / 100) / 10,
	};
	if (swapped) verdict.swapped_from = judged.model;
	if (judgeOverrides(cfg).has(final)) verdict.overridden_from = final;
	const down = Object.keys(avail)
		.filter((arm) => !avail[arm]?.available)
		.sort();
	if (down.length) verdict.arms_unavailable = down;
	const usesCpa = Object.values(targets).some(
		(target) => target?.provider === CPA_PROVIDER,
	);
	if (usesCpa && cfg.quotaMaxPct != null && !(await cachedAccountUsages(cfg))) {
		verdict.quota_gate_skipped = true;
	}
	return verdict;
}

// ----------------------------------------------------------- extension
// notice colors (pi-tui renders ANSI in notify text; \x1b[39m/22 reset
// only what we set, so pi's own notify styling survives around it)
const fgc = (c: number, s: string) => `\x1b[${c}m${s}\x1b[39m`;
const green = (s: string) => fgc(32, s);
const yellow = (s: string) => fgc(33, s);
const cyan = (s: string) => fgc(36, s);
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;

/** Resolve an already-decided arm through configured providers. Direct
 * routes fail open: if no swap is usable, keep the requested target. */
async function directFinal(
	cfg: Config,
	arm: Arm,
	models: readonly ModelTarget[],
): Promise<{ final: Arm; target?: ModelTarget; extra: string }> {
	const targets = armTargets(cfg, models, false);
	try {
		const r = resolveVerdictModel(arm, await armAvailability(cfg, targets));
		const target = targets[r.final];
		return {
			final: r.final,
			...(target ? { target } : {}),
			extra: r.swapped ? yellow(` (swapped from ${arm}: unavailable)`) : "",
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		const target = targets[arm];
		return {
			final: arm,
			...(target ? { target } : {}),
			extra: yellow(` [availability check skipped: ${msg.slice(0, 60)}]`),
		};
	}
}

export default function (pi: ExtensionAPI) {
	// Self-register the llm-router/auto placeholder so `pi install` alone
	// is enough — no manual models.json edit on install or update. The
	// port-1 baseUrl is an intentional dead end; routing switches away
	// before any request. Older hosts without registerProvider fall back
	// to the documented manual models.json entry.
	if (typeof pi.registerProvider === "function") {
		pi.registerProvider(PROVIDER, {
			name: "LLM Router",
			baseUrl: "http://127.0.0.1:1/v1",
			apiKey: "unused",
			api: "openai-completions",
			models: [
				{
					id: "auto",
					name: "auto",
					reasoning: false,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 16384,
				},
			],
		});
	}

	function availableModels(ctx: ExtensionContext): RegistryModel[] {
		return ctx.modelRegistry
			.getAvailable()
			.filter((model) => model.provider !== PROVIDER);
	}

	function findTarget(ctx: ExtensionContext, target: ModelTarget | undefined) {
		return target
			? ctx.modelRegistry.find(target.provider, target.id)
			: undefined;
	}

	function findConfiguredModel(
		ctx: ExtensionContext,
		name: string,
		models: readonly RegistryModel[],
	) {
		return findTarget(ctx, resolveModelTarget(name, models));
	}

	function runtimeFor(
		ctx: ExtensionContext,
		cfg: Config,
		models: readonly RegistryModel[],
	): RouteRuntime {
		const judgeModel = resolveModelTarget(cfg.judge.model, models);
		if (!judgeModel) {
			throw new Error(
				`judge ${cfg.judge.model} is unavailable in Pi's authenticated model registry`,
			);
		}
		return {
			models,
			judge: registryJudgeRunner(ctx, cfg, judgeModel),
		};
	}

	pi.on("session_start", async (event, ctx) => {
		if (process.env.LLM_ROUTER_OFF === "1") return;
		if (event.reason === "startup" || event.reason === "new") {
			if (ctx.model?.provider !== PROVIDER) {
				const auto = ctx.modelRegistry.find(PROVIDER, "auto");
				if (auto) await pi.setModel(auto);
			}
		}
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
		// Routing state is infrastructure's problem, never the model's: when
		// LLM_ROUTER_OFF=1 a pinned workflow command would run unpinned and
		// its spawned workers would inherit the variable and never route, so
		// gate the run with a real dialog here. Declining stops the input
		// before the agent sees it. hasUI guard: with no dialog surface,
		// confirm() auto-returns false and would silently block headless
		// runs, so those proceed unrouted instead — OFF was set on purpose.
		// (Dialogs are safe in input handlers; session_start would hang.)
		if (
			process.env.LLM_ROUTER_OFF === "1" &&
			ctx.hasUI &&
			commandPin(loadConfig(), event.text)
		) {
			const proceed = await ctx.ui.confirm(
				"llm-router is disabled (LLM_ROUTER_OFF=1)",
				"This command normally pins its model and routes every spawned " +
					"worker per task. With the router off it runs on the current " +
					"session model and workers are not routed. Continue without " +
					"routing?",
			);
			if (!proceed) {
				ctx.ui.notify(
					"llm-router: run stopped — unset LLM_ROUTER_OFF and restart pi to route",
					"info",
				);
				return { action: "handled" };
			}
		}
		if (ctx.model?.provider !== PROVIDER) return { action: "continue" };
		if (!event.text.trim()) return { action: "continue" };

		// our own commands (/llm-router, /llm-router-config) are pure UI —
		// never route or switch on them
		if (/^\/llm-router\b/.test(event.text)) return { action: "continue" };

		const cfg = loadConfig();
		const models = availableModels(ctx);
		// Pinned slash command (/file, /implement-ready, …): skip the judge,
		// then use the requested arm or its available partner.
		const pin = commandPin(cfg, event.text);
		if (pin) {
			const { final, target, extra } = await directFinal(cfg, pin.arm, models);
			const model = findTarget(ctx, target);
			if (model && (await pi.setModel(model))) {
				// after setModel: pi clamps the level to the new model
				// (older pi has no setThinkingLevel — pin the model anyway)
				if (pin.effort && typeof pi.setThinkingLevel === "function")
					(pi.setThinkingLevel as unknown as (level: string) => void)(
						pin.effort,
					);
				const eff = pin.effort ? dim(` @${pin.effort}`) : "";
				ctx.ui.notify(
					`llm-router: ${cyan(final)}${eff} ${dim("(pinned command)")}${extra}`,
					"info",
				);
				return { action: "continue" };
			}
			ctx.ui.notify(
				`llm-router: pinned arm ${final} has no switchable model — routing normally`,
				"error",
			);
		}

		// bare slash command: no task text to judge — switch to the fallback
		// so nothing ever reaches the llm-router/auto placeholder endpoint
		if (/^\/\S+\s*$/.test(event.text)) {
			const fb = findConfiguredModel(ctx, cfg.fallbackModel, models);
			if (fb && (await pi.setModel(fb))) {
				ctx.ui.notify(
					`llm-router: bare command, no task to judge — using ${cfg.fallbackModel}`,
					"info",
				);
			}
			return { action: "continue" };
		}

		// [[llm-router: <model>]] — forced pick from the spawning session
		// (or the user): honor it instead of consulting the judge, but keep
		// the post-verdict availability swap so a dead arm uses its partner
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
				// Forced means forced: an unavailable target can swap once, but
				// a failed availability check never blocks the prompt.
				const { final, target, extra } = await directFinal(cfg, arm, models);
				const forced = findTarget(ctx, target);
				if (forced && (await pi.setModel(forced))) {
					ctx.ui.notify(
						`llm-router: ${cyan(final)} ${dim("(forced)")}${extra}`,
						"info",
					);
					return {
						action: "transform",
						text: sentinel.stripped,
						...(event.images ? { images: event.images } : {}),
					};
				}
				ctx.ui.notify(
					`llm-router: forced arm ${final} has no switchable model — asking the judge instead`,
					"error",
				);
			}
		}
		const taskText = sentinel ? sentinel.stripped : event.text;
		ctx.ui.notify(
			green(
				`llm-router: asking ${cfg.judge.model} which model fits this task…`,
			),
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
		let target: ModelTarget | undefined = resolveModelTarget(
			cfg.fallbackModel,
			models,
		);
		let note: string;
		let failed = false;
		try {
			const v = await route(
				cfg,
				taskText,
				cancel.signal,
				runtimeFor(ctx, cfg, models),
			);
			target = { provider: v.provider, id: v.model };
			// clean pick: neutral, model in cyan; swap: model + clause in
			// amber — a subtle warning, not an error. Rationale is capped
			// instead of slicing the composed string (ANSI-safe).
			const rat =
				v.rationale.length > 150
					? `${v.rationale.slice(0, 149)}…`
					: v.rationale;
			const pickedName = `${v.provider}/${v.model}`;
			const picked = v.swapped_from ? yellow(pickedName) : cyan(pickedName);
			const swap = v.swapped_from
				? yellow(` (swapped from ${v.swapped_from}: unavailable)`)
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
			findTarget(ctx, target) ??
			findConfiguredModel(ctx, cfg.fallbackModel, models);
		if (model && (await pi.setModel(model))) {
			ctx.ui.notify(note, failed ? "error" : "info");
		} else {
			ctx.ui.notify(`${note} (no switchable configured model found!)`, "error");
		}
		return sentinel
			? {
					action: "transform",
					text: sentinel.stripped,
					...(event.images ? { images: event.images } : {}),
				}
			: { action: "continue" };
	});

	// green ✓ for the currently-configured entry; \x1b[39m resets only the
	// foreground so the select row's own styling survives (pi-tui renders
	// ANSI in item strings — same pattern piolium uses)
	const CHECK = " \x1b[32m✓\x1b[39m";
	const stripCheck = (s: string) =>
		s.endsWith(CHECK) ? s.slice(0, -CHECK.length) : s;

	// @lat: [[configuration#Interactive command]]
	const configSelect = async (
		ctx: ExtensionContext,
		title: string,
		options: string[],
	): Promise<string | undefined> => {
		if (ctx.mode !== "tui") return ctx.ui.select(title, options);
		const checked = options.findIndex((option) => option.endsWith(CHECK));
		return ctx.ui.custom<string | undefined>(
			(tui, theme, _keybindings, done) => {
				const items: SelectItem[] = options.map((value) => ({
					value,
					label: value,
				}));
				const list = new SelectList(items, Math.min(items.length, 10), {
					selectedPrefix: (text) => theme.fg("accent", text),
					selectedText: (text) => theme.fg("accent", text),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("dim", text),
					noMatch: (text) => theme.fg("warning", text),
				});
				list.setSelectedIndex(checked < 0 ? 0 : checked);
				list.onSelect = (item) => done(item.value);
				list.onCancel = () => done(undefined);

				const container = new Container();
				container.addChild(
					new DynamicBorder((text: string) => theme.fg("accent", text)),
				);
				container.addChild(
					new Text(theme.fg("accent", theme.bold(title)), 1, 0),
				);
				container.addChild(list);
				container.addChild(
					new Text(
						theme.fg("dim", "↑↓ navigate · enter select · esc cancel"),
						1,
						0,
					),
				);
				container.addChild(
					new DynamicBorder((text: string) => theme.fg("accent", text)),
				);
				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput(data: string) {
						list.handleInput(data);
						tui.requestRender();
					},
				};
			},
		);
	};

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
		return ctx.ui.custom((tui, theme, _keybindings, done) => {
			let value = "";
			const stripControls = (text: string) =>
				[...text]
					.filter((character) => {
						const code = character.charCodeAt(0);
						return code >= 32 && code !== 127;
					})
					.join("");
			return {
				invalidate() {},
				// pi-tui aborts if a rendered line exceeds the terminal —
				// clip every line to the width we're given (content is
				// clipped BEFORE styling, so no ANSI-aware measuring needed)
				render(width: number): string[] {
					const w = Math.max(10, Math.floor(width) || 80);
					const clip = (s: string) =>
						s.length > w ? `${s.slice(0, w - 1)}…` : s;
					const dots = Math.max(0, Math.min(value.length, w - 3));
					return [
						theme.fg("accent", clip(title)),
						"",
						`${clip(`  ${"•".repeat(dots)}`)}${theme.fg("dim", "▏")}`,
						"",
						theme.fg("dim", clip("  enter save · esc cancel · empty clears")),
					];
				},
				handleInput(data: string): void {
					if (data === "\r" || data === "\n") {
						done(value);
						return;
					}
					if (data === "\x1b" || data === "\x03") {
						done(undefined);
						return;
					}
					if (data === "\x7f" || data === "\b") value = value.slice(0, -1);
					else if (data.startsWith("\x1b[200~"))
						value += stripControls(data.slice(6).split("\x1b[201~").join(""));
					else if (!data.startsWith("\x1b")) value += stripControls(data);
					// other \x1b… sequences (arrows etc.): ignored
					tui.requestRender();
				},
			};
		});
	}

	function configForEditor(cfg: Config, showCpa: boolean): Partial<Config> {
		if (showCpa) return cfg;
		const visible: Partial<Config> = { ...cfg };
		delete visible.cpaBase;
		delete visible.quotaMaxPct;
		delete visible.cpaManagementKey;
		delete visible.cpaManagementKeyEnv;
		return visible;
	}

	// /llm-router: switch the session back to llm-router/auto so the next
	// prompt routes again.
	pi.registerCommand("llm-router", {
		description:
			"Switch this session to llm-router/auto (next prompt gets routed)",
		handler: async (_args: string, ctx: ExtensionContext) => {
			const auto = ctx.modelRegistry.find(PROVIDER, "auto");
			if (auto && (await pi.setModel(auto))) {
				ctx.ui.notify(
					"llm-router: active — next prompt picks the model",
					"info",
				);
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
			const select = (title: string, options: string[]) =>
				configSelect(ctx, title, options);
			for (;;) {
				const cfg = loadConfig();
				const models = availableModels(ctx);
				const cpaOn = cpaConfigured(models);
				const keySource = cfg.cpaManagementKey
					? "config"
					: process.env[cfg.cpaManagementKeyEnv]
						? `env $${cfg.cpaManagementKeyEnv}`
						: "unset";
				const cpaSummary = cpaOn
					? ` | quota gate: ${cfg.quotaMaxPct == null ? "off" : `${cfg.quotaMaxPct}%`}` +
						` | key: ${keySource}`
					: "";
				const summary =
					`judge: ${cfg.judge.model}@${cfg.judge.effort ?? "no-effort"}${cfg.judge.fast ? "+fast" : ""} via Pi model registry\n` +
					`fallback: ${cfg.fallbackModel}${cpaSummary}` +
					` | overrides: ${judgeOverrides(cfg).size}` +
					` | pinned commands: ${Object.keys(cfg.commandPins ?? {}).length}`;
				let action = await select(`llm-router config\n${summary}`, [
					"Judge",
					"Overrides",
					"Pinned commands",
					...(cpaOn ? ["Quota threshold", "CPA management key"] : []),
					"Edit full config (JSON)",
					"Test judge",
					"Done",
				]);
				if (!action || action === "Done") return;
				if (action === "Judge") {
					const judgeAction = await select("Judge settings", [
						"Model",
						"Effort",
						"Fast",
					]);
					if (!judgeAction) continue;
					action = `Judge ${judgeAction.toLowerCase()}`;
				}

				if (action === "Judge model") {
					const current = resolveModelTarget(cfg.judge.model, models);
					const currentRef = current
						? `${current.provider}/${current.id}`
						: cfg.judge.model;
					const items = models
						.map((model) => `${model.provider}/${model.id}`)
						.sort()
						.slice(0, 80)
						.map((model) => model + (model === currentRef ? CHECK : ""));
					const pick = await select(
						`Judge model (current: ${cfg.judge.model})`,
						[...items, "(enter manually)"],
					);
					if (!pick) continue;
					const model =
						pick === "(enter manually)"
							? (
									await ctx.ui.editor(
										"Judge model id or provider/id",
										cfg.judge.model,
									)
								)?.trim()
							: stripCheck(pick);
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
					const pick = await select(
						`Judge reasoning effort (current: ${cfg.judge.effort ?? "none"})`,
						efforts.map((e) => (e === current ? e + CHECK : e)),
					);
					if (!pick) continue;
					const clean = stripCheck(pick);
					saveConfig({
						...cfg,
						judge: {
							...cfg.judge,
							effort: clean.startsWith("none") ? null : clean,
						},
					});
				} else if (action === "Judge fast") {
					const current = cfg.judge.fast ? "on" : "off";
					const pick = await select(
						`Judge fast mode — priority service tier (current: ${current})`,
						["on", "off"].map((e) => (e === current ? e + CHECK : e)),
					);
					if (!pick) continue;
					const fast = stripCheck(pick) === "on";
					saveConfig({ ...cfg, judge: { ...cfg.judge, fast } });
				} else if (action === "Overrides") {
					const arms = Object.keys(ARMS) as Arm[];
					const resolved = armTargets(cfg, models, true);
					const rows = arms.map((arm) => {
						const target = resolved[arm];
						return `${arm} → ${target ? `${target.provider}/${target.id}` : `${judgeModelName(cfg, arm)} (unavailable)`}`;
					});
					const row = await select("Judge model slot to override", rows);
					if (!row) continue;
					const arm = arms[rows.indexOf(row)];
					if (!arm) continue;
					const current = resolved[arm];
					const refs = models
						.map((model) => `${model.provider}/${model.id}`)
						.sort();
					const reset = `(use default: ${ARMS[arm].model})`;
					const pick = await select(`Available model for ${arm}`, [
						...refs.map((ref) =>
							ref === `${current?.provider}/${current?.id}` ? ref + CHECK : ref,
						),
						reset,
					]);
					if (!pick) continue;
					const target = pick === reset ? ARMS[arm].model : stripCheck(pick);
					const overrides = Object.fromEntries(
						Object.entries(cfg.judgeModelOverrides ?? {}).filter(
							([name]) => resolveArm(name) !== arm,
						),
					);
					if (target !== ARMS[arm].model) overrides[arm] = target;
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
					const row = await select(
						"Slash commands pinned to a model (judge skipped; availability swap still applies)",
						[...rows, ADD],
					);
					if (!row) continue;
					const name =
						row === ADD
							? (await ctx.ui.editor("Command name (without the /)", ""))
									?.trim()
									.replace(/^\//, "")
							: pins[rows.indexOf(row)]?.[0];
					if (!name) continue;
					const current = cfg.commandPins?.[name];
					const REMOVE = "(remove pin)";
					const modelPick = await select(
						`Model for /${name.replace(/^\//, "")}`,
						[
							...Object.keys(ARMS).map((a) =>
								a === current?.model ? a + CHECK : a,
							),
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
					const selectedTarget = selectedArm
						? armTargets(cfg, models, false)[selectedArm]
						: undefined;
					const selectedModel = findTarget(ctx, selectedTarget);
					const efforts = thinkingLevelsForModel(
						selectedModel as unknown as UltraModel,
					);
					const effortPick = await select(
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
					const pick = await select(
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
				} else if (action === "Edit full config (JSON)") {
					const edited = await ctx.ui.editor(
						"llm-router config",
						JSON.stringify(configForEditor(cfg, cpaOn), null, 2),
					);
					if (edited === undefined) continue;
					try {
						const parsed = JSON.parse(edited);
						const base = cpaOn ? DEFAULTS : cfg;
						saveConfig(mergeConfig({ ...base, ...parsed }));
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
						const v = await route(
							cfg,
							"fix typo in README.md: 'teh' -> 'the'",
							undefined,
							runtimeFor(ctx, cfg, models),
						);
						ctx.ui.notify(
							`llm-router: judge OK (${v.latency_s}s) — picked ${v.provider}/${v.model}: ${v.rationale}`.slice(
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
