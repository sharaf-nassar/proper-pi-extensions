import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import {
	AgentSession,
	ExtensionRunner,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import properCompact from "../compact.ts";

export const model: any = {
	provider: "fixture",
	id: "summary",
	name: "Fixture",
	api: "openai-responses",
	baseUrl: "http://127.0.0.1:1",
	reasoning: true,
	input: ["text"],
	contextWindow: 272000,
	maxTokens: 128000,
	cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1 },
};
export const usage: any = {
	input: 100,
	output: 50,
	cacheRead: 10,
	cacheWrite: 0,
	reasoning: 5,
	cacheWrite1h: 0,
	totalTokens: 160,
	cost: {
		input: 0.1,
		output: 0.05,
		cacheRead: 0.01,
		cacheWrite: 0,
		total: 0.16,
		totalFromProvider: true,
	},
};
export const checkpoint = (evidence = "SOURCE_EVIDENCE") =>
	`<summary>\n${["Goal", "Constraints & Preferences", "Progress", "Key Decisions", "Next Steps", "Critical Context", "Artifacts and Evidence"].map((heading) => `## ${heading}\n${evidence}`).join("\n\n")}\n</summary>`;
export const response = (text = checkpoint(), stopReason = "stop"): any => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: model.api,
	provider: model.provider,
	model: model.id,
	usage: structuredClone(usage),
	stopReason,
	timestamp: 1,
});
export const user = (text: string): any => ({
	role: "user",
	content: text,
	timestamp: 1,
});
export const assistant = (text: string): any => response(text);
export function addTool(
	manager: SessionManager,
	id: string,
	text: string,
	isError = false,
	name = "bash",
	args: any = { command: "npm test" },
): string {
	manager.appendMessage({
		...response(),
		content: [{ type: "toolCall", id, name, arguments: args }],
		stopReason: "toolUse",
	});
	return manager.appendMessage({
		role: "toolResult",
		toolCallId: id,
		toolName: name,
		content: [{ type: "text", text }],
		isError,
		timestamp: 2,
	});
}
export async function fixture(t: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), "proper-compact-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const configPath = join(directory, "config.json");
	const manager = SessionManager.inMemory(directory);
	const handlers = new Map<string, any[]>();
	const commands = new Map<string, any>();
	const tools = new Map<string, any>();
	const calls: any[] = [];
	const notices: string[] = [];
	const errors: any[] = [];
	const events: any[] = [];
	let complete: (...args: any[]) => any = () => response();
	const registry: any = {
		getAvailable: () => [model],
		streamSimple(...args: any[]) {
			calls.push(args);
			return { result: () => Promise.resolve(complete(...args)) };
		},
	};
	properCompact(
		{
			on(name: string, handler: any) {
				handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			},
			registerCommand(name: string, command: any) {
				commands.set(name, command);
			},
			registerTool(tool: any) {
				tools.set(tool.name, tool);
			},
			appendEntry(type: string, data: unknown) {
				manager.appendCustomEntry(type, data);
			},
		} as any,
		configPath,
	);
	const extension: any = { path: "proper-compact", handlers, commands };
	const runner: any = new ExtensionRunner(
		[extension],
		{ getThinkingLevel: () => "high" } as any,
		directory,
		manager,
		registry,
	);
	runner.getModel = () => model;
	runner.setUIContext(
		{ notify: (message: string) => notices.push(message) } as any,
		"tui",
	);
	runner.onError((error: any) => errors.push(error));
	const session: any = Object.create(AgentSession.prototype);
	let fallbacks = 0;
	Object.assign(session, {
		_entryIdsByMessage: new WeakMap(),
		agent: { state: { model, thinkingLevel: "high", messages: [] } },
		sessionManager: manager,
		settingsManager: {
			getCompactionSettings: () => ({
				enabled: true,
				reserveTokens: 16384,
				keepRecentTokens: 50,
			}),
		},
		_extensionRunner: runner,
		abort: async () => {},
		_emit: (event: unknown) => events.push(event),
		_resolveIdleWaitIfIdle() {},
		_getSummarizationRequestAuth: async () => ({
			model,
			apiKey: "fixture-only",
		}),
		_runDefaultCompaction: async (preparation: any) => {
			fallbacks++;
			return {
				summary: "STOCK FALLBACK",
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
				usage: structuredClone(usage),
			};
		},
	});
	await runner.emit({ type: "session_start", reason: "startup" });
	function populate(
		text = `${"ordinary log\n".repeat(400)}INTERIOR_OR_TRAILING_FAILURE`,
	) {
		manager.appendMessage(
			user("Fix authorization. Never remove the authorization check."),
		);
		const resultId = addTool(manager, "test-1", text, true);
		manager.appendMessage(assistant("Investigating exact failure."));
		manager.appendMessage(
			user("Continue the retained investigation. ".repeat(25)),
		);
		return resultId;
	}
	return {
		directory,
		configPath,
		manager,
		calls,
		notices,
		errors,
		events,
		registry,
		runner,
		session,
		tools,
		commands,
		handlers,
		populate,
		fallbacks: () => fallbacks,
		complete(fn: (...args: any[]) => any) {
			complete = fn;
		},
	};
}
