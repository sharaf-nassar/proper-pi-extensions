import { AsyncLocalStorage } from "node:async_hooks";
import {
	closeSync,
	fstatSync,
	openSync,
	readFileSync,
	realpathSync,
} from "node:fs";
import {
	AgentSession,
	type BeforeAgentStartEvent,
	type ExtensionAPI,
	type ExtensionContext,
	parseSkillBlock,
	type Skill,
	SkillInvocationMessageComponent,
	stripFrontmatter,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { installWrapper } from "./host-interop.ts";
import { appendPromptSection } from "./prompt-sections.ts";
import {
	readSkillContextEnabled,
	writeSkillContextEnabled,
} from "./settings.ts";
import {
	type ContextMessage,
	pinSkillContext,
	SKILL_CONTEXT_ENTRY,
	SKILL_CONTEXT_TOOL,
	SKILL_CONTEXT_WARNING_CHARS,
	type SkillChange,
	SkillContextError,
	type SkillSelection,
	type SkillSnapshot,
	selectedSkills,
	skillContextChars,
	skillSnapshot,
	splitSkillText,
} from "./skill-context.ts";

const INSTALLED = Symbol.for("proper-base.skill-context");
const USAGE =
	"/skill-context [list | load <names> | remove <names> | refresh <names> | clear | on | off]";
const GUIDANCE = `Use skill_context to load relevant skills so their full instructions survive compaction. Explicitly selected skills remain available across follow-ups until removed or replaced, but apply only within their relevant scope. Loading reference instructions does not authorize unrelated actions. A fresh workflow request is new work even when its instructions are already loaded; restoration is never a request to repeat completed work. Keep track of completed steps in your ordinary task progress. Follow the user's explicit priorities and the instruction hierarchy; identify material skill conflicts rather than using mention order as precedence. Use only the smallest relevant set of automatically selected skills. /skill-context lists, removes and refreshes selections. Skill permissions are unchanged.`;

/** Exact catalog matches only. The first non-command starts literal task text. */
export function parseSkillCommands(
	text: string,
	available: ReadonlySet<string>,
): { names: string[]; request: string } | undefined {
	const names: string[] = [];
	let request = text;
	while (request.startsWith("/skill:")) {
		const match = /^\/skill:([^\s]+)(?:\s+|$)/u.exec(request);
		if (!match?.[1] || !available.has(match[1])) break;
		names.push(match[1]);
		request = request.slice(match[0].length);
	}
	if (!names.length) return undefined;
	if (/^--(?:\s|$)/.test(request)) request = request.slice(2).trimStart();
	return { names, request };
}

function filesystemError(error: unknown): boolean {
	return (
		error instanceof Error &&
		typeof (error as NodeJS.ErrnoException).code === "string"
	);
}

/** Read a discovered file, never a user-supplied arbitrary path or executable template. */
export function loadSkillSnapshot(skill: Skill): SkillSnapshot {
	let file: number | undefined;
	try {
		const location = realpathSync(skill.filePath);
		file = openSync(location, "r");
		const stat = fstatSync(file);
		if (!stat.isFile())
			throw new SkillContextError(`Skill ${skill.name} is not a regular file.`);
		const body = stripFrontmatter(readFileSync(file, "utf8")).trim();
		const baseDir = skill.baseDir;
		if (
			[skill.name, location, baseDir].some((value) =>
				/[<>"\p{Cc}]/u.test(value),
			)
		)
			throw new SkillContextError(
				`Skill ${skill.name} has a name or path that cannot be represented in a Pi skill block.`,
			);
		const block = `<skill name="${skill.name}" location="${location}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
		const snapshot = skillSnapshot(block);
		if (!snapshot)
			throw new SkillContextError(
				`Skill ${skill.name} contains a reserved skill-block delimiter.`,
			);
		return snapshot;
	} catch (error) {
		if (filesystemError(error))
			throw new SkillContextError(
				`Cannot read skill ${skill.name}: ${(error as NodeJS.ErrnoException).code}.`,
			);
		throw error;
	} finally {
		if (file !== undefined) closeSync(file);
	}
}

function findSkill(catalog: Skill[], name: string): Skill {
	const matches = catalog.filter((skill) => skill.name === name);
	if (matches.length !== 1)
		throw new SkillContextError(
			matches.length
				? `Skill name ${name} is ambiguous.`
				: `Unknown skill: ${name}.`,
		);
	return matches[0] as Skill;
}

function findSelection(
	selections: SkillSelection[],
	name: string,
): SkillSelection {
	const matches = selections.filter(
		(skill) => skill.name === name || skill.location === name,
	);
	if (matches.length !== 1)
		throw new SkillContextError(
			matches.length
				? `Skill name ${name} is ambiguous; use its full path.`
				: `No selected snapshot for ${name}.`,
		);
	return matches[0] as SkillSelection;
}

function mergedSelection(
	selections: SkillSelection[],
	incoming: SkillSnapshot[],
): SkillSnapshot[] {
	const active = new Map(
		selections
			.filter((skill) => skill.selected)
			.map((skill) => [skill.location, skill]),
	);
	const merged = new Map<string, SkillSnapshot>(active);
	for (const skill of incoming) merged.set(skill.location, skill);
	return [...merged.values()];
}

type LiveSession = Pick<AgentSession, "resourceLoader" | "sessionManager">;

/** One activation path for commands and tools, using Pi's discovered catalog. */
export function registerSkillContext(
	pi: ExtensionAPI,
	agentDir: string,
	getSession: (ctx: ExtensionContext) => unknown,
) {
	let context: ExtensionContext | undefined;
	let disposed = false;
	let runEnabled: boolean | undefined;
	let approvedSelection: string | undefined;
	const dispatch = new AsyncLocalStorage<{
		expand: boolean;
		prepared?: { text: string; expanded: string };
	}>();
	const enabled = () => !disposed && readSkillContextEnabled(agentDir);
	const effective = () => !disposed && (runEnabled ?? enabled());
	let toolHidden = false;
	const syncTool = (active: boolean) => {
		const tools = pi.getActiveTools?.();
		if (!tools || !pi.setActiveTools) return;
		if (!active && tools.includes(SKILL_CONTEXT_TOOL)) {
			pi.setActiveTools(tools.filter((name) => name !== SKILL_CONTEXT_TOOL));
			toolHidden = true;
		} else if (active && toolHidden) {
			pi.setActiveTools([...new Set([...tools, SKILL_CONTEXT_TOOL])]);
			toolHidden = false;
		}
	};
	const state = (ctx: ExtensionContext) =>
		selectedSkills(ctx.sessionManager.getBranch());
	const catalog = (ctx: ExtensionContext): Skill[] => {
		const session = getSession(ctx) as LiveSession | undefined;
		if (!session?.resourceLoader?.getSkills)
			throw new SkillContextError(
				"This Pi runtime cannot expose its skill catalog to proper-base. Disable Skill context management to use native skills.",
			);
		return session.resourceLoader.getSkills().skills;
	};
	const save = (change: SkillChange) =>
		pi.appendEntry(SKILL_CONTEXT_ENTRY, change);
	const requireEnabled = (running = false) => {
		if (!(running ? effective() : enabled()))
			throw new SkillContextError(
				"Skill context management is disabled. Use /skill-context on or /settings to enable it.",
			);
	};
	const load = (
		ctx: ExtensionContext,
		names: string[],
		automatic: boolean,
	): SkillSnapshot[] => {
		if (!names.length)
			throw new SkillContextError("Specify at least one skill name.");
		const available = catalog(ctx);
		const selections = state(ctx);
		const loaded = new Map<string, SkillSnapshot>();
		for (const name of names) {
			const skill = findSkill(available, name);
			if (automatic && skill.disableModelInvocation)
				throw new SkillContextError(
					`Skill ${name} requires explicit user invocation.`,
				);
			const snapshot = loadSkillSnapshot(skill);
			const existing = selections.find(
				(item) => item.location === snapshot.location && item.selected,
			);
			// A model cannot silently refresh an already selected instruction version.
			loaded.set(
				snapshot.location,
				automatic && existing ? existing : snapshot,
			);
		}
		return [...loaded.values()];
	};
	const confirmSelection = async (
		ctx: ExtensionContext,
		incoming: SkillSnapshot[] = [],
		signal = ctx.signal,
	): Promise<boolean> => {
		const skills = mergedSelection(state(ctx), incoming);
		const chars = skillContextChars(skills);
		if (chars <= SKILL_CONTEXT_WARNING_CHARS) return true;
		const key = skills
			.map((skill) => skill.hash)
			.sort()
			.join(":");
		if (key === approvedSelection) return true;
		if (!ctx.hasUI)
			throw new SkillContextError(
				`Selected skill instructions total ${chars} characters, above the ${SKILL_CONTEXT_WARNING_CHARS}-character warning threshold. Continuing requires confirmation through an interactive or RPC UI. No instructions were truncated.`,
			);
		const confirmed = await ctx.ui.confirm(
			"Large skill selection",
			`Selected skill instructions total ${chars} characters, above the ${SKILL_CONTEXT_WARNING_CHARS}-character warning threshold. This may leave less room for conversation and tool output. Continue with all selected skills?`,
			signal ? { signal } : undefined,
		);
		signal?.throwIfAborted();
		if (
			!confirmed ||
			disposed ||
			context?.sessionManager !== ctx.sessionManager
		)
			return false;
		approvedSelection = key;
		return true;
	};
	const status = (ctx: ExtensionContext): string => {
		const selections = state(ctx);
		const rows = selections.map((selection) => {
			let version = "snapshot retained";
			try {
				const skill = catalog(ctx).find((item) => item.name === selection.name);
				version = !skill
					? "not in current catalog"
					: loadSkillSnapshot(skill).hash === selection.hash
						? "current"
						: "changed on disk; refresh explicitly";
			} catch (error) {
				if (!(error instanceof SkillContextError)) throw error;
				version = "source unavailable; snapshot retained";
			}
			return `${selection.selected ? "selected" : "removed"}: ${selection.name} [${selection.hash.slice(0, 12)}; ${version}; ${selection.source}]\n  ${selection.location}`;
		});
		const active = selections.filter((skill) => skill.selected);
		const chars = skillContextChars(active);
		return `Skill context management: ${enabled() ? "enabled" : "disabled"}\n${active.length} selected; ${chars} instruction characters; confirmation above ${SKILL_CONTEXT_WARNING_CHARS}.\n${rows.join("\n") || "No skill snapshots in this branch."}\n${USAGE}`;
	};

	// Preflight after all input transforms, then expand the exact approved
	// snapshot at Pi's synchronous boundary. Dispatch scope preserves opt-outs.
	const prototype = AgentSession.prototype;
	const owner = prototype as typeof prototype & { [INSTALLED]?: () => void };
	owner[INSTALLED]?.();
	const native = Reflect.get(prototype, "_expandSkillCommand");
	const nativeInput = Reflect.get(prototype, "_runInputHandlers");
	const remove =
		typeof native === "function" && typeof nativeInput === "function"
			? installWrapper(
					prototype,
					"_expandSkillCommand",
					function (this: AgentSession, text: string) {
						if (
							!context ||
							this.sessionManager !== context.sessionManager ||
							!(this.isStreaming ? effective() : enabled())
						)
							return Reflect.apply(native, this, [text]);
						if (!text.startsWith("/skill:"))
							return Reflect.apply(native, this, [text]);
						const prepared = dispatch.getStore()?.prepared;
						if (prepared?.text === text) return prepared.expanded;
						const parsed = parseSkillCommands(
							text,
							new Set(catalog(context).map((skill) => skill.name)),
						);
						if (!parsed) return Reflect.apply(native, this, [text]);
						const snapshots = load(context, parsed.names, false);
						return [
							...snapshots.map((skill) => skill.block),
							...(parsed.request ? [parsed.request] : []),
						].join("\n\n");
					},
				)
			: undefined;
	const restorers = remove ? [remove] : [];
	if (remove) {
		for (const name of ["prompt", "steer", "followUp"] as const) {
			const original = prototype[name];
			restorers.push(
				installWrapper(
					prototype,
					name,
					function (this: AgentSession, ...args: unknown[]) {
						if (disposed || this.sessionManager !== context?.sessionManager)
							return Reflect.apply(original, this, args);
						const options = args[1] as
							| { expandPromptTemplates?: boolean }
							| undefined;
						return dispatch.run(
							{
								expand:
									name !== "prompt" || options?.expandPromptTemplates !== false,
							},
							() => Reflect.apply(original, this, args),
						);
					},
				),
			);
		}
		restorers.push(
			installWrapper(
				prototype,
				"_runInputHandlers",
				async function (this: AgentSession, ...args: unknown[]) {
					const input = (await Reflect.apply(nativeInput, this, args)) as
						| { text: string }
						| undefined;
					const ctx = context;
					const scope = dispatch.getStore();
					if (
						!input ||
						!scope ||
						!ctx ||
						this.sessionManager !== ctx.sessionManager ||
						!(this.isStreaming ? effective() : enabled())
					)
						return input;
					let snapshots = splitSkillText(input.text).skills;
					if (scope.expand && input.text.startsWith("/skill:")) {
						const parsed = parseSkillCommands(
							input.text,
							new Set(catalog(ctx).map((skill) => skill.name)),
						);
						if (parsed) {
							snapshots = load(ctx, parsed.names, false);
							scope.prepared = {
								text: input.text,
								expanded: [
									...snapshots.map((skill) => skill.block),
									...(parsed.request ? [parsed.request] : []),
								].join("\n\n"),
							};
						}
					}
					return (await confirmSelection(ctx, snapshots)) ? input : undefined;
				},
			),
		);
	}
	const stop = () => {
		disposed = true;
		context = undefined;
		for (const restore of restorers.reverse()) restore();
		dispatch.disable();
		if (owner[INSTALLED] === stop) delete owner[INSTALLED];
	};
	owner[INSTALLED] = stop;

	pi.registerCommand?.("skill-context", {
		description:
			"List, load, remove or refresh skill snapshots; enable/disable skill context management",
		getArgumentCompletions: (prefix) => {
			const values = [
				"list",
				"load",
				"remove",
				"refresh",
				"clear",
				"on",
				"off",
			];
			return values
				.filter((value) => value.startsWith(prefix))
				.map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const [action = "list", ...names] = args
				.trim()
				.split(/\s+/)
				.filter(Boolean);
			try {
				if (action === "list") {
					ctx.ui.notify(status(ctx), "info");
					return;
				}
				if (!ctx.isIdle() || ctx.hasPendingMessages())
					throw new SkillContextError(
						"Wait for the current run and queued prompts before changing skill selections.",
					);
				if ((action === "on" || action === "off") && !names.length) {
					writeSkillContextEnabled(agentDir, action === "on");
					syncTool(action === "on");
					ctx.ui.notify(
						`Skill context management ${action === "on" ? "enabled" : "disabled"}. Applies to the next run; native skills remain available.`,
						"info",
					);
					return;
				}
				if (action === "clear" && !names.length) save({ action: "clear" });
				else if (action === "remove" && names.length) {
					const selections = state(ctx);
					save({
						action: "remove",
						locations: names.map(
							(name) => findSelection(selections, name).location,
						),
					});
				} else if (
					(action === "load" || action === "refresh") &&
					names.length
				) {
					requireEnabled();
					const requested =
						action === "refresh"
							? names.map((name) => findSelection(state(ctx), name).name)
							: names;
					const snapshots = load(ctx, requested, false);
					if (!(await confirmSelection(ctx, snapshots))) return;
					save({
						action: "load",
						blocks: snapshots.map((skill) => skill.block),
					});
				} else throw new SkillContextError(USAGE);
				ctx.ui.notify(status(ctx), "info");
			} catch (error) {
				if (
					!(error instanceof SkillContextError) &&
					!filesystemError(error) &&
					!(error instanceof SyntaxError)
				)
					throw error;
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});

	pi.registerTool?.({
		name: SKILL_CONTEXT_TOOL,
		label: "Skill context",
		description:
			"Load full instructions for relevant skills from Pi's catalog, or list selected snapshots. Use this instead of reading SKILL.md to preserve instructions across compaction. Loading supplies guidance, not permission to repeat prior actions. Explicit-only skills require the user's /skill command.",
		parameters: {
			type: "object",
			properties: {
				action: { type: "string", enum: ["list", "load"] },
				names: { type: "array", items: { type: "string" }, minItems: 1 },
			},
			required: ["action"],
			additionalProperties: false,
		} as const,
		executionMode: "sequential",
		renderResult(result, options) {
			const text = result.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n\n");
			const { skills, request } = splitSkillText(text);
			const container = new Container();
			for (const skill of skills) {
				const parsed = parseSkillBlock(skill.block);
				if (!parsed) continue;
				const component = new SkillInvocationMessageComponent(parsed);
				component.setExpanded(options.expanded);
				container.addChild(component);
			}
			if (request) container.addChild(new Text(request, 0, 0));
			return container;
		},
		async execute(_id, params, signal, _update, ctx) {
			requireEnabled(true);
			signal?.throwIfAborted();
			const input = params as { action?: unknown; names?: unknown } | null;
			if (input?.action === "list")
				return {
					content: [{ type: "text", text: status(ctx) }],
					details: undefined,
				};
			if (
				input?.action !== "load" ||
				!Array.isArray(input.names) ||
				!input.names.every((name): name is string => typeof name === "string")
			)
				throw new SkillContextError(
					"Expected action load with an array of skill names.",
				);
			const snapshots = load(ctx, input.names, true);
			if (!(await confirmSelection(ctx, snapshots, signal)))
				throw new SkillContextError(
					"Large skill selection cancelled by the user. No new skills were loaded.",
				);
			return {
				content: [
					{
						type: "text",
						text: snapshots.map((skill) => skill.block).join("\n\n"),
					},
				],
				details: {
					skills: snapshots.map(({ name, location, hash }) => ({
						name,
						location,
						hash,
					})),
				},
			};
		},
	});

	return {
		start(ctx: ExtensionContext) {
			context = ctx;
			runEnabled = undefined;
			approvedSelection = undefined;
			syncTool(enabled());
			if (!remove && enabled())
				ctx.ui.notify(
					"This Pi version cannot preflight managed skill invocations. Use /skill-context load or disable Skill context management.",
					"warning",
				);
		},
		stop,
		prepare(event: BeforeAgentStartEvent) {
			runEnabled = enabled();
			syncTool(runEnabled);
			if (runEnabled)
				appendPromptSection(
					event.systemPromptOptions,
					"proper_base_skills",
					GUIDANCE,
				);
		},
		async transform<T extends ContextMessage>(
			messages: T[],
			ctx: ExtensionContext,
		): Promise<T[]> {
			if (!effective()) return messages;
			try {
				if (!(await confirmSelection(ctx)))
					throw new SkillContextError(
						"Large skill selection cancelled by the user. Remove skills with /skill-context remove <name> or /skill-context clear, or retry to confirm.",
					);
				return pinSkillContext(messages, ctx.sessionManager.getBranch());
			} catch (error) {
				if (!(error instanceof SkillContextError)) throw error;
				ctx.ui.notify(error.message, "error");
				// Context handlers' exceptions alone are advisory in Pi. Abort the
				// run as well, so unconfirmed instructions cannot reach the model.
				ctx.abort();
				throw error;
			}
		},
	};
}
