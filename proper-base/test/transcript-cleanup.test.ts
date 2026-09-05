import assert from "node:assert/strict";
import { test } from "node:test";

import {
	Container,
	Spacer,
	stripTerminalSequences,
} from "@earendil-works/pi-tui";
import properBase from "../index.ts";
import { installTranscriptCleanup } from "../src/transcript-cleanup.ts";

type Content = {
	type: "text" | "thinking" | "toolCall";
	text?: string;
	thinking?: string;
};
type Message = {
	content: Content[];
	stopReason: string;
	errorMessage?: string;
};

class UserMessageComponent {
	private readonly text: string;
	constructor(text: string) {
		this.text = text;
	}
	render() {
		return [`user: ${this.text}`];
	}
	invalidate() {}
}

class AssistantMessageComponent {
	hasToolCalls = false;
	lastMessage: Message;
	constructor(lastMessage: Message) {
		this.lastMessage = lastMessage;
		this.updateContent(lastMessage);
	}
	updateContent(message: Message) {
		this.lastMessage = message;
		this.hasToolCalls = message.content.some(
			(part) => part.type === "toolCall",
		);
	}
	render() {
		return this.lastMessage.content.flatMap((part) => {
			if (part.type === "text" && part.text) return [`assistant: ${part.text}`];
			if (part.type === "thinking" && part.thinking) {
				return [`thinking: ${part.thinking}`];
			}
			return [];
		});
	}
	invalidate() {}
}

class StatusComponent {
	private readonly text: string;
	constructor(text = "status: checking") {
		this.text = text;
	}
	render() {
		return [this.text];
	}
	invalidate() {}
}

class ToolExecutionComponent {
	expanded = false;
	toolName = "read";
	args: Record<string, unknown> = { path: "src/example.ts" };
	result: { isError: boolean };
	readonly toolCallId: string;
	constructor(toolCallId: string, isError = false) {
		this.toolCallId = toolCallId;
		this.result = { isError };
	}
	setExpanded(expanded: boolean) {
		this.expanded = expanded;
	}
	render() {
		return ["tool: read", this.expanded ? "tool output" : "tool preview"];
	}
	invalidate() {}
}

// Pi's CustomEntryComponent: expansion state lives on the host wrapper, and the
// extension renderer draws its own disclosure marker from it.
class CustomEntryComponent {
	private expanded = false;
	setExpanded(expanded: boolean) {
		this.expanded = expanded;
	}
	render() {
		return this.expanded
			? ["", " ⌄ pacifying with m", " original prompt", ""]
			: ["", " › pacifying with m", ""];
	}
	invalidate() {}
}

// @lat: [[lat.md/proper-base/tests#Verification#Settled transcript fixture]]
test("clicking a custom entry header expands that entry", () => {
	const chat = new Container();
	const listeners = new Set<(data: string) => unknown>();
	const document = new Container();
	document.addChild(new Container());
	document.addChild(new Container());
	document.addChild(chat);
	const tui = {
		children: [document],
		inputListeners: listeners,
		previousScreen: [] as string[],
		requestRender() {},
		addInputListener(listener: (data: string) => unknown) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getPrimaryScrollView: () => ({}),
		getScrollSelectionPoint: (_view: unknown, x: number, y: number) => ({
			row: y,
			col: x,
		}),
		terminal: { rows: 24 },
	};
	const ctx = {
		isIdle: () => true,
		ui: {
			getToolsExpanded: () => false,
			theme: {
				fg: (_color: string, text: string) => text,
				bold: (text: string) => text,
				italic: (text: string) => text,
			},
		},
	};
	const controller = installTranscriptCleanup(tui as never, ctx as never);
	assert.ok(controller);
	chat.addChild(new UserMessageComponent("fix it"));
	chat.addChild(new CustomEntryComponent());
	controller.settle();

	const rendered = chat.render(80);
	const headerRow = rendered.findIndex((line) =>
		stripTerminalSequences(line).includes("› pacifying with m"),
	);
	assert.ok(headerRow >= 0);
	tui.previousScreen = rendered.slice(0, 24);
	let consumed = false;
	for (const listener of listeners) {
		const click = `\x1b[<0;3;${headerRow + 1}M`;
		if ((listener(click) as { consume?: boolean } | undefined)?.consume) {
			consumed = true;
			break;
		}
	}
	assert.equal(consumed, true);
	assert.match(
		chat.render(80).map(stripTerminalSequences).join("\n"),
		/original prompt/,
	);
	controller.uninstall();
});

