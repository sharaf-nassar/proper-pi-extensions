import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	stripTerminalSequences,
	Text,
	type TUI,
	type TuiInputListener,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.transcript-cleanup");
const SGR_MOUSE_TAIL = /^\[<(\d+);(\d+);(\d+)([Mm])$/;
const LEFT_BUTTON = "0";

type ComponentContainer = Component & { children: Component[] };
type AssistantMessage = {
	content: Array<{ type: string; text?: string; thinking?: string }>;
	stopReason?: string;
	errorMessage?: string;
	timestamp?: number;
};
type AssistantComponent = Component & {
	lastMessage?: AssistantMessage;
	updateContent?(message: AssistantMessage, isStreaming?: boolean): void;
};
type InstalledContainer = ComponentContainer & {
	[INSTALLED]?: TranscriptCleanupController;
};
type DetailHit = {
	owner: object;
	line: string;
	end: number;
};
type State = {
	ctx: ExtensionContext;
	tui: TUI;
	activeStart: number | undefined;
	completed: Set<Component>;
	owned: Set<Component>;
	expanded: Map<object, boolean>;
	hits: Map<number, DetailHit>;
	pendingHits: DetailHit[];
	outline: OutlineEntry[];
	globalExpanded: boolean;
	assistantCache: WeakMap<AssistantComponent, AssistantRenderCache>;
};
type AssistantRenderCache = {
	message: AssistantMessage;
	width: number;
	lines: Map<string, string[]>;
};
type DetailKind = "tool" | "error";
/**
 * One transcript action, in scroll-content coordinates.
 *
 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Session action rail]]
 */
export type OutlineEntry = {
	row: number;
	kind: "user" | "assistant" | "tool" | "error";
	/** Short action-type name: `prompt`, `reply`, or the tool's name. */
	label: string;
};
type Detail = {
	owner: object;
	kind: DetailKind;
	label: string;
	component: Component;
};
type ToolComponent = Component & {
	toolName?: string;
	args?: unknown;
	result?: { isError?: boolean };
	expanded?: boolean;
	setExpanded?(expanded: boolean): void;
};
type MouseTui = TUI & {
	inputListeners?: Set<TuiInputListener>;
	previousLines?: string[];
	previousScreen?: string[];
	getPrimaryScrollView?(): unknown;
	getScrollSelectionPoint?(
		scrollView: unknown,
		x: number,
		y: number,
	): { row: number; col: number } | undefined;
};
type TranscriptContainers = {
	document: ComponentContainer;
	chat: InstalledContainer;
};

export type TranscriptCleanupController = {
	start(): void;
	completeAssistant(message: object): void;
	completeTool(toolCallId: string): void;
	settle(): void;
	outline(): OutlineEntry[];
	update(ctx: ExtensionContext, tui: TUI): void;
	uninstall(): void;
};

export function installTranscriptCleanup(
	tui: TUI,
	ctx: ExtensionContext,
): TranscriptCleanupController | undefined {
	const containers = findTranscriptContainers(tui);
	if (!containers) return undefined;
	const { document, chat } = containers;
	if (chat[INSTALLED]) {
		chat[INSTALLED].update(ctx, tui);
		return chat[INSTALLED];
	}

	let state: State = {
		ctx,
		tui,
		activeStart: ctx.isIdle() ? undefined : chat.children.length,
		completed: new Set(),
		owned: new Set(chat.children),
		expanded: new Map(),
		hits: new Map(),
		pendingHits: [],
		outline: [],
		globalExpanded: ctx.ui.getToolsExpanded(),
		assistantCache: new WeakMap(),
	};
	const render = chat.render;
	const invalidate = chat.invalidate;
	const listener: TuiInputListener = (data) => handleClick(data, state);
	const unsubscribe = tui.addInputListener(listener);
	prioritize(tui, listener);
	const controller: TranscriptCleanupController = {
		start() {
			if (state.activeStart === undefined) {
				state = {
					...state,
					activeStart: chat.children.length,
					completed: new Set(),
				};
			}
		},
		completeAssistant(message) {
			const completed = message as AssistantMessage;
			const assistant = chat.children.find((child) => {
				if (componentName(child) !== "AssistantMessageComponent") return false;
				const current = (child as AssistantComponent).lastMessage;
				return (
					current === message ||
					(completed.timestamp !== undefined &&
						current?.timestamp === completed.timestamp)
				);
			});
			if (assistant) {
				state.completed.add(assistant);
				state.owned.add(assistant);
			}
		},
		completeTool(toolCallId) {
			const tool = chat.children.find(
				(child) =>
					componentName(child) === "ToolExecutionComponent" &&
					(child as ToolComponent & { toolCallId?: string }).toolCallId ===
						toolCallId,
			);
			if (tool) {
				state.completed.add(tool);
				state.owned.add(tool);
			}
		},
		settle() {
			const owned = new Set(state.owned);
			for (const child of chat.children.slice(
				state.activeStart ?? chat.children.length,
			)) {
				owned.add(child);
			}
			state = {
				...state,
				activeStart: undefined,
				completed: new Set(),
				owned,
			};
			state.tui.requestRender();
		},
		outline() {
			return state.outline;
		},
		update(nextCtx, nextTui) {
			state = {
				...state,
				ctx: nextCtx,
				tui: nextTui,
			};
		},
		uninstall() {
			if (chat[INSTALLED] !== controller) return;
			unsubscribe();
			chat.render = render;
			chat.invalidate = invalidate;
			delete chat[INSTALLED];
		},
	};
	// Theme or terminal changes rebuild component content, so drop memoized
	// assistant lines along with the native caches.
	chat.invalidate = () => {
		state = { ...state, assistantCache: new WeakMap() };
		invalidate.call(chat);
	};
	chat.render = (width: number) => {
		const globalExpanded = state.ctx.ui.getToolsExpanded();
		if (globalExpanded !== state.globalExpanded) {
			state = { ...state, globalExpanded, expanded: new Map() };
		}
		state.pendingHits.length = 0;
		const sink: OutlineEntry[] = [];
		let lines: string[];
		if (state.activeStart === undefined && state.ctx.isIdle()) {
			lines = renderCollapsed(chat.children, width, state, sink);
		} else {
			const start = state.activeStart ?? chat.children.length;
			const collapsed = renderCollapsed(
				chat.children.slice(0, start),
				width,
				state,
				sink,
			);
			lines = [
				...collapsed,
				...renderActive(
					chat.children.slice(start),
					width,
					state,
					sink,
					collapsed.length,
				),
			];
		}
		const offset = documentRowOffset(document, chat, width);
		state.outline = sink
			.map((entry) => ({ ...entry, row: offset + entry.row }))
			.sort((a, b) => a.row - b.row);
		indexDetailHits(lines, offset, state);
		return lines;
	};
	chat[INSTALLED] = controller;
	return controller;
}

function renderActive(
	children: Component[],
	width: number,
	state: State,
	sink: OutlineEntry[],
	base: number,
): string[] {
	const output: string[][] = Array.from({ length: children.length });
	let hasTextBelow = false;
	for (let index = children.length - 1; index >= 0; index--) {
		const child = children[index];
		if (!child) continue;
		const native = child.render(width);
		output[index] =
			state.completed.has(child) && hasTextBelow
				? renderGroup([child], width, state, [], 0)
				: native;
		if (hasSectionText(native)) hasTextBelow = true;
	}
	// Outline rows are recorded on a forward pass because the render loop above
	// walks backwards; the discarded renderGroup sink avoids double records.
	let row = base;
	for (let index = 0; index < children.length; index++) {
		const rendered = output[index];
		const child = children[index];
		if (child && rendered?.length) {
			const entry = actionEntry(child);
			if (entry) sink.push({ ...entry, row });
		}
		row += rendered?.length ?? 0;
	}
	return output.flat();
}

function actionEntry(child: Component): Omit<OutlineEntry, "row"> | undefined {
	if (isUserBoundary(child)) {
		return { kind: "user", label: "prompt" };
	}
	const name = componentName(child);
	if (name === "AssistantMessageComponent") {
		return { kind: "assistant", label: "reply" };
	}
	if (name === "ToolExecutionComponent") {
		const tool = child as ToolComponent;
		return {
			kind: tool.result?.isError === true ? "error" : "tool",
			label: tool.toolName ?? "tool",
		};
	}
	return undefined;
}

function renderCollapsed(
	children: Component[],
	width: number,
	state: State,
	sink: OutlineEntry[],
): string[] {
	const lines: string[] = [];
	let group: Component[] = [];
	const flush = () => {
		if (!group.length) return;
		lines.push(...renderGroup(group, width, state, sink, lines.length));
		group = [];
	};

	for (let index = 0; index < children.length; index++) {
		const child = children[index];
		if (!child) continue;
		if (
			componentName(child) === "Spacer" &&
			isUserBoundary(children[index + 1])
		) {
			flush();
			lines.push(...child.render(width));
			continue;
		}
		if (isUserBoundary(child)) {
			flush();
			group = [child];
		} else if (
			group.length ||
			componentName(child) === "AssistantMessageComponent"
		) {
			group.push(child);
		} else {
			lines.push(...renderExpandable(child, width, state));
		}
	}
	flush();
	return lines;
}

function renderGroup(
	group: Component[],
	width: number,
	state: State,
	sink: OutlineEntry[],
	base: number,
): string[] {
	const lines: string[] = [];

	for (const child of group) {
		const name = componentName(child);
		if (isUserBoundary(child)) {
			sink.push({
				kind: "user",
				row: base + lines.length,
				label: "prompt",
			});
			lines.push(...child.render(width));
			continue;
		}
		if (name === "Spacer") {
			if (!state.owned.has(child)) lines.push(...child.render(width));
			continue;
		}
		if (name === "AssistantMessageComponent") {
			const startRow = lines.length;
			const assistant = child as AssistantComponent;
			const message = assistant.lastMessage;
			if (!message || !assistant.updateContent) {
				lines.push(...child.render(width));
				if (lines.length > startRow) {
					sink.push({
						kind: "assistant",
						row: base + startRow,
						label: "reply",
					});
				}
				continue;
			}
			const hasToolCall = message.content.some(
				(part) => part.type === "toolCall",
			);
			message.content.forEach((part) => {
				if (part.type === "thinking" && part.thinking?.trim()) {
					lines.push(
						...renderAssistantContent(assistant, message, [part], width, state),
					);
				}
				if (hasToolCall && part.type === "text" && part.text?.trim()) {
					lines.push(
						...withVerticalSpacing(
							renderAssistantContent(assistant, message, [part], width, state),
						),
					);
				}
			});
			if (["aborted", "error", "length"].includes(message.stopReason ?? "")) {
				const error =
					message.errorMessage ??
					(message.stopReason === "length"
						? "Response was truncated before completion."
						: "Operation aborted");
				lines.push(
					...renderDetail(
						{
							owner: child,
							kind: "error",
							label: `error · ${oneLine(error)}`,
							component: new Text(state.ctx.ui.theme.fg("error", error), 1, 0),
						},
						width,
						state,
					),
				);
			}
			if (!hasToolCall) {
				const direct = message.content.filter(
					(part) => part.type === "text" && part.text?.trim(),
				);
				if (direct.length) {
					lines.push(
						...renderAssistantContent(assistant, message, direct, width, state),
					);
				}
			}
			// A turn whose reply was only tool calls emits nothing of its own; its
			// visible actions are the tool rows, so no assistant entry is recorded.
			if (lines.length > startRow) {
				sink.push({
					kind: "assistant",
					row: base + startRow,
					label: "reply",
				});
			}
			continue;
		}
		if (name === "ToolExecutionComponent") {
			const tool = child as ToolComponent;
			const error = tool.result?.isError === true;
			sink.push({
				kind: error ? "error" : "tool",
				row: base + lines.length,
				label: tool.toolName ?? "tool",
			});
			lines.push(
				...renderDetail(
					{
						owner: child,
						kind: error ? "error" : "tool",
						label: describeTool(tool, error),
						component: child,
					},
					width,
					state,
				),
			);
			continue;
		}
		if (!state.owned.has(child)) {
			lines.push(...renderExpandable(child, width, state));
			continue;
		}
		lines.push(...withVerticalSpacing(renderExpandable(child, width, state)));
	}
	return lines;
}

/**
 * Extension entry renderers draw their own disclosure marker from Pi's global
 * tool-expansion state, so without a hit row the marker is decoration that only
 * `app.tools.expand` moves. Drive the same per-item state the tool summaries use
 * and register the header row, so one entry opens on click.
 */
function renderExpandable(
	child: Component,
	width: number,
	state: State,
): string[] {
	const expandable = child as ToolComponent;
	if (typeof expandable.setExpanded !== "function") return child.render(width);
	expandable.setExpanded(state.expanded.get(child) ?? state.globalExpanded);
	const lines = child.render(width);
	const header = lines.find((line) => stripTerminalSequences(line).trim());
	if (header) {
		state.pendingHits.push({
			owner: child,
			line: header,
			end: visibleWidth(stripTerminalSequences(header).trimEnd()),
		});
	}
	return lines;
}

function renderAssistantContent(
	assistant: AssistantComponent,
	message: AssistantMessage,
	content: AssistantMessage["content"],
	width: number,
	state: State,
): string[] {
	if (!assistant.updateContent) return assistant.render(width);
	// The updateContent swap below rebuilds the component's children and
	// discards their internal render caches, so re-running it every frame
	// re-parses the whole transcript's markdown. Memoize per content subset.
	let cache = state.assistantCache.get(assistant);
	if (!cache || cache.message !== message || cache.width !== width) {
		cache = { message, width, lines: new Map() };
		state.assistantCache.set(assistant, cache);
	}
	const key = content.map((part) => message.content.indexOf(part)).join(",");
	const cached = cache.lines.get(key);
	if (cached) return cached;
	const { errorMessage: _errorMessage, ...rest } = message;
	assistant.updateContent({ ...rest, content, stopReason: "stop" }, false);
	try {
		const lines = assistant.render(width);
		cache.lines.set(key, lines);
		return lines;
	} finally {
		assistant.updateContent(message, false);
	}
}

function withVerticalSpacing(lines: string[]): string[] {
	return lines.length ? ["", ...lines, ""] : [];
}

function hasSectionText(lines: string[]): boolean {
	return lines.some((line) => {
		const text = stripTerminalSequences(line).trim();
		return (
			text.length > 0 &&
			!/(?:^|\s)Working(?:\.\.\.|…)(?:\s+\([^)]*\))?$/.test(text)
		);
	});
}

