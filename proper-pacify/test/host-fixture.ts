import {
	AgentSession,
	type ExtensionAPI,
	ExtensionRunner,
	getMarkdownTheme,
	InteractiveMode,
	initTheme,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";

// Keep Pi's real prompt dispatch, expansion, runner and transcript components.
// Only the agent/model transport and terminal I/O are replaced for offline tests.
export function createHostFixture(register: (pi: ExtensionAPI) => void) {
	initTheme("dark", false);
	const manager = SessionManager.inMemory();
	const handlers = new Map<string, any[]>();
	const commands = new Map<string, any>();
	const foreignSeen: string[] = [];
	const commandsSeen: string[] = [];
	const sent: any[] = [];
	const queued: any[] = [];
	const completions: any[] = [];
	const notifications: string[] = [];
	const emitted: Promise<void>[] = [];
	const model = {
		provider: "test",
		id: "rewrite",
		api: "openai-responses",
		reasoning: true,
		maxTokens: 8192,
		contextWindow: 200000,
	};
	let extension: any;
	let renderers: Map<string, any>;
	let reply = "fix the parser now";
	const registry: any = {
		getAvailable: () => [model],
		async complete(...args: unknown[]) {
			completions.push(args);
			return {
				stopReason: "stop",
				content: [{ type: "text", text: `<rewrite>${reply}</rewrite>` }],
			};
		},
	};
	const foreign: any = {
		path: "foreign",
		handlers: new Map([
			[
				"input",
				[
					(event: any) => {
						foreignSeen.push(event.text);
						manager.appendModelChange("test", "selected-by-router");
						return { action: "continue" };
					},
				],
			],
		]),
		commands: new Map([
			[
				"foreign",
				{
					name: "foreign",
					handler: async (args: string) => {
						commandsSeen.push(args);
					},
				},
			],
		]),
	};
	let runner: any;
	const session: any = Object.create(AgentSession.prototype);
	const agent: any = {
		state: { model, thinkingLevel: "medium", tools: [], messages: [] },
		async prompt(messages: any[]) {
			for (const message of messages) {
				agent.state.messages.push(message);
				if (message.role === "user") sent.push(message);
				manager.appendMessage(message);
			}
		},
		steer: (message: any) => {
			queued.push(message);
		},
		followUp: (message: any) => {
			queued.push(message);
		},
	};
	Object.assign(session, {
		// Keep image-identity checks independent of Pi's native resizing.
		settingsManager: { getImageAutoResize: () => false },
		agent,
		sessionManager: manager,
		_modelRuntime: { hasConfiguredAuth: () => true },
		_pendingNextTurnMessages: [],
		_steeringMessages: [],
		_followUpMessages: [],
		_emitQueueUpdate() {},
		_toolRegistry: new Map(),
		_baseSystemPromptOptions: {
			cwd: process.cwd(),
			selectedTools: [],
			toolSnippets: {},
			toolGuidelines: {},
			promptGuidelines: [],
			appendSystemPrompt: "",
			sections: {},
			contextFiles: [],
			skills: [],
		},
		_resourceLoader: {
			getPrompts: () => ({ prompts: [] }),
			getSkills: () => ({ skills: [] }),
		},
		_flushPendingBashMessages() {},
		_flushPendingCustomMessages() {},
		_findLastAssistantMessage: () => undefined,
		// Pi 1.4.0 starts runs through _startRun; keep only prompt preparation
		// and skip the post-run loop the fake agent cannot drive.
		async _startRun(trigger: unknown, onStarted?: () => void) {
			const messages = await session._prepareRun(trigger);
			onStarted?.();
			await agent.prompt(messages);
		},
	});
	const pi: any = {
		registerEntryRenderer(type: string, renderer: any) {
			renderers.set(type, renderer);
		},
		registerMarkdownTransformer(transformer: any) {
			extension.markdownTransformer = transformer;
		},
		registerCommand(name: string, command: any) {
			commands.set(name, { ...command, name });
		},
		on(name: string, handler: any) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		appendEntry: (type: string, data: unknown) => {
			manager.appendCustomEntry(type, data);
		},
		sendUserMessage(text: string, options: any) {
			emitted.push(session.prompt(text, { ...options, source: "extension" }));
		},
	};
	function load() {
		handlers.clear();
		commands.clear();
		renderers = new Map();
		extension = {
			path: "pacify",
			handlers,
			commands,
			entryRenderers: renderers,
		};
		register(pi);
		runner = new ExtensionRunner(
			[foreign, extension],
			{} as any,
			process.cwd(),
			manager,
			registry,
		);
		runner.getModel = () => model as any;
		runner.setUIContext(
			{
				notify: (message: string) => notifications.push(message),
				onTerminalInput: () => () => {},
				theme: {
					fg: (_token: string, text: string) => text,
					strikethrough: (text: string) => `REMOVED(${text})`,
				},
			} as any,
			"tui",
		);
		session._extensionRunner = runner;
	}
	load();
	const ui: any = {
		session,
		chatContainer: new Container(),
		outputPad: 1,
		getMarkdownThemeWithSettings: getMarkdownTheme,
		getMarkdownTransformers: () => runner.getMarkdownTransformers(),
		getUserMessageText: (message: any) =>
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((part: any) => part.type === "text")
						.map((part: any) => part.text)
						.join(""),
	};
	return {
		manager,
		session,
		agent,
		registry,
		handlers,
		commands,
		pi,
		foreignSeen,
		commandsSeen,
		sent,
		queued,
		completions,
		notifications,
		emitted,
		setReply(text: string) {
			reply = text;
		},
		start(reason = "startup") {
			return runner.emit({ type: "session_start", reason } as any);
		},
		async reload(beforeSessionStart?: () => void) {
			await runner.emit({ type: "session_shutdown", reason: "reload" });
			load();
			beforeSessionStart?.();
			await runner.emit({ type: "session_start", reason: "reload" });
		},
		shutdown() {
			return runner.emit({ type: "session_shutdown", reason: "reload" });
		},
		context() {
			return runner.createContext();
		},
		component(message: any) {
			(InteractiveMode.prototype as any).addMessageToChat.call(ui, message);
			return ui.chatContainer.children.at(-1);
		},
	};
}
