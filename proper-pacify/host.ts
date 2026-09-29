import { AsyncLocalStorage } from "node:async_hooks";
import {
	AgentSession,
	type ExtensionContext,
	type InputEvent,
	type InputEventResult,
	InteractiveMode,
	type MarkdownTransformer,
	type PromptOptions,
	type SessionManager,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
	installWrapper,
	ORIGINAL_INPUT,
	originalInput,
} from "./host-interop.ts";

type Message = Parameters<SessionManager["appendMessage"]>[0];
type PromptDisposition = Parameters<
	NonNullable<PromptOptions["preflightResult"]>
>[0];
export type RewriteOrigin = { entryId: string; before: string };
export type InputDecision = {
	result: InputEventResult;
	origin?: RewriteOrigin;
};

export interface PacifyHostHooks {
	active: boolean;
	manager: ExtensionContext["sessionManager"] | undefined;
	transformer: MarkdownTransformer;
	displayRevision: number;
	prepare(
		ctx: ExtensionContext,
		event: Pick<InputEvent, "text" | "images" | "source">,
	): Promise<InputDecision>;
	bind(message: Message, origin: RewriteOrigin): void;
	persist(message: Message, entryId: string, manager: SessionManager): void;
	transform(message: Message, ...args: Parameters<MarkdownTransformer>): string;
}