function renderDetail(detail: Detail, width: number, state: State): string[] {
	const expanded = state.expanded.get(detail.owner) ?? state.globalExpanded;
	const marker = state.ctx.ui.theme.fg(
		"borderAccent",
		state.ctx.ui.theme.bold(expanded ? "⌄" : "›"),
	);
	const label = state.ctx.ui.theme.fg(detailColor(detail.kind), detail.label);
	const header = truncateToWidth(`${marker} ${label}`, width, "");
	const headerLine = `${header}${" ".repeat(Math.max(0, width - visibleWidth(header)))}`;
	state.pendingHits.push({
		owner: detail.owner,
		line: headerLine,
		end: visibleWidth(header),
	});
	const lines = [headerLine];
	const expandable = detail.component as ToolComponent;
	// setExpanded rebuilds the tool's result renderer even when the state is
	// unchanged, which re-sanitizes full outputs on every frame. Skip no-ops.
	if (expandable.expanded !== expanded) expandable.setExpanded?.(expanded);
	if (expanded) {
		lines.push(...detail.component.render(width));
		const button = `\x1b[7m ${state.ctx.ui.theme.fg(detailColor(detail.kind), "collapse")} \x1b[27m`;
		const rendered = truncateToWidth(button, width, "");
		const buttonLine = `${rendered}${" ".repeat(Math.max(0, width - visibleWidth(rendered)))}`;
		state.pendingHits.push({
			owner: detail.owner,
			line: buttonLine,
			end: visibleWidth(rendered),
		});
		lines.push(buttonLine);
	}
	return lines;
}

