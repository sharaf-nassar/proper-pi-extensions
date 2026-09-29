import { AsyncLocalStorage } from "node:async_hooks";
import {
	AgentSession,
	InteractiveMode,
	type MarkdownTransformer,
	type SessionManager,
} from "@earendil-works/pi-coding-agent";
import { installWrapper, originalInput } from "./host-interop.ts";
import type { PromptDisplayController } from "./prompt-display.ts";
import { splitSkillText } from "./skill-context.ts";

type Message = Parameters<SessionManager["appendMessage"]>[0];
type Manager = Pick<SessionManager, "getBranch">;
type Controller = { activate(manager: Manager): void; dispose(): void };
const INSTALLED = Symbol.for("pi-proper-base.prompt-display");
const host = globalThis as typeof globalThis & { [INSTALLED]?: Controller };

/** Pi 0.86 has neither input correlation nor message identity in Markdown hooks.
 * Keep this adapter removable when those APIs exist. Never emulate expansion.
 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Prompt display]]
 */
export function installPromptDisplayHost(
	display: PromptDisplayController,
	commands: () => ReadonlyArray<{ name: string; source: string }>,
	marker: MarkdownTransformer,
): Controller {
	host[INSTALLED]?.dispose();
	let active = true;
	let manager: Manager | undefined;
	const dispatch = new AsyncLocalStorage<{
		raw: string | undefined;
		bound: boolean;
	}>();
	const restorers: Array<() => void> = [];
	const agents = new WeakSet<AgentSession["agent"]>();
	const managers = new WeakSet<SessionManager>();

	function bindSession(session: AgentSession): void {
		const agent = session.agent;
		if (!agents.has(agent)) {
			agents.add(agent);
			for (const name of ["prompt", "steer", "followUp"] as const) {
				const original = agent[name];
				const wrapped = function (this: typeof agent, ...args: unknown[]) {
					const scope = dispatch.getStore();
					if (active && scope?.raw !== undefined && !scope.bound) {
						const values = (
							Array.isArray(args[0]) ? args[0] : [args[0]]
						) as Message[];
						const message = values.find((value) => value?.role === "user");
						if (message) {
							display.bind(message, scope.raw);
							scope.bound = true;
						}
					}
					return Reflect.apply(original, this, args);
				};
				restorers.push(installWrapper(agent, name, wrapped));
			}
		}
		const store = session.sessionManager;
		if (!managers.has(store)) {
			managers.add(store);
			const append = store.appendMessage;
			const wrapped: typeof append = function (this: SessionManager, message) {
				const id = append.call(this, message);
				if (active) display.persist(message, id);
				return id;
			};
			restorers.push(installWrapper(store, "appendMessage", wrapped));
		}
	}

	for (const name of ["prompt", "steer", "followUp"] as const) {
		const original = AgentSession.prototype[name];
		const wrapped = function (this: AgentSession, ...args: unknown[]) {
			if (!active || this.sessionManager !== manager)
				return Reflect.apply(original, this, args);
			bindSession(this);
			const options = args[name === "prompt" ? 1 : 2] as
				| { source?: string; expandPromptTemplates?: boolean }
				| undefined;
			const text = originalInput(args[0] as string, options);
			const command = /^\/([^\s]+)/.exec(text)?.[1];
			const raw =
				(options?.source ?? "interactive") === "interactive" &&
				options?.expandPromptTemplates !== false &&
				command &&
				commands().some(
					(item) => item.name === command && item.source === "prompt",
				)
					? text
					: undefined;
			return dispatch.run({ raw, bound: false }, () =>
				Reflect.apply(original, this, args),
			);
		};
		restorers.push(installWrapper(AgentSession.prototype, name, wrapped));
	}

	// Swap only the text Pi gives its native user component, preserving images,
	// layout and other transformers. Persisted and model-facing text is untouched.
	type InteractiveHost = {
		session: AgentSession;
		getUserMessageText(message: Message): string;
		getMarkdownTransformers(): MarkdownTransformer[];
		addMessageToChat(
			message: Message,
			options?: { populateHistory?: boolean },
		): void;
		editor: { addToHistory?(text: string): void };
	};
	const prototype = InteractiveMode.prototype as unknown as InteractiveHost;
	const original = prototype.getUserMessageText;
	const wrapped: typeof original = function (this: InteractiveHost, message) {
		if (!active || !this.getMarkdownTransformers().includes(marker))
			return original.call(this, message);
		if (manager !== this.session.sessionManager) {
			// Reload rebuilds chat before session_start. Resolve entry identities now.
			manager = this.session.sessionManager;
			display.restore(manager.getBranch());
		}
		return display.rawFor(message) ?? original.call(this, message);
	};
	restorers.push(installWrapper(prototype, "getUserMessageText", wrapped));

	// Pi collapses only the first skill block, rendering the rest as user text.
	// Feed each block through its native renderer without changing the message.
	const addMessage = prototype.addMessageToChat;
	const addSkills: typeof addMessage = function (
		this: InteractiveHost,
		message,
		options,
	) {
		if (
			!active ||
			message.role !== "user" ||
			!this.getMarkdownTransformers().includes(marker)
		)
			return addMessage.call(this, message, options);
		const text = this.getUserMessageText(message);
		const { skills, request } = splitSkillText(text);
		if (skills.length < 2) return addMessage.call(this, message, options);
		for (const skill of skills)
			addMessage.call(this, { ...message, content: skill.block });
		if (request) addMessage.call(this, { ...message, content: request });
		if (options?.populateHistory) this.editor.addToHistory?.(text);
	};
	restorers.push(installWrapper(prototype, "addMessageToChat", addSkills));

	const controller: Controller = {
		activate(next) {
			manager = next;
			display.restore(next.getBranch());
		},
		dispose() {
			active = false;
			for (const restore of restorers.reverse()) restore();
			dispatch.disable();
			display.clear();
			if (host[INSTALLED] === controller) delete host[INSTALLED];
		},
	};
	host[INSTALLED] = controller;
	return controller;
}