test("agent settlement restores the collapsed process-detail default", async () => {
	let settled: ((event: unknown, ctx: any) => void) | undefined;
	properBase({
		on(event: string, handler: typeof settled) {
			if (event === "agent_settled") settled = handler;
		},
	} as unknown as Parameters<typeof properBase>[0]);
	let expanded = true;
	await settled?.(
		{},
		{
			ui: {
				getToolsExpanded: () => expanded,
				setToolsExpanded(value: boolean) {
					expanded = value;
				},
			},
		},
	);
	assert.equal(expanded, false);
});

// @lat: [[lat.md/proper-base/tests#Verification#Settled render memoization]]
test("settled re-renders reuse cached content instead of rebuilding", () => {
	const chat = new Container();
	const document = new Container();
	document.addChild(new Container());
	document.addChild(new Container());
	document.addChild(chat);
	const tui = {
		children: [document],
		inputListeners: new Set<(data: string) => unknown>(),
		requestRender() {},
		addInputListener() {
			return () => {};
		},
		terminal: { rows: 24 },
	};
	const ctx = {
		isIdle: () => true,
		ui: {
			getToolsExpanded: () => false,
			theme: {
				fg: (_color: string, text: string) => text,
				bold: (text: string) => text,
				italic: (text: string) => text,
			},
		},
	};
	const controller = installTranscriptCleanup(tui as never, ctx as never);
	assert.ok(controller);

	const assistant = new AssistantMessageComponent({
		content: [
			{ type: "thinking", thinking: "plan" },
			{ type: "text", text: "Working on it." },
			{ type: "toolCall" },
		],
		stopReason: "toolUse",
	});
	let rebuilds = 0;
	const updateContent = assistant.updateContent.bind(assistant);
	assistant.updateContent = (message: Message) => {
		rebuilds++;
		updateContent(message);
	};
	const tool = new ToolExecutionComponent("tool-memo");
	let expandCalls = 0;
	const setExpanded = tool.setExpanded.bind(tool);
	tool.setExpanded = (expanded: boolean) => {
		expandCalls++;
		setExpanded(expanded);
	};
	chat.addChild(new UserMessageComponent("go"));
	chat.addChild(assistant);
	chat.addChild(tool);
	controller.settle();

	chat.render(100);
	const afterFirst = rebuilds;
	const expandAfterFirst = expandCalls;
	chat.render(100);
	chat.render(100);
	assert.equal(rebuilds, afterFirst);
	assert.equal(expandCalls, expandAfterFirst);

	// Width changes must recompute rather than serve stale lines.
	const wide = chat.render(120).map(stripTerminalSequences).join("\n");
	assert.match(wide, /thinking: plan/);
	assert.ok(rebuilds > afterFirst);
	controller.uninstall();
});

