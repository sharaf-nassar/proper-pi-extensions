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
const PROCESS_LINK_PREFIX = "pi-proper-base://process/";
const SGR_MOUSE_TAIL = /^\[<(\d+);(\d+);(\d+)([Mm])$/;
const LEFT_BUTTON = "0";

type Keybindings = {
	getKeys(action: "app.tools.expand"): readonly string[];
};
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
type State = {
	ctx: ExtensionContext;
	tui: TUI;
	keybindings: Keybindings;
	activeStart: number | undefined;
	completed: Set<Component>;
	owned: Set<Component>;
	expanded: Map<object, boolean>;
	groups: Map<string, object>;
	ids: WeakMap<object, string>;
	nextId: number;
	globalExpanded: boolean;
	assistantCache: WeakMap<AssistantComponent, AssistantRenderCache>;
};
type AssistantRenderCache = {
	message: AssistantMessage;
	width: number;
	lines: Map<string, string[]>;
};
type DetailKind = "tool" | "error";
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
};

export type TranscriptCleanupController = {
	start(): void;
	completeAssistant(message: object): void;
	completeTool(toolCallId: string): void;
	settle(): void;
	update(ctx: ExtensionContext, tui: TUI, keybindings: Keybindings): void;
	uninstall(): void;
};

export function installTranscriptCleanup(
	tui: TUI,
	ctx: ExtensionContext,
	keybindings: Keybindings,
): TranscriptCleanupController | undefined {
	const chat = findChatContainer(tui) as InstalledContainer | undefined;
	if (!chat) return undefined;
	if (chat[INSTALLED]) {
		chat[INSTALLED].update(ctx, tui, keybindings);
		return chat[INSTALLED];
	}

	let state: State = {
		ctx,
		tui,
		keybindings,
		activeStart: ctx.isIdle() ? undefined : chat.children.length,
		completed: new Set(),
		owned: new Set(chat.children),
		expanded: new Map(),
		groups: new Map(),
		ids: new WeakMap(),
		nextId: 0,
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
		update(nextCtx, nextTui, nextKeybindings) {
			state = {
				...state,
				ctx: nextCtx,
				tui: nextTui,
				keybindings: nextKeybindings,
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
		state.groups.clear();
		if (state.activeStart === undefined && state.ctx.isIdle()) {
			return renderCollapsed(chat.children, width, state);
		}
		const start = state.activeStart ?? chat.children.length;
		return [
			...renderCollapsed(chat.children.slice(0, start), width, state),
			...renderActive(chat.children.slice(start), width, state),
		];
	};
	chat[INSTALLED] = controller;
	return controller;
}

function renderActive(
	children: Component[],
	width: number,
	state: State,
): string[] {
	const output: string[][] = Array.from({ length: children.length });
	let hasTextBelow = false;
	for (let index = children.length - 1; index >= 0; index--) {
		const child = children[index];
		if (!child) continue;
		const native = child.render(width);
		output[index] =
			state.completed.has(child) && hasTextBelow
				? renderGroup([child], width, state)
				: native;
		if (hasSectionText(native)) hasTextBelow = true;
	}
	return output.flat();
}

function renderCollapsed(
	children: Component[],
	width: number,
	state: State,
): string[] {
	const lines: string[] = [];
	let group: Component[] = [];
	const flush = () => {
		if (!group.length) return;
		lines.push(...renderGroup(group, width, state));
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
			lines.push(...child.render(width));
		}
	}
	flush();
	return lines;
}

function renderGroup(
	group: Component[],
	width: number,
	state: State,
): string[] {
	const lines: string[] = [];

	for (const child of group) {
		const name = componentName(child);
		if (isUserBoundary(child)) {
			lines.push(...child.render(width));
			continue;
		}
		if (name === "Spacer") {
			if (!state.owned.has(child)) lines.push(...child.render(width));
			continue;
		}
		if (name === "AssistantMessageComponent") {
			const assistant = child as AssistantComponent;
			const message = assistant.lastMessage;
			if (!message || !assistant.updateContent) {
				lines.push(...child.render(width));
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
			continue;
		}
		if (name === "ToolExecutionComponent") {
			const tool = child as ToolComponent;
			const error = tool.result?.isError === true;
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
			lines.push(...child.render(width));
			continue;
		}
		lines.push(...withVerticalSpacing(child.render(width)));
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
	let id = state.ids.get(detail.owner);
	if (!id) {
		id = String(++state.nextId);
		state.ids.set(detail.owner, id);
	}
	state.groups.set(id, detail.owner);
	const expanded = state.expanded.get(detail.owner) ?? state.globalExpanded;
	const keys = state.keybindings.getKeys("app.tools.expand").join("/");
	const action = expanded ? "collapse" : "expand";
	const hint = keys
		? ` (click or ${keys} to ${action})`
		: ` (click to ${action})`;
	const label = `${expanded ? "▾" : "▸"} ${detail.label}${hint}`;
	const styled = state.ctx.ui.theme.fg(detailColor(detail.kind), label);
	const header = truncateToWidth(
		`\x1b]8;;${PROCESS_LINK_PREFIX}${id}\x07${styled}\x1b]8;;\x07`,
		width,
		"",
	);
	const lines = [
		`${header}${" ".repeat(Math.max(0, width - visibleWidth(header)))}`,
	];
	const expandable = detail.component as ToolComponent;
	// setExpanded rebuilds the tool's result renderer even when the state is
	// unchanged, which re-sanitizes full outputs on every frame. Skip no-ops.
	if (expandable.expanded !== expanded) expandable.setExpanded?.(expanded);
	if (expanded) {
		lines.push(...detail.component.render(width));
		const button = `\x1b[7m ${state.ctx.ui.theme.fg(detailColor(detail.kind), "collapse")} \x1b[27m`;
		const linked = `\x1b]8;;${PROCESS_LINK_PREFIX}${id}\x07${button}\x1b]8;;\x07`;
		const rendered = truncateToWidth(linked, width, "");
		lines.push(
			`${rendered}${" ".repeat(Math.max(0, width - visibleWidth(rendered)))}`,
		);
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
	const name = tool.toolName ?? "tool";
	const args = asRecord(tool.args);
	const value = ["path", "command", "pattern", "query", "task", "url", "action"]
		.map((key) => args?.[key])
		.find((candidate): candidate is string => typeof candidate === "string");
	const target = value ? ` · ${oneLine(value)}` : "";
	return `${error ? "error" : "tool"} · ${name}${target}`;
}

function oneLine(text: string): string {
	return stripTerminalSequences(text).replace(/\s+/g, " ").trim().slice(0, 120);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
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
	const line = screenLines(state.tui)[row];
	if (!line) return undefined;
	const link = linkAtColumn(line, column);
	if (!link?.startsWith(PROCESS_LINK_PREFIX)) return undefined;
	const owner = state.groups.get(link.slice(PROCESS_LINK_PREFIX.length));
	if (!owner) return undefined;
	if (match[4] === "M") {
		state.expanded.set(
			owner,
			!(state.expanded.get(owner) ?? state.globalExpanded),
		);
		state.tui.requestRender();
	}
	return { consume: true };
}

function screenLines(tui: TUI): string[] {
	const host = tui as MouseTui;
	return host.previousScreen ?? host.previousLines ?? [];
}

function linkAtColumn(line: string, column: number): string | undefined {
	let active: string | undefined;
	let visible = 0;
	for (let index = 0; index < line.length; ) {
		if (line.startsWith("\x1b]8;;", index)) {
			const end = line.indexOf("\x07", index + 5);
			if (end < 0) break;
			active = line.slice(index + 5, end) || undefined;
			index = end + 1;
			continue;
		}
		if (line[index] === "\x1b") {
			const end = line.indexOf("m", index + 1);
			if (end < 0) break;
			index = end + 1;
			continue;
		}
		const character = line[index] ?? "";
		const width = visibleWidth(character);
		if (column >= visible && column < visible + width) return active;
		visible += width;
		index += character.length;
	}
	return undefined;
}

function prioritize(tui: TUI, listener: TuiInputListener): void {
	const listeners = (tui as MouseTui).inputListeners;
	if (!listeners?.has(listener)) return;
	const rest = [...listeners].filter((entry) => entry !== listener);
	listeners.clear();
	listeners.add(listener);
	for (const entry of rest) listeners.add(entry);
}

function findChatContainer(tui: TUI): ComponentContainer | undefined {
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
		if (chat) return chat as ComponentContainer;
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
