/**
 * proper-base — baseline editor, fullscreen, history, and footer behavior.
 *
 * pi's Up/Down history covers the current session only, so a new session in a
 * project you have worked in for weeks starts empty. This extension seeds the
 * editor from the other sessions recorded for the same working directory, and
 * records every prompt as you submit it.
 *
 * The editor submit path is the only trusted source: Pi session messages store
 * expanded skills and prompt templates rather than the exact outgoing input.
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	type MarkdownTransformer,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { registerAutoUpdates } from "./src/auto-update/index.ts";
import {
	installAutocompleteDetails,
	installInlineSlashAutocomplete,
	installModelAutocompleteSubmit,
	modelThinkingCommand,
	sortModelAutocompleteDescending,
	THINKING_LEVELS,
} from "./src/autocomplete-details.ts";
import { installBaseKeybindings } from "./src/base-keybindings.ts";
import { installClipboardLeakGuard } from "./src/clipboard-guard.ts";
import { installClipboardSelection } from "./src/clipboard-selection.ts";
import { commitGuardReason } from "./src/commit-guard.ts";
import {
	asTokensSession,
	CONTEXT_TOKENS_ENTRY,
	ContextTokens,
	type ContextTokensMode,
	installTokensScopeCompletion,
	parseTokensArgs,
	TOKENS_USAGE,
	tokensArgumentCompletions,
	tokensNotice,
} from "./src/context-tokens.ts";
import { installEditorMouseGuard } from "./src/editor-mouse.ts";
import {
	installEditorNavigation,
	installPromptClear,
	installReverseHistorySearch,
	type ReverseHistorySearchController,
} from "./src/editor-navigation.ts";
import {
	FastOverlay,
	fastToggleNotice,
	isFastToggle,
} from "./src/fast-mode.ts";
import { installFooterColors } from "./src/footer-colors.ts";
import {
	isRecallable,
	mergePrompts,
	resolveBase,
	WRAPPED,
} from "./src/history.ts";
import { type HistoryGuard, installHistoryGuard } from "./src/history-guard.ts";
import { omitPriorTurnImages } from "./src/image-context.ts";
import {
	enableScribeCapabilities,
	type ImagePreviewController,
	installImagePreview,
} from "./src/image-preview.ts";
import { installJumpToBottom } from "./src/jump-to-bottom.ts";
import { installOsc8LinkIds } from "./src/osc8-link-ids.ts";
import { installOverlayScroll } from "./src/overlay-scroll.ts";
import {
	applyProactiveDelegation,
	readProactiveDelegationEnabled,
} from "./src/proactive-delegation.ts";
import {
	createPromptDisplay,
	PROMPT_DISPLAY_ENTRY,
} from "./src/prompt-display.ts";
import { installPromptDisplayHost } from "./src/prompt-display-host.ts";
import { installPromptJump } from "./src/prompt-jump.ts";
import { appendPromptSection } from "./src/prompt-sections.ts";
import { installRecorder } from "./src/recorder.ts";
import { installSelectionDismiss } from "./src/selection-dismiss.ts";
import { installFastSessionList } from "./src/session-list.ts";
import { installSettings, type SettingsController } from "./src/settings.ts";
import { pinSkillContext } from "./src/skill-context.ts";
import { installSmartSelection } from "./src/smart-selection.ts";
import { stickyDefaultsEnabled } from "./src/startup-defaults.ts";
import { installStickyDefaultsAdapter } from "./src/sticky-defaults.ts";
import {
	appendPrompt,
	compactIfNeeded,
	readPrompts,
	storePath,
} from "./src/store.ts";
import {
	installTranscriptCleanup,
	type TranscriptCleanupController,
} from "./src/transcript-cleanup.ts";
import { normalizeCpaTransientError } from "./src/transient-retry.ts";
import { installWheelScrollLines } from "./src/wheel-scroll.ts";
import { installWidgetTranscript } from "./src/widget-transcript.ts";

/** Prompts seeded into the editor. Older prompts past this point are dropped. */
const MAX_ENTRIES = 200;
const CANCEL_PROMPT_COMMAND = "__proper-cancel-prompt";
const CANCEL_ANCHOR = "proper-cancel-anchor";
const RESTORE_MODEL_COMMAND = "__proper-restore-model";
const SESSION_TITLE_INSTRUCTION = `At the end of your first assistant response, add exactly one line in this format: <session_title>concise 3-7 word task title</session_title>. Use plain text without quotes or terminal control characters. This is hidden session metadata; do not mention it.`;
const SESSION_TITLE_PATTERN = /\s*<session_title>([^<]*)<\/session_title>\s*$/i;
const SESSION_TITLE_DISPLAY_PATTERN = /\s*<session_title>[\s\S]*$/i;
const SESSION_TITLE_MAX_LENGTH = 64;