// @lat: [[lat.md/proper-base/tests#Verification#Settled transcript fixture]]
test("settled transcript keeps thoughts and updates visible", () => {
	let idle = false;
	let expanded = false;
	const rowColors = new Map<string, string>();
	const markerColors = new Map<string, string>();
	const boldMarkers = new Set<string>();
	const chat = new Container();
	const listeners = new Set<(data: string) => unknown>();
	const scrollView = {};
	let viewportTop = 0;
	const document = new Container();
	document.addChild(new Container());
	document.addChild(new Container());
	document.addChild(chat);
	const tui = {
		children: [document],
		inputListeners: listeners,
		previousScreen: [] as string[],
		requestRender() {},
		addInputListener(listener: (data: string) => unknown) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getPrimaryScrollView: () => scrollView,
		getScrollSelectionPoint: (_view: unknown, x: number, y: number) => ({
			row: viewportTop + y,
			col: x,
		}),
		terminal: { rows: 24 },
	};
	listeners.add(() => ({ consume: true }));
	const ctx = {
		isIdle: () => idle,
		ui: {
			getToolsExpanded: () => expanded,
			theme: {
				fg: (color: string, text: string) => {
					if (text === "›" || text === "⌄") markerColors.set(text, color);
					const kind = /^(tool|error)\b/.exec(text)?.[1];
					if (kind) rowColors.set(kind, color);
					return text;
				},
				bold: (text: string) => {
					if (text === "›" || text === "⌄") boldMarkers.add(text);
					return text;
				},
				italic: (text: string) => text,
			},
		},
	};
	assert.equal(
		installTranscriptCleanup(
			{ children: [], terminal: { rows: 24 } } as never,
			ctx as never,
		),
		undefined,
	);
	const controller = installTranscriptCleanup(tui as never, ctx as never);
	assert.ok(controller);
	assert.equal(
		installTranscriptCleanup(tui as never, ctx as never),
		controller,
	);

	chat.addChild(
		new AssistantMessageComponent({
			content: [
				{ type: "thinking", thinking: "inspect image" },
				{ type: "text", text: "Image reply." },
			],
			stopReason: "stop",
		}),
	);
	chat.addChild(new UserMessageComponent("fix it"));
	const progressAssistant = new AssistantMessageComponent({
		content: [
			{ type: "thinking", thinking: "inspect files" },
			{ type: "text", text: "I will inspect.\nSecond line." },
			{ type: "toolCall" },
		],
		stopReason: "toolUse",
	});
	chat.addChild(progressAssistant);
	const mcpTool = new ToolExecutionComponent("tool-1");
	mcpTool.toolName = "mcp";
	mcpTool.args = { tool: "firecrawl_search" };
	chat.addChild(mcpTool);
	chat.addChild(new ToolExecutionComponent("tool-2", true));
	chat.addChild(new StatusComponent());
	const finalAssistant = new AssistantMessageComponent({
		content: [
			{ type: "thinking", thinking: "verify result" },
			{ type: "text", text: "Fixed." },
		],
		stopReason: "stop",
	});
	chat.addChild(finalAssistant);
	chat.addChild(new Spacer(1));
	chat.addChild(new UserMessageComponent("follow up"));
	chat.addChild(
		new AssistantMessageComponent({
			content: [{ type: "text", text: "Done again." }],
			stopReason: "stop",
		}),
	);

	const live = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(live, /inspect files/);
	assert.match(live, /I will inspect/);
	assert.match(live, /tool preview/);

	controller.completeAssistant(progressAssistant.lastMessage);
	const progressDoneLines = chat.render(100).map(stripTerminalSequences);
	const progressRow = progressDoneLines.findIndex((line) =>
		line.includes("assistant: I will inspect."),
	);
	assert.ok(progressRow > 0);
	assert.equal(progressDoneLines[progressRow - 1]?.trim(), "");
	assert.equal(progressDoneLines[progressRow + 1]?.trim(), "");
	assert.match(progressDoneLines[progressRow] ?? "", /Second line\./);
	assert.match(progressDoneLines.join("\n"), /thinking: inspect files/);
	assert.doesNotMatch(
		progressDoneLines.join("\n"),
		/thought · inspect files|update · I will inspect/,
	);

	controller.completeAssistant(finalAssistant.lastMessage);
	const assistantDone = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(assistantDone, /thinking: verify result/);
	assert.ok(
		assistantDone.indexOf("thinking: verify result") <
			assistantDone.indexOf("assistant: Fixed."),
	);
	assert.doesNotMatch(assistantDone, /thought · verify result/);
	assert.equal(assistantDone.match(/tool preview/g)?.length, 2);

	controller.completeTool("tool-1");
	const firstToolDone = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(firstToolDone, /tool · mcp · firecrawl_search/);
	assert.equal(firstToolDone.match(/tool preview/g)?.length, 1);

	idle = true;
	controller.settle();
	const collapsedRaw = chat.render(100);
	assert.equal(
		collapsedRaw.some((line) => line.includes("\x1b]8;;")),
		false,
	);
	const collapsedLines = collapsedRaw.map(stripTerminalSequences);
	const collapsed = collapsedLines.join("\n");
	assert.match(collapsed, /assistant: Image reply\./);
	assert.match(collapsed, /thinking: inspect image/);
	assert.match(collapsed, /assistant: Fixed\./);
	assert.match(collapsed, /thinking: inspect files/);
	assert.match(collapsed, /assistant: I will inspect\.\nSecond line\./);
	assert.doesNotMatch(collapsed, /update · I will inspect/);
	assert.match(collapsed, /tool · mcp · firecrawl_search/);
	assert.doesNotMatch(collapsed, /tool · mcp[ \t]*$/m);
	assert.match(collapsed, /error · read · src\/example\.ts/);
	assert.doesNotMatch(collapsed, /\(click\b/);
	assert.match(collapsed, /status: checking/);
	assert.doesNotMatch(collapsed, /update · status: checking/);
	const statusRow = collapsedLines.indexOf("status: checking");
	assert.ok(statusRow > 0);
	assert.equal(collapsedLines[statusRow - 1]?.trim(), "");
	assert.equal(collapsedLines[statusRow + 1]?.trim(), "");
	assert.match(collapsed, /thinking: verify result/);
	assert.doesNotMatch(collapsed, /thought ·/);
	assert.ok(
		collapsed.indexOf("status: checking") <
			collapsed.indexOf("assistant: Fixed."),
	);
	assert.deepEqual(Object.fromEntries(rowColors), {
		tool: "mdLink",
		error: "error",
	});
	assert.equal(new Set(rowColors.values()).size, 2);
	assert.equal(markerColors.get("›"), "borderAccent");
	assert.ok(boldMarkers.has("›"));
	assert.match(collapsed, /user: follow up\nassistant: Done again\./);
	chat.addChild(new Spacer(1));
	chat.addChild(new StatusComponent("Session: 12 messages, 4 tools"));
	const commandOutput = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(commandOutput, /Session: 12 messages, 4 tools/);
	assert.doesNotMatch(commandOutput, /update · Session:/);
	chat.addChild(
		new AssistantMessageComponent({
			content: [{ type: "text", text: "Continued." }],
			stopReason: "stop",
		}),
	);
	const continued = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(continued, /assistant: Continued\./);
	assert.doesNotMatch(collapsed, /thought ·|tool preview/);
	const rendered = chat.render(100);
	const targetRow = rendered.findIndex((line) =>
		stripTerminalSequences(line).startsWith("› tool · mcp · firecrawl_search"),
	);
	assert.ok(targetRow >= 0);
	viewportTop = Math.max(0, targetRow - 2);
	tui.previousScreen = rendered.slice(viewportTop, viewportTop + 24);
	const click = `\x1b[<0;1;${targetRow - viewportTop + 1}M`;
	let consumed = false;
	for (const listener of listeners) {
		if ((listener(click) as { consume?: boolean } | undefined)?.consume) {
			consumed = true;
			break;
		}
	}
	assert.equal(consumed, true);
	const clickedRaw = chat.render(100);
	assert.equal(
		clickedRaw.some((line) => line.includes("\x1b]8;;")),
		false,
	);
	const clicked = clickedRaw.map(stripTerminalSequences).join("\n");
	assert.equal(clicked.match(/tool output/g)?.length, 1);
	assert.match(clicked, /^⌄ tool · mcp · firecrawl_search/m);
	assert.equal(markerColors.get("⌄"), "borderAccent");
	assert.ok(boldMarkers.has("⌄"));
	assert.doesNotMatch(clicked, /\(click\b/);
	assert.match(clicked, / collapse /);
	assert.match(clicked, /thinking: inspect files/);
	assert.match(clicked, /thinking: inspect image/);
	assert.doesNotMatch(clicked, /thought ·/);
	tui.previousScreen = clickedRaw.slice(viewportTop, viewportTop + 24);
	const collapseRow = tui.previousScreen.findIndex((line) =>
		stripTerminalSequences(line).startsWith(" collapse "),
	);
	assert.ok(collapseRow >= 0);
	const collapseClick = `\x1b[<0;2;${collapseRow + 1}M`;
	for (const listener of listeners) {
		if (
			(listener(collapseClick) as { consume?: boolean } | undefined)?.consume
		) {
			break;
		}
	}
	const recollapsed = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.doesNotMatch(recollapsed, /tool output| collapse /);

	// A wheel scroll advances scrollTop before the throttled repaint lands, so
	// the mapped content row names a row the click never landed on.
	const stale = chat.render(100);
	const staleRow = stale.findIndex((line) =>
		stripTerminalSequences(line).startsWith("› tool · mcp · firecrawl_search"),
	);
	assert.ok(staleRow >= 0);
	const paintedTop = Math.max(0, staleRow - 2);
	tui.previousScreen = stale.slice(paintedTop, paintedTop + 24);
	viewportTop = paintedTop + 3;
	const staleClick = `\x1b[<0;1;${staleRow - paintedTop + 1}M`;
	for (const listener of listeners) {
		if ((listener(staleClick) as { consume?: boolean } | undefined)?.consume) {
			break;
		}
	}
	viewportTop = paintedTop;
	const afterStale = chat.render(100);
	assert.match(
		afterStale.map(stripTerminalSequences).join("\n"),
		/^⌄ tool · mcp · firecrawl_search/m,
	);
	tui.previousScreen = afterStale.slice(paintedTop, paintedTop + 24);
	for (const listener of listeners) {
		if ((listener(staleClick) as { consume?: boolean } | undefined)?.consume) {
			break;
		}
	}
	assert.doesNotMatch(
		chat.render(100).map(stripTerminalSequences).join("\n"),
		/tool output| collapse /,
	);

	idle = false;
	controller.start();
	chat.addChild(new Spacer(1));
	chat.addChild(new UserMessageComponent("active prompt"));
	const activeAssistant = new AssistantMessageComponent({
		content: [
			{ type: "thinking", thinking: "active thinking" },
			{ type: "toolCall" },
		],
		stopReason: "toolUse",
	});
	chat.addChild(activeAssistant);
	const activeTool = new ToolExecutionComponent("tool-active");
	activeTool.args = { path: "src/active.ts" };
	chat.addChild(activeTool);
	const runningAgain = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(runningAgain, /thinking: inspect image/);
	assert.match(runningAgain, /thinking: inspect files/);
	assert.match(runningAgain, /thinking: verify result/);
	assert.match(runningAgain, /active thinking/);
	assert.match(runningAgain, /tool preview/);

	controller.completeAssistant(activeAssistant.lastMessage);
	const activeAssistantDone = chat
		.render(100)
		.map(stripTerminalSequences)
		.join("\n");
	assert.match(activeAssistantDone, /thinking: active thinking/);
	assert.doesNotMatch(activeAssistantDone, /thought · active thinking/);
	controller.completeTool("tool-active");
	// Pi 0.85.0's default label has no ellipsis; the hint suffix is Pi's own.
	const working = new StatusComponent("Working (esc to interrupt)");
	const nextAssistant = new AssistantMessageComponent({
		content: [],
		stopReason: "stop",
	});
	chat.addChild(working);
	chat.addChild(nextAssistant);
	const waiting = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(waiting, /tool preview/);
	assert.doesNotMatch(waiting, /tool · read · src\/active\.ts/);
	nextAssistant.updateContent({
		content: [{ type: "thinking", thinking: "next section" }],
		stopReason: "stop",
	});
	const advanced = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(advanced, /tool · read · src\/active\.ts/);
	assert.match(advanced, /thinking: next section/);
	chat.removeChild(working);
	idle = true;
	controller.settle();

	expanded = true;
	const expandedOutput = chat
		.render(100)
		.map(stripTerminalSequences)
		.join("\n");
	assert.match(expandedOutput, /inspect files/);
	assert.match(expandedOutput, /I will inspect/);
	assert.match(expandedOutput, /verify result/);
	assert.match(expandedOutput, /tool output/);
	assert.match(expandedOutput, /status: checking/);
	assert.doesNotMatch(expandedOutput, /thought ·/);

	controller.uninstall();
	controller.uninstall();
	const restored = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(restored, /thinking: inspect files/);
});

// @lat: [[lat.md/proper-base/tests#Verification#Settled transcript fixture]]
test("the settled outline records one row per action in order", () => {
	const chat = new Container();
	const document = new Container();
	document.addChild(new Container());
	document.addChild(new Container());
	document.addChild(chat);
	const listeners = new Set<(data: string) => unknown>();
	const tui = {
		children: [document],
		inputListeners: listeners,
		requestRender() {},
		addInputListener(listener: (data: string) => unknown) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		terminal: { rows: 24 },
	};
	const ctx = {
		isIdle: () => true,
		ui: {
			getToolsExpanded: () => false,
			theme: {
				fg: (_color: string, text: string) => text,
				bold: (text: string) => text,
				italic: (text: string) => text,
			},
		},
	};
	const controller = installTranscriptCleanup(tui as never, ctx as never);
	assert.ok(controller);
	chat.addChild(new UserMessageComponent("fix it"));
	chat.addChild(
		new AssistantMessageComponent({
			content: [{ type: "text", text: "done" }],
			stopReason: "stop",
		}),
	);
	chat.addChild(new ToolExecutionComponent("tool-1"));
	chat.addChild(new ToolExecutionComponent("tool-2", true));
	controller.settle();

	const rendered = chat.render(80);
	assert.deepEqual(controller.outline(), [
		{ kind: "user", row: 0, label: "prompt" },
		{ kind: "assistant", row: 1, label: "reply" },
		{ kind: "tool", row: 2, label: "read" },
		{ kind: "error", row: 3, label: "read" },
	]);
	// Rows point at each action's first rendered line.
	assert.equal(stripTerminalSequences(rendered[0] ?? ""), "user: fix it");
	assert.ok(stripTerminalSequences(rendered[2] ?? "").includes("tool · read"));

	controller.uninstall();
});
