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
test("settled transcript keeps only direct replies until process details expand", () => {
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
					const kind = /^(?:▸|▾) (thought|tool|update|error)\b/.exec(text)?.[1];
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
	chat.addChild(
		new AssistantMessageComponent({
			content: [
				{ type: "thinking", thinking: "inspect files" },
				{ type: "text", text: "I will inspect." },
				{ type: "toolCall" },
			],
			stopReason: "toolUse",
		}),
	);
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

	controller.completeAssistant(finalAssistant.lastMessage);
	const assistantDone = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(assistantDone, /thought · verify result/);
	assert.ok(
		assistantDone.indexOf("thought · verify result") <
			assistantDone.indexOf("assistant: Fixed."),
	);
	assert.doesNotMatch(assistantDone, /thinking: verify result/);
	assert.equal(assistantDone.match(/tool preview/g)?.length, 2);

	controller.completeTool("tool-1");
	const firstToolDone = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(firstToolDone, /tool · read · src\/example\.ts/);
	assert.equal(firstToolDone.match(/tool preview/g)?.length, 1);

	idle = true;
	controller.settle();
	const collapsed = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(collapsed, /assistant: Image reply\./);
	assert.match(collapsed, /thought · inspect image/);
	assert.match(collapsed, /assistant: Fixed\./);
	assert.match(collapsed, /thought · inspect files/);
	assert.match(collapsed, /update · I will inspect/);
	assert.match(collapsed, /tool · read · src\/example\.ts/);
	assert.match(collapsed, /error · read · src\/example\.ts/);
	assert.match(collapsed, /update · status: checking/);
	assert.match(collapsed, /thought · verify result/);
	assert.ok(
		collapsed.indexOf("update · status: checking") <
			collapsed.indexOf("assistant: Fixed."),
	);
	assert.deepEqual(Object.fromEntries(rowColors), {
		thought: "thinkingHigh",
		update: "accent",
		tool: "mdLink",
		error: "error",
	});
	assert.equal(new Set(rowColors.values()).size, 4);
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
	assert.doesNotMatch(
		collapsed,
		/thinking: inspect files|assistant: I will inspect|thinking: verify result|tool preview/,
	);
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
	assert.doesNotMatch(
		clicked,
		/thinking: inspect files|thinking: inspect image/,
	);
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
	chat.addChild(
		new AssistantMessageComponent({
			content: [
				{ type: "thinking", thinking: "active thinking" },
				{ type: "toolCall" },
			],
			stopReason: "toolUse",
		}),
	);
	chat.addChild(new ToolExecutionComponent("tool-active"));
	const runningAgain = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.doesNotMatch(
		runningAgain,
		/thinking: inspect image|thinking: inspect files|thinking: verify result/,
	);
	assert.match(runningAgain, /active thinking/);
	assert.match(runningAgain, /tool preview/);
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

	controller.uninstall();
	controller.uninstall();
	const restored = chat.render(100).map(stripTerminalSequences).join("\n");
	assert.match(restored, /thinking: inspect files/);
});