// Pi 0.85.1 has neither a pre-command input hook nor message identity in its
// Markdown context. Keep the host adapter here; remove it when those APIs exist.
// @lat: [[proper-pacify#Dispatch priority]]
export function installHostHooks(hooks: PacifyHostHooks): {
	inDispatch(): boolean;
	dispose(): void;
} {
	const dispatch = new AsyncLocalStorage<{
		origin: RewriteOrigin | undefined;
		bound: boolean;
	}>();
	const restorers: Array<() => void> = [];
	const boundAgents = new WeakSet<AgentSession["agent"]>();
	const boundManagers = new WeakSet<SessionManager>();
	let admission = Promise.resolve();
	const reservations = new Set<() => void>();

	async function reserveAdmission(): Promise<() => void> {
		const previous = admission;
		let release!: () => void;
		admission = new Promise<void>((resolve) => {
			release = () => {
				reservations.delete(release);
				resolve();
			};
		});
		reservations.add(release);
		await previous;
		return release;
	}

	function bindSession(session: AgentSession): void {
		const agent = session.agent;
		if (!boundAgents.has(agent)) {
			boundAgents.add(agent);
			// These public Agent entry points see the actual message objects after
			// all transformations/expansion, including queued steering/follow-ups.
			for (const name of ["prompt", "steer", "followUp"] as const) {
				const original = agent[name];
				const wrapped = function (this: typeof agent, ...args: unknown[]) {
					const scope = dispatch.getStore();
					if (hooks.active && scope?.origin && !scope.bound) {
						const messages = Array.isArray(args[0]) ? args[0] : [args[0]];
						const message = messages.find((value) => value?.role === "user");
						if (message) {
							hooks.bind(message, scope.origin);
							scope.bound = true;
						}
					}
					return Reflect.apply(original, this, args);
				};
				restorers.push(installWrapper(agent, name, wrapped));
			}
		}
		const manager = session.sessionManager;
		if (!boundManagers.has(manager)) {
			boundManagers.add(manager);
			const append = manager.appendMessage;
			const wrapped: typeof append = function (this: SessionManager, message) {
				const id = append.call(this, message);
				if (hooks.active) hooks.persist(message, id, this);
				return id;
			};
			restorers.push(installWrapper(manager, "appendMessage", wrapped));
		}
	}

	const prompt = AgentSession.prototype.prompt;
	const wrappedPrompt: typeof prompt = async function (
		this: AgentSession,
		text,
		options,
	) {
		if (!hooks.active || this.sessionManager !== hooks.manager) {
			return prompt.call(this, text, options);
		}
		bindSession(this);
		// Every registered command may synchronously submit a nested prompt, not
		// just our own. Preserve Pi's command-before-busy-check semantics.
		const commandName = text.startsWith("/")
			? text.slice(1).split(" ")[0]
			: undefined;
		const command =
			options?.expandPromptTemplates !== false && commandName
				? this.extensionRunner.getCommand(commandName)
				: undefined;
		const release = command ? () => {} : await reserveAdmission();
		let released = false;
		const settle = () => {
			if (released) return;
			released = true;
			release();
		};
		let preflightReported = false;
		// Pi reports how an accepted prompt was dispatched and stays silent on
		// rejection, so errors only free admission.
		const report = (disposition: PromptDisposition) => {
			if (preflightReported) return;
			preflightReported = true;
			settle();
			options?.preflightResult?.(disposition);
		};
		try {
			if (!hooks.active) {
				report("handled");
				return;
			}
			if (!command && this.isStreaming && !options?.streamingBehavior) {
				throw new Error(
					"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
				);
			}
			const decision = await hooks.prepare(
				this.extensionRunner.createContext(),
				{
					text,
					source: options?.source ?? "interactive",
					...(options?.images ? { images: options.images } : {}),
				},
			);
			if (!hooks.active || decision.result.action === "handled") {
				report("handled");
				return;
			}
			const result = decision.result;
			const forwarded = {
				...options,
				[ORIGINAL_INPUT]: originalInput(text, options),
				preflightResult: report,
				...(result.action === "transform" && result.images
					? { images: result.images }
					: {}),
			};

			return dispatch.run({ origin: decision.origin, bound: false }, () =>
				prompt
					.call(
						this,
						result.action === "transform" ? result.text : text,
						forwarded,
					)
					.finally(settle),
			);
		} catch (error) {
			settle();
			throw error;
		}
	};
	restorers.push(
		installWrapper(AgentSession.prototype, "prompt", wrappedPrompt),
	);

	for (const name of ["steer", "followUp"] as const) {
		const original = AgentSession.prototype[name];
		const wrapped: typeof original = async function (
			this: AgentSession,
			...args
		) {
			const [text, images, options] = args;
			if (!hooks.active || this.sessionManager !== hooks.manager) {
				return original.apply(this, args);
			}
			bindSession(this);
			const decision = await hooks.prepare(
				this.extensionRunner.createContext(),
				{
					text,
					source: options?.source ?? "interactive",
					...(images ? { images } : {}),
				},
			);
			if (!hooks.active || decision.result.action === "handled")
				return "handled";
			const result = decision.result;
			const forwarded = {
				...options,
				[ORIGINAL_INPUT]: originalInput(text, options),
			};
			return dispatch.run({ origin: decision.origin, bound: false }, () =>
				original.call(
					this,
					result.action === "transform" ? result.text : text,
					result.action === "transform" && result.images
						? result.images
						: images,
					forwarded,
				),
			);
		};
		restorers.push(installWrapper(AgentSession.prototype, name, wrapped));
	}

	// Capture identity at component construction, not by text during rendering.
	// The host still builds and renders its own user components and transformers.
	type InteractiveHost = {
		session: AgentSession;
		chatContainer: { children: unknown[] };
		getMarkdownTransformers(): MarkdownTransformer[];
		addMessageToChat(message: Message, options?: unknown): void;
	};
	const prototype = InteractiveMode.prototype as unknown as InteractiveHost;
	const addMessage = prototype.addMessageToChat;
	const wrappedAdd: typeof addMessage = function (
		this: InteractiveHost,
		message,
		options,
	) {
		if (!hooks.active || message.role !== "user") {
			return addMessage.call(this, message, options);
		}
		const get = this.getMarkdownTransformers;
		// Reload rebuilds chat before session_start assigns the manager. The
		// runner's marker identifies ownership even during that pre-start phase.
		if (!get.call(this).includes(hooks.transformer))
			return addMessage.call(this, message, options);
		const own = Object.hasOwn(this, "getMarkdownTransformers");
		const getForMessage = () =>
			get
				.call(this)
				.map((transformer) =>
					transformer === hooks.transformer
						? (...args: Parameters<MarkdownTransformer>) =>
								hooks.active ? hooks.transform(message, ...args) : args[0]
						: transformer,
				);
		const start = this.chatContainer.children.length;
		this.getMarkdownTransformers = getForMessage;
		try {
			addMessage.call(this, message, options);
		} finally {
			if (this.getMarkdownTransformers === getForMessage) {
				if (own) this.getMarkdownTransformers = get;
				else Reflect.deleteProperty(this, "getMarkdownTransformers");
			}
		}
		for (const component of this.chatContainer.children.slice(start)) {
			if (!(component instanceof UserMessageComponent)) continue;
			const render = component.render;
			let revision = hooks.displayRevision;
			component.render = (width) => {
				if (revision !== hooks.displayRevision) {
					revision = hooks.displayRevision;
					component.invalidate();
				}
				return render.call(component, width);
			};
		}
	};
	restorers.push(installWrapper(prototype, "addMessageToChat", wrappedAdd));

	return {
		inDispatch: () => dispatch.getStore() !== undefined,
		dispose() {
			hooks.active = false;
			for (const release of reservations) release();
			hooks.displayRevision++;
			for (const restore of restorers.reverse()) restore();
			dispatch.disable();
		},
	};
}