type EditorFactory = NonNullable<
	ReturnType<ExtensionContext["ui"]["getEditorComponent"]>
>;

type TaggedFactory = EditorFactory & { [WRAPPED]?: EditorFactory | null };

type EditorTui = Parameters<EditorFactory>[0] & {
	scrollToBottom?(): void;
};
type PromptEditor = ReturnType<EditorFactory> & {
	isShowingAutocomplete?(): boolean;
};
type PendingPrompt = {
	text: string;
	messageTimestamp?: number;
	processed: boolean;
	cancelled: boolean;
	entryId?: string;
	originId?: string | undefined;
};
type RestoreRequest = { entryId: string; originId?: string | undefined };

/**
 * Extensions may append transcript entries between submission and the prompt's
 * own session entry; proper-pacify writes one before it rewrites the text. Those
 * entries are the prompt's parents, so navigating to the prompt keeps them and
 * leaves orphan rows behind. Aim at the leaf the submission started from, unless
 * it is a prompt entry of its own (navigating there would drop that turn too) or
 * no longer an ancestor because the tree moved meanwhile.
 */
function cancelTargetId(
	ctx: ExtensionContext,
	request: RestoreRequest,
): string {
	if (!request.originId) return request.entryId;
	const origin = ctx.sessionManager.getEntry(request.originId);
	if (!origin || origin.type === "custom_message") return request.entryId;
	if (origin.type === "message" && origin.message.role === "user") {
		return request.entryId;
	}
	const ancestor = ctx.sessionManager
		.getBranch(request.entryId)
		.some((entry) => entry.id === request.originId);
	return ancestor ? request.originId : request.entryId;
}

/**
 * `details` shape of the `ask_user_question` tool result, from
 * `@juicesharp/rpiv-ask-user-question`.
 */
type QuestionnaireDetails = { cancelled?: boolean; error?: string };

function extractSessionTitle(text: string): string | undefined {
	const match = SESSION_TITLE_PATTERN.exec(text);
	if (!match) return undefined;

	return (
		(match[1] ?? "")
			.replace(/\p{Cc}/gu, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, SESSION_TITLE_MAX_LENGTH)
			.trim() || undefined
	);
}

type ClearSettings = {
	provider: string;
	id: string;
	thinkingLevel: ReturnType<ExtensionAPI["getThinkingLevel"]>;
	sessionFast: boolean;
	contextTokens?: ContextTokensMode | undefined;
};

function decodeClearSettings(value: string): ClearSettings | undefined {
	try {
		const parsed = JSON.parse(
			decodeURIComponent(value.trim()),
		) as Partial<ClearSettings> | null;
		if (
			!parsed ||
			typeof parsed.provider !== "string" ||
			!parsed.provider ||
			typeof parsed.id !== "string" ||
			!parsed.id ||
			!parsed.thinkingLevel ||
			!THINKING_LEVELS.includes(parsed.thinkingLevel) ||
			typeof parsed.sessionFast !== "boolean" ||
			(parsed.contextTokens !== undefined &&
				parsed.contextTokens !== "max" &&
				parsed.contextTokens !== "default")
		)
			return undefined;
		return {
			provider: parsed.provider,
			id: parsed.id,
			thinkingLevel: parsed.thinkingLevel,
			sessionFast: parsed.sessionFast,
			contextTokens: parsed.contextTokens,
		};
	} catch (error) {
		if (error instanceof URIError || error instanceof SyntaxError)
			return undefined;
		throw error;
	}
}

