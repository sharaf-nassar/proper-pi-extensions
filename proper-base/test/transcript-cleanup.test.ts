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
	args = { path: "src/example.ts" };
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

// @lat: [[lat.md/proper-base/tests#Verification#Settled transcript fixture]]
test("settled transcript keeps thoughts and updates visible", () => {
	let idle = false;
	let expanded = false;
	const rowColors = new Map<string, string>();
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
		terminal: { rows: 24 },
	};
	listeners.add(() => ({ consume: true }));
	const ctx = {
		isIdle: () => idle,
		ui: {
			getToolsExpanded: () => expanded,
			theme: {
				fg: (color: string, text: string) => {
					const kind = /^(?:▸|▾) (tool|error)\b/.exec(text)?.[1];
					if (kind) rowColors.set(kind, color);
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
			{ getKeys: () => [] },
		),
		undefined,
	);
	const controller = installTranscriptCleanup(tui as never, ctx as never, {
		getKeys: () => ["ctrl+o"],
	});
	assert.ok(controller);
	assert.equal(
		installTranscriptCleanup(tui as never, ctx as never, {
			getKeys: () => ["alt+o"],
		}),
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
	chat.addChild(new ToolExecutionComponent("tool-1"));
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
	assert.match(firstToolDone, /tool · read · src\/example\.ts/);
	assert.equal(firstToolDone.match(/tool preview/g)?.length, 1);

	idle = true;
	controller.settle();
	const collapsedLines = chat.render(100).map(stripTerminalSequences);
	const collapsed = collapsedLines.join("\n");
	assert.match(collapsed, /assistant: Image reply\./);
	assert.match(collapsed, /thinking: inspect image/);
	assert.match(collapsed, /assistant: Fixed\./);
	assert.match(collapsed, /thinking: inspect files/);
	assert.match(collapsed, /assistant: I will inspect\.\nSecond line\./);
	assert.doesNotMatch(collapsed, /update · I will inspect/);
	assert.match(collapsed, /tool · read · src\/example\.ts/);
	assert.match(collapsed, /error · read · src\/example\.ts/);
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
	tui.previousScreen = chat.render(100);
	const targetRow = tui.previousScreen.findIndex((line) =>
		stripTerminalSequences(line).startsWith("▸ tool · read"),
	);
	assert.ok(targetRow >= 0);
	const click = `\x1b[<0;1;${targetRow + 1}M`;
	let consumed = false;
	for (const listener of listeners) {
		if ((listener(click) as { consume?: boolean } | undefined)?.consume) {
			consumed = true;
			break;
		}
	}
	assert.equal(consumed, true);
	const clicked = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.equal(clicked.match(/tool output/g)?.length, 1);
	assert.match(clicked, / collapse /);
	assert.match(clicked, /thinking: inspect files/);
	assert.match(clicked, /thinking: inspect image/);
	assert.doesNotMatch(clicked, /thought ·/);
	tui.previousScreen = chat.render(100);
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
	const working = new StatusComponent("Working...");
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