function detailColor(
	kind: DetailKind,
): Parameters<ExtensionContext["ui"]["theme"]["fg"]>[0] {
	switch (kind) {
		case "tool":
			return "mdLink";
		case "error":
			return "error";
	}
}

function describeTool(tool: ToolComponent, error: boolean): string {
	return `${error ? "error" : "tool"} · ${toolLabel(tool)}`;
}

function toolLabel(tool: ToolComponent): string {
	const name = tool.toolName ?? "tool";
	const args = asRecord(tool.args);
	const value = [
		"tool",
		"path",
		"command",
		"pattern",
		"query",
		"task",
		"url",
		"action",
	]
		.map((key) => args?.[key])
		.find((candidate): candidate is string => typeof candidate === "string");
	return value ? `${name} · ${oneLine(value)}` : name;
}

function oneLine(text: string): string {
	return stripTerminalSequences(text).replace(/\s+/g, " ").trim().slice(0, 120);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function documentRowOffset(
	document: ComponentContainer,
	chat: ComponentContainer,
	width: number,
): number {
	const chatIndex = document.children.indexOf(chat);
	if (chatIndex <= 0) return 0;
	return document.children
		.slice(0, chatIndex)
		.reduce((rows, child) => rows + child.render(width).length, 0);
}

function indexDetailHits(lines: string[], offset: number, state: State): void {
	state.hits.clear();
	let nextRow = 0;
	for (const hit of state.pendingHits) {
		const relativeRow = lines.indexOf(hit.line, nextRow);
		if (relativeRow < 0) continue;
		state.hits.set(offset + relativeRow, hit);
		nextRow = relativeRow + 1;
	}
}

function handleClick(
	data: string,
	state: State,
): { consume: true } | undefined {
	if (!data.startsWith("\x1b")) return undefined;
	const match = SGR_MOUSE_TAIL.exec(data.slice(1));
	if (!match || match[1] !== LEFT_BUTTON) return undefined;
	const column = Number.parseInt(match[2] ?? "", 10) - 1;
	const row = Number.parseInt(match[3] ?? "", 10) - 1;
	const point = contentPoint(state.tui, column, row);
	if (!point) return undefined;
	const screenLine = screenLines(state.tui)[row];
	if (!screenLine) return undefined;
	const hit = findHit(state, point.row, screenLine);
	if (!hit || point.col < 0 || point.col >= hit.end) return undefined;
	if (match[4] === "M") {
		state.expanded.set(
			hit.owner,
			!(state.expanded.get(hit.owner) ?? state.globalExpanded),
		);
		state.tui.requestRender();
	}
	return { consume: true };
}

/**
 * A wheel or keyboard scroll moves `scrollTop` immediately while the repaint
 * is throttled, so the mapped content row can name a different item than the
 * frame the click landed on. Fall back to the painted screen text whenever it
 * identifies exactly one control.
 */
function findHit(
	state: State,
	contentRow: number,
	screenLine: string,
): DetailHit | undefined {
	const direct = state.hits.get(contentRow);
	if (direct && sameHitText(screenLine, direct)) return direct;
	let match: DetailHit | undefined;
	for (const hit of state.hits.values()) {
		if (!sameHitText(screenLine, hit)) continue;
		if (match) return undefined;
		match = hit;
	}
	return match;
}

function contentPoint(
	tui: TUI,
	column: number,
	row: number,
): { row: number; col: number } | undefined {
	const host = tui as MouseTui;
	const scrollView = host.getPrimaryScrollView?.();
	return scrollView !== undefined && host.getScrollSelectionPoint
		? host.getScrollSelectionPoint(scrollView, column, row)
		: { row, col: column };
}

function sameHitText(line: string, hit: DetailHit): boolean {
	return (
		truncateToWidth(stripTerminalSequences(line), hit.end, "") ===
		truncateToWidth(stripTerminalSequences(hit.line), hit.end, "")
	);
}

function screenLines(tui: TUI): string[] {
	const host = tui as MouseTui;
	return host.previousScreen ?? host.previousLines ?? [];
}

function prioritize(tui: TUI, listener: TuiInputListener): void {
	const listeners = (tui as MouseTui).inputListeners;
	if (!listeners?.has(listener)) return;
	const rest = [...listeners].filter((entry) => entry !== listener);
	listeners.clear();
	listeners.add(listener);
	for (const entry of rest) listeners.add(entry);
}

function findTranscriptContainers(tui: TUI): TranscriptContainers | undefined {
	for (const root of roots(tui)) {
		const document = find(root, (component) => {
			const children = childrenOf(component);
			return (
				children.length >= 3 &&
				children
					.slice(0, 3)
					.every((child) => componentName(child) === "Container")
			);
		});
		const chat = document ? childrenOf(document)[2] : undefined;
		if (document && chat) {
			return {
				document: document as ComponentContainer,
				chat: chat as InstalledContainer,
			};
		}
	}
	return undefined;
}

function find(
	root: Component,
	matches: (component: Component) => boolean,
): Component | undefined {
	if (matches(root)) return root;
	for (const child of childrenOf(root)) {
		const found = find(child, matches);
		if (found) return found;
	}
	return undefined;
}

function roots(tui: TUI): Component[] {
	const layoutRoot = (tui as TUI & { layoutRoot?: Component }).layoutRoot;
	return layoutRoot ? [layoutRoot] : tui.children;
}

function childrenOf(component: Component): Component[] {
	return (component as Partial<ComponentContainer>).children ?? [];
}

function componentName(component: Component): string | undefined {
	return (component as { constructor?: { name?: string } }).constructor?.name;
}

function isUserBoundary(component: Component | undefined): boolean {
	if (!component) return false;
	const name = componentName(component);
	return (
		name === "UserMessageComponent" ||
		name === "SkillInvocationMessageComponent"
	);
}