export default function (pi: ExtensionAPI) {
	// @lat: [[lat.md/proper-base/proper-base#proper-base#Clipboard leak guard]]
	installClipboardLeakGuard();
	enableScribeCapabilities();
	// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Session listing]]
	const removeFastSessionList = installFastSessionList(
		SessionManager,
		getAgentDir(),
	);
	const stickyDefaults = installStickyDefaultsAdapter(() =>
		stickyDefaultsEnabled(getAgentDir()),
	);

	// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Fast tier scopes]]
	const fastOverlay = new FastOverlay(getAgentDir());
	pi.on("before_provider_request", (event, ctx) =>
		fastOverlay.rewritePayload(event.payload, ctx.model ?? undefined),
	);
	pi.registerCommand?.("fast-global", {
		description: "Toggle CLIProxyAPI Fast mode for all sessions.",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify("Usage: /fast-global", "error");
				return;
			}
			const environmentOverride = fastOverlay.globalEnvironmentOverride();
			if (environmentOverride !== undefined) {
				ctx.ui.notify(
					`Cannot toggle global Fast mode while CLIPROXYAPI_FAST=${environmentOverride ? "true" : "false"} overrides the saved setting.`,
					"warning",
				);
				return;
			}
			let enabled: boolean;
			try {
				enabled = fastOverlay.toggleGlobal();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to save Fast mode: ${message}`, "error");
				return;
			}
			const notice = fastToggleNotice({
				scope: "global",
				enabled,
				otherEnabled: fastOverlay.isSessionEnabled(),
				modelSupported: fastOverlay.supportsModel(ctx.model ?? undefined),
			});
			ctx.ui.notify(notice.message, notice.level);
		},
	});

	// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Context window scopes]]
	const tokenWindows = new ContextTokens(getAgentDir(), () =>
		fastOverlay.providerId(),
	);
	const applyContextTokens = (ctx: ExtensionContext) => {
		const session = asTokensSession(stickyDefaults.session(ctx.sessionManager));
		if (!session) return undefined;
		const applied = tokenWindows.apply(session, ctx.modelRegistry);
		activeTui?.requestRender();
		return applied && { session, ...applied };
	};
	pi.registerCommand?.("tokens", {
		description:
			"Show or set the OpenAI context window: /tokens [max|default] [global]",
		getArgumentCompletions: tokensArgumentCompletions,
		handler: async (args, ctx) => {
			const request = parseTokensArgs(args);
			if (!request) {
				ctx.ui.notify(TOKENS_USAGE, "error");
				return;
			}
			if (!asTokensSession(stickyDefaults.session(ctx.sessionManager))) {
				ctx.ui.notify(
					"/tokens is unavailable: this Pi version does not expose the live session model.",
					"error",
				);
				return;
			}
			const { mode, global } = request;
			if (mode && global) {
				try {
					tokenWindows.setGlobalMode(mode);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Failed to save context window: ${message}`, "error");
					return;
				}
				// This session drops its own choice and follows the new global one.
				if (tokenWindows.sessionMode(ctx.sessionManager.getBranch())) {
					pi.appendEntry(CONTEXT_TOKENS_ENTRY, { mode: null });
				}
			} else if (mode) {
				pi.appendEntry(CONTEXT_TOKENS_ENTRY, { mode });
			}
			const modelId = ctx.model?.id ?? "No model";
			const applied = applyContextTokens(ctx);
			if (!applied) {
				const saved = mode
					? `Context window ${mode} saved ${global ? "for all sessions" : "for this session"}, but `
					: "";
				ctx.ui.notify(
					`${saved}${modelId} has no larger window: /tokens applies to OpenAI models on openai, openai-codex, and CLIProxyAPI whose maximum exceeds the default.`,
					mode ? "warning" : "info",
				);
				return;
			}
			const branch = ctx.sessionManager.getBranch();
			const sessionMode = tokenWindows.sessionMode(branch);
			const globalMode = tokenWindows.globalMode();
			const notice = tokensNotice({
				modelId,
				mode:
					mode ??
					(sessionMode
						? `${sessionMode}, set for this session`
						: globalMode
							? `${globalMode}, set globally`
							: "default"),
				scope: mode ? (global ? "global" : "session") : "status",
				window: applied.window,
				limits: applied.limits,
				compaction: applied.session.settingsManager.getCompactionSettings(
					applied.session.agent.state.model,
				),
				contextTokens: ctx.getContextUsage()?.tokens,
			});
			ctx.ui.notify(notice.message, notice.level);
		},
	});
	// Pi reads the session model's window live in every compaction and
	// overflow check. The session_start guard windows every model write; a
	// global choice made in another process lands before each check instead:
	// prompt-time checks run after `input`, continuation and post-run checks
	// after `turn_end`.
	let removeTokensGuard: (() => void) | undefined;
	pi.on("input", (_event, ctx) => {
		applyContextTokens(ctx);
	});
	pi.on("turn_end", (_event, ctx) => {
		applyContextTokens(ctx);
	});

	let removeFooterColors: (() => void) | undefined;
	let removeKeybindings: (() => void) | undefined;
	let removeWheelScroll: (() => void) | undefined;
	// ctx.ui.addAutocompleteProvider() returns void and stacks permanently, so
	// re-registering on every session_start would leave one live provider per
	// session load. Register the model sort exactly once.
	let autocompleteInstalled = false;
	let removeJumpToBottom: (() => void) | undefined;
	let removePromptJump: (() => void) | undefined;
	let settings: SettingsController | undefined;
	let removeEditorMouseGuard: (() => void) | undefined;
	let removePromptClear: (() => void) | undefined;
	let removeSmartSelection: (() => void) | undefined;
	let removeClipboardSelection: (() => void) | undefined;
	let removeSelectionDismiss: (() => void) | undefined;
	let removeOverlayScroll: (() => void) | undefined;
	let removeOsc8LinkIds: (() => void) | undefined;
	let imagePreview: ImagePreviewController | undefined;
	let removeTerminalInput: (() => void) | undefined;
	let transcriptCleanup: TranscriptCleanupController | undefined;
	let removeWidgetTranscript: (() => void) | undefined;
	let activeEditor: PromptEditor | undefined;
	let activeTui: EditorTui | undefined;
	let submittedPrompt: string | undefined;
	let submittedOriginId: string | undefined;
	let pendingPrompt: PendingPrompt | undefined;
	let restoreRequest: RestoreRequest | undefined;
	let sessionTitlePending = false;
	const promptDisplay = createPromptDisplay();

	const markdownTransformer: MarkdownTransformer = (markdown, context) => {
		if (context.messageType !== "assistant") return markdown;
		return markdown.replace(SESSION_TITLE_DISPLAY_PATTERN, "");
	};
	pi.registerMarkdownTransformer?.(markdownTransformer);
	const promptDisplayHost = installPromptDisplayHost(
		promptDisplay,
		() => pi.getCommands(),
		markdownTransformer,
	);

	const findPendingEntry = (ctx: ExtensionContext) => {
		if (!pendingPrompt?.messageTimestamp) return undefined;
		return [...ctx.sessionManager.getBranch()]
			.reverse()
			.find(
				(entry) =>
					entry.type === "message" &&
					entry.message.role === "user" &&
					entry.message.timestamp === pendingPrompt?.messageTimestamp,
			);
	};

	/**
	 * Run a `/model <reference> <level>` submission, if that is the shape.
	 *
	 * Pi reads a `/model` argument as one model search term, so a thinking level
	 * appended to it only widens that search and opens the picker. The command is
	 * taken over at the editor instead, and the level is applied after the model:
	 * every `setModel` recomputes the level from settings, so setting it first
	 * would be discarded. A reference matching no model is left to Pi, whose
	 * picker still opens on the raw text.
	 */
	const applyModelThinking = (ctx: ExtensionContext, text: string): boolean => {
		const request = modelThinkingCommand(text);
		if (!request) return false;
		const available =
			ctx.scopedModels.length > 0
				? ctx.scopedModels.map((scoped) => scoped.model)
				: ctx.modelRegistry.getAvailable();
		const model = available.find(
			(candidate) =>
				`${candidate.provider}/${candidate.id}` === request.reference ||
				candidate.id === request.reference,
		);
		if (!model) return false;
		void (async () => {
			if (!(await pi.setModel(model))) {
				ctx.ui.notify(
					`Could not switch to ${model.provider}/${model.id}`,
					"error",
				);
				return;
			}
			pi.setThinkingLevel(request.level);
			ctx.ui.notify(`Model: ${model.id} (thinking: ${request.level})`, "info");
		})();
		return true;
	};

	pi.registerCommand?.(RESTORE_MODEL_COMMAND, {
		description: "Internal: restore model, thinking, and Fast after /clear",
		handler: async (args, ctx) => {
			const reference = decodeClearSettings(args);
			if (!reference) {
				ctx.ui.notify("Could not restore model after /clear", "error");
				return;
			}
			const model = ctx.modelRegistry.find(reference.provider, reference.id);
			if (!model || !(await pi.setModel(model))) {
				ctx.ui.notify(
					`Could not restore model ${reference.provider}/${reference.id}`,
					"error",
				);
				return;
			}
			// Model selection reapplies defaults, so restore thinking afterwards.
			pi.setThinkingLevel(reference.thinkingLevel);
			if (fastOverlay.isSessionEnabled() !== reference.sessionFast)
				fastOverlay.toggleSession();
			if (reference.contextTokens) {
				pi.appendEntry(CONTEXT_TOKENS_ENTRY, { mode: reference.contextTokens });
			}
			// Reselecting the same model writes nothing, so apply the new entry.
			applyContextTokens(ctx);
			activeTui?.requestRender();
		},
	});

	// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Model-preserving clear]]
	pi.registerCommand?.("clear", {
		description:
			"Start a new session with the current model, thinking, Fast, and context window",
		handler: async (_args, ctx) => {
			const restoreCommand = ctx.model
				? `/${RESTORE_MODEL_COMMAND} ${encodeURIComponent(
						JSON.stringify({
							provider: ctx.model.provider,
							id: ctx.model.id,
							thinkingLevel: pi.getThinkingLevel(),
							sessionFast: fastOverlay.isSessionEnabled(),
							contextTokens: tokenWindows.sessionMode(
								ctx.sessionManager.getBranch(),
							),
						} satisfies ClearSettings),
					)}`
				: undefined;
			await ctx.newSession(
				restoreCommand
					? {
							withSession: async (replacementCtx) => {
								await replacementCtx.sendUserMessage(restoreCommand, {
									expandPromptTemplates: true,
								});
							},
						}
					: undefined,
			);
		},
	});

	pi.registerCommand?.(CANCEL_PROMPT_COMMAND, {
		description: "Internal: remove an unprocessed cancelled prompt",
		handler: async (_args, ctx) => {
			const request = restoreRequest;
			restoreRequest = undefined;
			if (!request) return;

			const target = ctx.sessionManager.getEntry(request.entryId);
			if (target?.type !== "message" || target.message.role !== "user") return;
			const targetId = cancelTargetId(ctx, request);
			try {
				if (ctx.sessionManager.getLeafId() === targetId) {
					pi.appendEntry(CANCEL_ANCHOR, { targetId });
				}
				await ctx.navigateTree(targetId, { summarize: false });
			} catch (error) {
				ctx.ui.notify(
					`Could not remove cancelled prompt: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});

	pi.on("input", (event) => {
		if (event.source === "interactive") {
			// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Pinned transcript scrolling]]
			if (event.text.trim()) activeTui?.scrollToBottom?.();
		}
		if (
			event.source === "interactive" &&
			event.streamingBehavior !== undefined
		) {
			submittedPrompt = undefined;
			return;
		}
		if (event.source !== "interactive" || !event.text.trim()) return;
		pendingPrompt = {
			text: submittedPrompt ?? event.text,
			originId: submittedPrompt ? submittedOriginId : undefined,
			processed: false,
			cancelled: false,
		};
		submittedPrompt = undefined;
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "user") {
			if (pendingPrompt) {
				pendingPrompt.messageTimestamp = event.message.timestamp;
			}
			return;
		}
		if (!pendingPrompt) return;
		if (
			event.message.role === "assistant" &&
			event.message.stopReason !== "aborted"
		) {
			// Streaming opens the assistant message with a "pending" partial as
			// soon as response headers arrive — instantly behind a local proxy,
			// with zero tokens produced. That is not assistant processing yet;
			// content arrival marks it through message_update instead.
			if (event.message.stopReason !== "pending") {
				pendingPrompt.processed = true;
			}
			imagePreview?.clear();
		}
	});

	pi.on("message_update", () => {
		if (pendingPrompt) pendingPrompt.processed = true;
	});

	// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Model image context]]
	// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Skill context]]
	pi.on("context", (event, ctx) => {
		const messages = pinSkillContext(
			omitPriorTurnImages(event.messages),
			ctx.sessionManager.getBranch(),
		);
		if (messages !== event.messages) return { messages };
	});

	// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Proactive delegation]]
	pi.on("before_agent_start", (event, ctx) => {
		if (!readProactiveDelegationEnabled(getAgentDir())) return;
		const tools =
			event.systemPromptOptions?.selectedTools ?? pi.getActiveTools?.() ?? [];
		applyProactiveDelegation(
			event.systemPromptOptions,
			tools.includes("subagent"),
			ctx.scopedModels.map((scoped) => scoped.model),
		);
	});

	// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Automatic session title]]
	pi.on("before_agent_start", (event) => {
		if (!sessionTitlePending || pi.getSessionName?.()) {
			sessionTitlePending = false;
			return;
		}
		appendPromptSection(
			event.systemPromptOptions,
			"proper_base_title",
			SESSION_TITLE_INSTRUCTION,
		);
	});

	pi.on("message_end", (event) => {
		if (event.message.role === "assistant") {
			transcriptCleanup?.completeAssistant(event.message);
		}
		const normalized = normalizeCpaTransientError(event.message);
		if (normalized !== event.message) return { message: normalized };
	});

	pi.on("message_end", (event) => {
		if (
			!sessionTitlePending ||
			event.message.role !== "assistant" ||
			event.message.stopReason === "aborted" ||
			event.message.stopReason === "error" ||
			pi.getSessionName?.()
		) {
			return;
		}

		const title = event.message.content.find(
			(part) => part.type === "text" && extractSessionTitle(part.text),
		);
		if (title?.type !== "text") {
			if (
				event.message.stopReason === "stop" ||
				event.message.stopReason === "length"
			) {
				sessionTitlePending = false;
			}
			return;
		}
		const extracted = extractSessionTitle(title.text);
		if (!extracted) return;

		sessionTitlePending = false;
		pi.setSessionName?.(extracted);
	});

	pi.on("agent_start", () => {
		transcriptCleanup?.start();
	});

	// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Commit message guard]]
	pi.on("tool_call", (event) => {
		if (event.toolName !== "bash" && event.toolName !== "quill_execute") return;
		const command = (event.input as { command?: unknown } | undefined)?.command;
		if (typeof command !== "string") return;
		const reason = commitGuardReason(command);
		if (reason) return { block: true, reason };
	});

	pi.on("tool_execution_start", () => {
		if (pendingPrompt) pendingPrompt.processed = true;
	});

	pi.on("tool_execution_end", (event) => {
		transcriptCleanup?.completeTool(event.toolCallId);
	});

	pi.on("agent_settled", (_event, ctx) => {
		const prompts = promptDisplay.drain();
		if (prompts.length) pi.appendEntry(PROMPT_DISPLAY_ENTRY, { prompts });
		const ui = ctx.ui as ExtensionContext["ui"] & {
			getToolsExpanded?(): boolean;
			setToolsExpanded?(expanded: boolean): void;
		};
		if (ui.getToolsExpanded?.()) ui.setToolsExpanded?.(false);
		transcriptCleanup?.settle();
		submittedPrompt = undefined;
		const candidate = pendingPrompt;
		if (!candidate) return;
		if (candidate.cancelled && !candidate.processed) {
			const entry = candidate.entryId
				? ctx.sessionManager.getEntry(candidate.entryId)
				: findPendingEntry(ctx);
			if (entry?.type === "message" && entry.message.role === "user") {
				restoreRequest = { entryId: entry.id, originId: candidate.originId };
				pendingPrompt = undefined;
				pi.sendUserMessage(`/${CANCEL_PROMPT_COMMAND}`, {
					expandPromptTemplates: true,
				});
				return;
			}
		}
		pendingPrompt = undefined;
		imagePreview?.clear();
	});

	// Esc on the questionnaire resolves a normal tool result, so the turn
	// continues and the model answers a decline it did not need. Aborting
	// returns to the prompt instead, matching Esc during streaming.
	pi.on("tool_result", (event, ctx) => {
		if (event.toolName !== "ask_user_question") return;
		const details = event.details as QuestionnaireDetails | undefined;
		// The tool also reports `cancelled` for host and validation failures,
		// which carry `error`. Those must reach the model so it can fall back to
		// asking in plain text.
		if (details?.cancelled && !details.error) ctx.abort();
	});

	pi.on("session_shutdown", () => {
		removeFastSessionList();
		removeTokensGuard?.();
		removeTokensGuard = undefined;
		stickyDefaults.restore();
		removeKeybindings?.();
		removeKeybindings = undefined;
		removeWheelScroll?.();
		removeWheelScroll = undefined;
		removeFooterColors?.();
		removeFooterColors = undefined;
		fastOverlay.stopDisplayRefresh();
		removeJumpToBottom?.();
		removeJumpToBottom = undefined;
		removePromptJump?.();
		removePromptJump = undefined;
		settings?.dispose();
		settings = undefined;
		removeEditorMouseGuard?.();
		removeEditorMouseGuard = undefined;
		removePromptClear?.();
		removePromptClear = undefined;
		removeSmartSelection?.();
		removeSmartSelection = undefined;
		removeClipboardSelection?.();
		removeClipboardSelection = undefined;
		removeSelectionDismiss?.();
		removeSelectionDismiss = undefined;
		removeOverlayScroll?.();
		removeOverlayScroll = undefined;
		removeOsc8LinkIds?.();
		removeOsc8LinkIds = undefined;
		imagePreview?.dispose();
		imagePreview = undefined;
		removeTerminalInput?.();
		removeTerminalInput = undefined;
		removeWidgetTranscript?.();
		removeWidgetTranscript = undefined;
		transcriptCleanup?.uninstall();
		transcriptCleanup = undefined;
		activeEditor = undefined;
		activeTui = undefined;
		submittedPrompt = undefined;
		pendingPrompt = undefined;
		restoreRequest = undefined;
		sessionTitlePending = false;
		promptDisplayHost.dispose();
	});

	pi.on("session_start", async (_event, ctx) => {
		stickyDefaults.activate(ctx.sessionManager);
		// /clear restores its captured session Fast after startup completes.
		fastOverlay.resetSession();
		promptDisplayHost.activate(ctx.sessionManager);
		sessionTitlePending =
			!pi.getSessionName?.() &&
			!ctx.sessionManager
				.getBranch()
				.some(
					(entry) =>
						entry.type === "message" && entry.message.role === "assistant",
				);
		submittedPrompt = undefined;
		pendingPrompt = undefined;
		restoreRequest = undefined;
		removeTerminalInput?.();
		removeTerminalInput = ctx.ui.onTerminalInput?.((data) => {
			const candidate = pendingPrompt;
			const promptText = candidate?.text ?? submittedPrompt;
			if (data !== "\x1b" || !promptText || candidate?.processed === true) {
				return undefined;
			}
			if (activeEditor?.isShowingAutocomplete?.()) return undefined;
			const focused = (
				activeTui as EditorTui & {
					getFocusedComponent?(): unknown;
				}
			)?.getFocusedComponent?.();
			if (focused && focused !== activeEditor) return undefined;

			const entry = findPendingEntry(ctx);
			if (!candidate || (!entry && ctx.isIdle())) {
				ctx.ui.setEditorText(promptText);
				submittedPrompt = undefined;
				pendingPrompt = undefined;
				return undefined;
			}

			candidate.cancelled = true;
			if (entry) candidate.entryId = entry.id;
			else delete candidate.entryId;
			ctx.ui.setEditorText(promptText);
			return undefined;
		});
		if (!autocompleteInstalled) {
			autocompleteInstalled = true;
			ctx.ui.addAutocompleteProvider?.((current) =>
				sortModelAutocompleteDescending(current, () => pi.getThinkingLevel?.()),
			);
		}

		const store = storePath(getAgentDir(), ctx.cwd);
		compactIfNeeded(store);

		// Stores written before command filtering still hold UI commands.
		const commands = pi.getCommands();
		const seeded = mergePrompts(readPrompts(store), MAX_ENTRIES).filter(
			(text) => isRecallable(text, commands),
		);
		let historyGuard: HistoryGuard | undefined;
		let historySearch: ReverseHistorySearchController | undefined;
		const record = (text: string, sourceText: string) => {
			if (isRecallable(text, pi.getCommands())) {
				appendPrompt(store, text);
				historyGuard?.add(text);
				historySearch?.add(text);
			}
			if (
				!sourceText.trimStart().startsWith("/") &&
				!sourceText.trimStart().startsWith("!")
			) {
				submittedPrompt = sourceText;
				// Captured here rather than on the `input` event: extensions that
				// wrap Pi's input dispatch have already appended their own entries
				// by the time that event reaches this extension.
				submittedOriginId = ctx.sessionManager.getLeafId() ?? undefined;
			}
		};

		// Wrap the installed editor rather than replacing it, so this composes
		// with extensions that provide their own editor.
		const base = resolveBase(ctx.ui.getEditorComponent());
		const factory: TaggedFactory = (tui, theme, keybindings) => {
			removeKeybindings?.();
			removeKeybindings = installBaseKeybindings(keybindings);
			const editor =
				base?.(tui, theme, keybindings) ??
				new CustomEditor(tui, theme, keybindings);
			activeEditor = editor as PromptEditor;
			activeTui = tui;
			// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Wheel scroll rate]]
			removeWheelScroll?.();
			removeWheelScroll = installWheelScrollLines(tui);
			// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Settled transcript]]
			transcriptCleanup?.uninstall();
			transcriptCleanup = installTranscriptCleanup(tui, ctx);
			// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Transcript widgets]]
			removeWidgetTranscript?.();
			removeWidgetTranscript = installWidgetTranscript(tui, editor);
			removeSmartSelection?.();
			removeSmartSelection = installSmartSelection(tui);
			removeClipboardSelection?.();
			removeClipboardSelection = installClipboardSelection(tui);
			removeSelectionDismiss?.();
			// The copy action reads the active selection after this listener runs,
			// so its keystroke must not dismiss the selection it is about to copy.
			removeSelectionDismiss = installSelectionDismiss(tui, (data) =>
				keybindings
					.getKeys("app.message.copy")
					.some((key) => matchesKey(data, key)),
			);
			// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Overlay transcript scrolling]]
			removeOverlayScroll?.();
			removeOverlayScroll = installOverlayScroll(tui);
			// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Hyperlink identity]]
			removeOsc8LinkIds?.();
			removeOsc8LinkIds = installOsc8LinkIds(tui);
			historyGuard = installHistoryGuard(editor);
			removeJumpToBottom?.();
			removeJumpToBottom = installJumpToBottom(editor, tui);
			removePromptJump?.();
			settings?.dispose();
			settings = installSettings(tui, editor, getAgentDir());
			// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Prompt mouse clicks]]
			removeEditorMouseGuard?.();
			removeEditorMouseGuard = installEditorMouseGuard(
				editor,
				() => settings?.editorMouse() !== false,
			);
			// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Session action rail]]
			removePromptJump = installPromptJump(tui, {
				color: (value) => ctx.ui.theme.fg("muted", value),
				subtle: (value) => ctx.ui.theme.fg("dim", value),
				outline: () =>
					settings?.enabled() !== false
						? (transcriptCleanup?.outline() ?? [])
						: [],
			});
			imagePreview?.dispose();
			imagePreview = installImagePreview(editor, tui, {
				fallbackColor: (value) => ctx.ui.theme.fg("dim", value),
				loadingColor: (value) => ctx.ui.theme.fg("accent", value),
			});
			installEditorNavigation(editor, keybindings);
			installInlineSlashAutocomplete(editor);
			installRecorder(
				editor,
				record,
				(text) => imagePreview?.prepare(text) ?? text,
				// pi dispatches extension commands before the `input` event, so the
				// provider's global `/fast` can only be repurposed as a session
				// toggle by consuming it at the editor before pi ever parses it.
				(text) => {
					if (isFastToggle(text)) {
						const notice = fastToggleNotice({
							scope: "session",
							enabled: fastOverlay.toggleSession(),
							otherEnabled: fastOverlay.isGlobalEnabled(),
							modelSupported: fastOverlay.supportsModel(ctx.model ?? undefined),
						});
						ctx.ui.notify(notice.message, notice.level);
						tui.requestRender();
						return true;
					}
					// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Model thinking argument]]
					return applyModelThinking(ctx, text);
				},
			);
			installModelAutocompleteSubmit(editor, keybindings);
			// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Context window scopes]]
			installTokensScopeCompletion(editor, keybindings);
			removePromptClear?.();
			removePromptClear = installPromptClear(editor, tui, keybindings, ctx);
			historySearch = installReverseHistorySearch(
				editor,
				tui,
				keybindings,
				seeded,
				MAX_ENTRIES,
			);
			installAutocompleteDetails(editor, tui, theme);
			removeFooterColors?.();
			fastOverlay.stopDisplayRefresh();
			removeFooterColors = installFooterColors(tui, ctx, () =>
				fastOverlay.isEffectiveForDisplay(ctx.model ?? undefined),
			);
			if (removeFooterColors) {
				fastOverlay.startDisplayRefresh(() => tui.requestRender());
			}
			for (const prompt of seeded) historyGuard?.add(prompt);
			return editor;
		};
		factory[WRAPPED] = base ?? null;

		ctx.ui.setEditorComponent(factory);
		// Window the restored model now and every model written later.
		removeTokensGuard?.();
		const tokensSession = asTokensSession(
			stickyDefaults.session(ctx.sessionManager),
		);
		removeTokensGuard =
			tokensSession && tokenWindows.guard(tokensSession, ctx.modelRegistry);
		applyContextTokens(ctx);
	});
	// Base setup and cleanup must register before the updater's lifecycle hooks.
	registerAutoUpdates(pi);
}
