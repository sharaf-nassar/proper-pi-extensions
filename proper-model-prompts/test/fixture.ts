import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import {
	createFauxCore,
	fauxAssistantMessage,
	getCurrentSystemMessage,
	getCurrentSystemPrompt,
	getSystemMessageText,
	InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import properModelPrompts, {
	CONFIG_FILE,
	type Mode,
	SECTION,
} from "../model-prompts.ts";

export interface Request {
	model: string;
	/** The prompt the provider sees after replaying every system message. */
	prompt: string;
	/** The leading system message's own text, as sent at the head. */
	head: string;
}

/**
 * A real AgentSession whose provider records each request instead of calling
 * a model. Extensions load in the given order; ours is added where `self` is.
 */
export async function session(
	t: TestContext,
	options: {
		config?: unknown;
		before?: ExtensionFactory[];
		after?: ExtensionFactory[];
		model?: string;
		/** Load a second copy of this extension, as a stale registration would. */
		twice?: boolean;
		/** The run mode extensions see; the terminal UI by default. */
		mode?: Mode;
		/** Tool names another extension registers, such as pi-subagents' `subagent`. */
		tools?: string[];
		/** The answer to every confirmation dialog; dialogs are recorded. */
		confirm?: boolean;
		/** Runs before the session starts, with the agent directory. */
		prepare?: (dir: string) => Promise<void>;
		/** Where the extension believes it was loaded from; this checkout by default. */
		packageDir?: (dir: string) => string;
	} = {},
) {
	const dir = await mkdtemp(join(tmpdir(), "proper-model-prompts-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const configPath = join(dir, CONFIG_FILE);
	if (options.config !== undefined)
		await writeFile(configPath, JSON.stringify(options.config));
	await options.prepare?.(dir);
	const requests: Request[] = [];
	const notices: string[] = [];
	const confirms: string[] = [];
	const tools: ExtensionFactory = (pi) => {
		for (const name of options.tools ?? [])
			pi.registerTool({
				name,
				label: name,
				description: `Fixture ${name} tool`,
				parameters: { type: "object", properties: {} } as never,
				execute: async () => ({ content: [], details: undefined }),
			});
	};
	const faux = createFauxCore({
		provider: "cliproxyapi",
		models: [
			{ id: "claude-opus-5" },
			{ id: "gpt-6-sol" },
			{ id: "glm-5.3-flash" },
		],
	});
	const respond = () =>
		faux.setResponses(
			Array.from({ length: 8 }, () => (context, _options, _state, model) => {
				const head = context.messages[0];
				requests.push({
					model: model.id,
					prompt: getCurrentSystemPrompt(context.messages),
					head: head?.role === "system" ? getSystemMessageText(head) : "",
				});
				return fauxAssistantMessage("ok");
			}),
		);
	respond();
	const modelRuntime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		refreshOnCreate: false,
		modelsPath: null,
	});
	modelRuntime.registerProvider("cliproxyapi", {
		api: faux.api,
		baseUrl: "http://127.0.0.1:1",
		apiKey: "fixture-only",
		streamSimple: faux.streamSimple,
		models: faux.models.map((model) => ({
			id: model.id,
			name: model.name,
			reasoning: false,
			input: ["text"],
			cost: model.cost,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
		})),
	});
	await modelRuntime.setRuntimeApiKey("cliproxyapi", "fixture-only");
	const model = (id: string) => {
		const found = modelRuntime.getModel("cliproxyapi", id);
		if (!found) throw new Error(`fixture model ${id} is missing`);
		return found;
	};
	const packageDir = options.packageDir?.(dir);
	const self: ExtensionFactory = (pi) =>
		packageDir === undefined
			? properModelPrompts(pi, configPath)
			: properModelPrompts(pi, configPath, packageDir);
	const settingsManager = SettingsManager.inMemory({
		retry: { enabled: false },
	});
	const loader = new DefaultResourceLoader({
		cwd: dir,
		agentDir: dir,
		settingsManager,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		extensionFactories: [
			tools,
			...(options.before ?? []),
			self,
			...(options.twice ? [self] : []),
			...(options.after ?? []),
		],
	});
	await loader.reload();
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: dir,
		model: model(options.model ?? "claude-opus-5"),
		modelRuntime,
		settingsManager,
		sessionManager: SessionManager.inMemory(dir),
		resourceLoader: loader,
	});
	session.extensionRunner.setUIContext(
		{
			notify: (message: string) => notices.push(message),
			confirm: async (title: string, message: string) => {
				confirms.push(`${title}\n${message}`);
				return options.confirm ?? false;
			},
		} as never,
		options.mode ?? "tui",
	);
	await session.extensionRunner.emit({
		type: "session_start",
		reason: "startup",
	});
	t.after(async () => {
		await session.extensionRunner.emit({
			type: "session_shutdown",
			reason: "quit",
		});
		session.dispose();
	});
	return {
		dir,
		configPath,
		requests,
		notices,
		confirms,
		session,
		async ask(text = "hi") {
			await session.prompt(text);
			const last = requests.at(-1);
			if (!last)
				throw new Error(
					`no provider request was recorded: ${JSON.stringify(session.messages.at(-1))}`,
				);
			return last;
		},
		async use(id: string) {
			await session.setModel(model(id));
		},
		/** The appended section as the session transcript records it. */
		recorded() {
			const { messages } = session.sessionManager.buildSessionProjection();
			return getCurrentSystemMessage(messages as never)?.sections?.[SECTION];
		},
		async config(value: unknown) {
			await writeFile(
				configPath,
				typeof value === "string" ? value : JSON.stringify(value),
			);
		},
	};
}
