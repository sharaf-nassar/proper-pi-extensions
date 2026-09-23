import { AgentSession } from "@earendil-works/pi-coding-agent";
import { stickyDefaultsEnabled } from "./startup-defaults.ts";

type ThinkingLevel = Parameters<AgentSession["setThinkingLevel"]>[0];

const INSTALLED = Symbol.for("pi-proper-base.sticky-defaults");
const PLACEHOLDER_PROVIDER = "llm-router";

type Model = { provider: string; id: string };
type MutationOptions = { persist?: boolean };
type CycleResult = { model: Model } | undefined;
type SessionPrototype = {
	_buildRuntime(options: unknown): void;
	setModel(model: Model, options?: MutationOptions): Promise<void>;
	cycleModel(
		direction?: "forward" | "backward",
		options?: MutationOptions,
	): Promise<CycleResult>;
	setThinkingLevel(level: ThinkingLevel, options?: MutationOptions): void;
	[INSTALLED]?: StickyDefaultsController;
};
type SessionIdentity = object;
type LiveSession = {
	sessionManager: SessionIdentity;
	settingsManager: {
		getDefaultProvider(): string | undefined;
		getDefaultModel(): string | undefined;
		setDefaultModelAndProvider(provider: string, modelId: string): void;
		getDefaultThinkingLevel(): ThinkingLevel | undefined;
		setDefaultThinkingLevel(level: ThinkingLevel): void;
		getModelThinkingLevel(
			provider: string,
			modelId: string,
		): ThinkingLevel | undefined;
	};
	model: Model | undefined;
	thinkingLevel: ThinkingLevel;
};

export type StickyDefaultsController = {
	activate(sessionManager: SessionIdentity): void;
	/** The live AgentSession behind an extension context's session manager. */
	session(sessionManager: SessionIdentity): unknown;
	restore(): void;
};

/**
 * Bridge Pi 0.85.1's missing ExtensionAPI persistence option to the live
 * AgentSession. Remove this adapter once ExtensionAPI forwards `{ persist }`.
 */
export function installStickyDefaultsAdapter(
	enabled: () => boolean = () => stickyDefaultsEnabled(),
): StickyDefaultsController {
	const prototype = AgentSession.prototype as unknown as SessionPrototype;
	prototype[INSTALLED]?.restore();

	const originalBuildRuntime = prototype._buildRuntime;
	const originalSetModel = prototype.setModel;
	const originalCycleModel = prototype.cycleModel;
	const originalSetThinkingLevel = prototype.setThinkingLevel;
	if (
		typeof originalBuildRuntime !== "function" ||
		typeof originalSetModel !== "function" ||
		typeof originalCycleModel !== "function" ||
		typeof originalSetThinkingLevel !== "function"
	) {
		return { activate() {}, session: () => undefined, restore() {} };
	}
	let installed = true;
	const sessions = new WeakMap<SessionIdentity, LiveSession>();
	const active = new WeakSet<LiveSession>();
	const modelMutationDepth = new WeakMap<LiveSession, number>();

	const shouldPersist = (session: LiveSession): boolean =>
		installed && active.has(session) && enabled();
	const beginModelMutation = (session: LiveSession) => {
		modelMutationDepth.set(session, (modelMutationDepth.get(session) ?? 0) + 1);
	};
	const endModelMutation = (session: LiveSession) => {
		modelMutationDepth.set(
			session,
			Math.max(0, (modelMutationDepth.get(session) ?? 1) - 1),
		);
	};
	const persistModel = (session: LiveSession, model: Model | undefined) => {
		if (
			!shouldPersist(session) ||
			!model ||
			model.provider === PLACEHOLDER_PROVIDER
		)
			return;
		const settings = session.settingsManager;
		if (
			settings.getDefaultProvider() === model.provider &&
			settings.getDefaultModel() === model.id
		)
			return;
		settings.setDefaultModelAndProvider(model.provider, model.id);
	};

	function buildRuntime(this: LiveSession, options: unknown): void {
		originalBuildRuntime.call(this as never, options);
		if (installed) sessions.set(this.sessionManager, this);
	}
	async function setModel(
		this: LiveSession,
		model: Model,
		options: MutationOptions = {},
	): Promise<void> {
		if (!shouldPersist(this))
			return originalSetModel.call(this as never, model, options);
		beginModelMutation(this);
		try {
			await originalSetModel.call(this as never, model, {
				...options,
				persist: false,
			});
		} finally {
			endModelMutation(this);
		}
		persistModel(this, this.model);
	}
	async function cycleModel(
		this: LiveSession,
		direction: "forward" | "backward" = "forward",
		options: MutationOptions = {},
	): Promise<CycleResult> {
		if (!shouldPersist(this))
			return originalCycleModel.call(this as never, direction, options);
		beginModelMutation(this);
		let result: CycleResult;
		try {
			result = await originalCycleModel.call(this as never, direction, {
				...options,
				persist: false,
			});
		} finally {
			endModelMutation(this);
		}
		if (result) persistModel(this, result.model);
		return result;
	}
	function setThinkingLevel(
		this: LiveSession,
		level: ThinkingLevel,
		options: MutationOptions = {},
	): void {
		if (!shouldPersist(this)) {
			originalSetThinkingLevel.call(this as never, level, options);
			return;
		}
		originalSetThinkingLevel.call(this as never, level, {
			...options,
			persist: false,
		});
		if (
			(modelMutationDepth.get(this) ?? 0) > 0 ||
			this.model?.provider === PLACEHOLDER_PROVIDER
		)
			return;
		const effective = this.thinkingLevel;
		const settings = this.settingsManager;
		if (
			this.model &&
			settings.getModelThinkingLevel(this.model.provider, this.model.id) ===
				effective
		)
			return;
		if (settings.getDefaultThinkingLevel() !== effective)
			settings.setDefaultThinkingLevel(effective);
	}

	const controller: StickyDefaultsController = {
		activate(sessionManager) {
			const session = sessions.get(sessionManager);
			if (session) active.add(session);
		},
		session: (sessionManager) => sessions.get(sessionManager),
		restore() {
			installed = false;
			if (prototype[INSTALLED] !== controller) return;
			if (prototype._buildRuntime === buildRuntime)
				prototype._buildRuntime = originalBuildRuntime;
			if (prototype.setModel === setModel)
				prototype.setModel = originalSetModel;
			if (prototype.cycleModel === cycleModel)
				prototype.cycleModel = originalCycleModel;
			if (prototype.setThinkingLevel === setThinkingLevel)
				prototype.setThinkingLevel = originalSetThinkingLevel;
			delete prototype[INSTALLED];
		},
	};
	prototype._buildRuntime = buildRuntime;
	prototype.setModel = setModel;
	prototype.cycleModel = cycleModel;
	prototype.setThinkingLevel = setThinkingLevel;
	prototype[INSTALLED] = controller;
	return controller;
}
