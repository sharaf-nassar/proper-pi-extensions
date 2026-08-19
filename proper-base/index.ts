/**
 * pi-proper-base — baseline editor, fullscreen, history, and footer behavior.
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
} from "@earendil-works/pi-coding-agent";

import {
	installAutocompleteDetails,
	installInlineSlashAutocomplete,
	installModelAutocompleteSubmit,
	sortModelAutocompleteDescending,
} from "./src/autocomplete-details.ts";
import { installEditorNavigation } from "./src/editor-navigation.ts";
import { installFooterColors } from "./src/footer-colors.ts";
import {
	isRecallable,
	mergePrompts,
	resolveBase,
	WRAPPED,
} from "./src/history.ts";
import { type HistoryGuard, installHistoryGuard } from "./src/history-guard.ts";
import {
	type ImagePreviewController,
	installImagePreview,
} from "./src/image-preview.ts";
import { installJumpToBottom } from "./src/jump-to-bottom.ts";
import { installRecorder } from "./src/recorder.ts";
import {
	appendPrompt,
	compactIfNeeded,
	readPrompts,
	storePath,
} from "./src/store.ts";
import { normalizeCpaTransientError } from "./src/transient-retry.ts";

/** Prompts seeded into the editor. Older prompts past this point are dropped. */
const MAX_ENTRIES = 200;
const CANCEL_PROMPT_COMMAND = "__proper-cancel-prompt";
const CANCEL_ANCHOR = "proper-cancel-anchor";
const SESSION_TITLE_INSTRUCTION = `At the end of your first assistant response, add exactly one line in this format: <session_title>concise 3-7 word task title</session_title>. Use plain text without quotes or terminal control characters. This is hidden session metadata; do not mention it.`;
const SESSION_TITLE_PATTERN = /\s*<session_title>([^<]*)<\/session_title>\s*$/i;
const SESSION_TITLE_DISPLAY_PATTERN = /\s*<session_title>[\s\S]*$/i;
const SESSION_TITLE_MAX_LENGTH = 64;

type EditorFactory = NonNullable<
	ReturnType<ExtensionContext["ui"]["getEditorComponent"]>
>;

type TaggedFactory = EditorFactory & { [WRAPPED]?: EditorFactory | null };
type EditorKeybindings = Parameters<EditorFactory>[2];

const FULLSCREEN_KEYBINDINGS = Symbol.for(
	"pi-proper-base.fullscreen-keybindings",
);
const LEGACY_FULLSCREEN_KEYBINDINGS = Symbol.for(
	"pi-proper-customs.fullscreen-keybindings",
);
const FULLSCREEN_KEYS = {
	"tui.altScreen.pageUp": "ctrl+shift+pageUp",
	"tui.altScreen.pageDown": "ctrl+shift+pageDown",
	"tui.altScreen.top": "ctrl+shift+home",
	"tui.altScreen.bottom": "ctrl+shift+end",
} as const;

type KeybindingController = { apply(): void };
type PatchedKeybindings = EditorKeybindings & {
	[FULLSCREEN_KEYBINDINGS]?: true | KeybindingController;
	[LEGACY_FULLSCREEN_KEYBINDINGS]?: true | KeybindingController;
};

function installKeybindings(keybindings: EditorKeybindings): void {
	const patched = keybindings as PatchedKeybindings;
	const apply = () => {
		const imagePasteKeys = [
			...new Set([
				...keybindings.getKeys("app.clipboard.pasteImage"),
				"ctrl+v" as const,
				"ctrl+shift+v" as const,
			]),
		];
		const newLineKeys = [
			...new Set([
				...keybindings.getKeys("tui.input.newLine"),
				"shift+enter" as const,
				"alt+enter" as const,
			]),
		];
		const followUpKeys = keybindings
			.getKeys("app.message.followUp")
			.filter((key) => key !== "alt+enter");
		keybindings.setUserBindings({
			...keybindings.getUserBindings(),
			...FULLSCREEN_KEYS,
			"app.clipboard.pasteImage": imagePasteKeys,
			"tui.input.newLine": newLineKeys,
			"app.message.followUp": followUpKeys,
		});
	};
	const existing =
		patched[FULLSCREEN_KEYBINDINGS] ?? patched[LEGACY_FULLSCREEN_KEYBINDINGS];
	if (existing && existing !== true) {
		existing.apply = apply;
		patched[FULLSCREEN_KEYBINDINGS] = existing;
		delete patched[LEGACY_FULLSCREEN_KEYBINDINGS];
		existing.apply();
		return;
	}

	const reload = keybindings.reload.bind(keybindings);
	const controller: KeybindingController = { apply };
	keybindings.reload = () => {
		reload();
		controller.apply();
	};
	patched[FULLSCREEN_KEYBINDINGS] = controller;
	delete patched[LEGACY_FULLSCREEN_KEYBINDINGS];
	controller.apply();
}

type EditorTui = Parameters<EditorFactory>[0];
type PromptEditor = ReturnType<EditorFactory> & {
	isShowingAutocomplete?(): boolean;
};
type PendingPrompt = {
	text: string;
	messageTimestamp?: number;
	processed: boolean;
	cancelled: boolean;
	entryId?: string;
};
type RestoreRequest = { entryId: string };

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

export default function (pi: ExtensionAPI) {
	let removeFooterColors: (() => void) | undefined;
	let removeJumpToBottom: (() => void) | undefined;
	let imagePreview: ImagePreviewController | undefined;
	let removeTerminalInput: (() => void) | undefined;
	let activeEditor: PromptEditor | undefined;
	let activeTui: EditorTui | undefined;
	let submittedPrompt: string | undefined;
	let pendingPrompt: PendingPrompt | undefined;
	let restoreRequest: RestoreRequest | undefined;
	let sessionTitlePending = false;

	pi.registerMarkdownTransformer?.((markdown, context) => {
		if (context.messageType !== "assistant") return markdown;
		return markdown.replace(SESSION_TITLE_DISPLAY_PATTERN, "");
	});

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

	pi.registerCommand?.(CANCEL_PROMPT_COMMAND, {
		description: "Internal: remove an unprocessed cancelled prompt",
		handler: async (_args, ctx) => {
			const request = restoreRequest;
			restoreRequest = undefined;
			if (!request) return;

			const target = ctx.sessionManager.getEntry(request.entryId);
			if (target?.type !== "message" || target.message.role !== "user") return;
			try {
				if (ctx.sessionManager.getLeafId() === request.entryId) {
					pi.appendEntry(CANCEL_ANCHOR, { targetId: request.entryId });
				}
				await ctx.navigateTree(request.entryId, { summarize: false });
			} catch (error) {
				ctx.ui.notify(
					`Could not remove cancelled prompt: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});

	pi.on("input", (event) => {
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
			processed: false,
			cancelled: false,
		};
		submittedPrompt = undefined;
	});

	pi.on("message_start", (event) => {
		if (!pendingPrompt) return;
		if (event.message.role === "user") {
			pendingPrompt.messageTimestamp = event.message.timestamp;
		} else if (
			event.message.role === "assistant" &&
			event.message.stopReason !== "aborted"
		) {
			pendingPrompt.processed = true;
			imagePreview?.clear();
		}
	});

	pi.on("message_update", () => {
		if (pendingPrompt) pendingPrompt.processed = true;
	});

	// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Automatic session title]]
	pi.on("before_agent_start", (event) => {
		if (!sessionTitlePending || pi.getSessionName?.()) {
			sessionTitlePending = false;
			return;
		}
		return {
			systemPrompt: `${event.systemPrompt}\n\n${SESSION_TITLE_INSTRUCTION}`,
		};
	});

	pi.on("message_end", (event) => {
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

	pi.on("tool_execution_start", () => {
		if (pendingPrompt) pendingPrompt.processed = true;
	});

	pi.on("agent_settled", (_event, ctx) => {
		submittedPrompt = undefined;
		const candidate = pendingPrompt;
		if (!candidate) return;
		if (candidate.cancelled && !candidate.processed) {
			const entry = candidate.entryId
				? ctx.sessionManager.getEntry(candidate.entryId)
				: findPendingEntry(ctx);
			if (entry?.type === "message" && entry.message.role === "user") {
				restoreRequest = { entryId: entry.id };
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
		removeFooterColors?.();
		removeFooterColors = undefined;
		removeJumpToBottom?.();
		removeJumpToBottom = undefined;
		imagePreview?.dispose();
		imagePreview = undefined;
		removeTerminalInput?.();
		removeTerminalInput = undefined;
		activeEditor = undefined;
		activeTui = undefined;
		submittedPrompt = undefined;
		pendingPrompt = undefined;
		restoreRequest = undefined;
		sessionTitlePending = false;
	});

	pi.on("session_start", async (_event, ctx) => {
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
		ctx.ui.addAutocompleteProvider?.(sortModelAutocompleteDescending);

		const store = storePath(getAgentDir(), ctx.cwd);
		compactIfNeeded(store);

		// Stores written before command filtering still hold UI commands.
		const commands = pi.getCommands();
		const seeded = mergePrompts([readPrompts(store)], MAX_ENTRIES).filter(
			(text) => isRecallable(text, commands),
		);
		let historyGuard: HistoryGuard | undefined;
		const record = (text: string, sourceText: string) => {
			if (isRecallable(text, pi.getCommands())) {
				appendPrompt(store, text);
				historyGuard?.add(text);
			}
			if (
				!sourceText.trimStart().startsWith("/") &&
				!sourceText.trimStart().startsWith("!")
			) {
				submittedPrompt = sourceText;
			}
		};

		// Wrap the installed editor rather than replacing it, so this composes
		// with extensions that provide their own editor.
		const base = resolveBase(ctx.ui.getEditorComponent());
		const factory: TaggedFactory = (tui, theme, keybindings) => {
			installKeybindings(keybindings);
			const editor =
				base?.(tui, theme, keybindings) ??
				new CustomEditor(tui, theme, keybindings);
			activeEditor = editor as PromptEditor;
			activeTui = tui;
			historyGuard = installHistoryGuard(editor);
			removeJumpToBottom?.();
			removeJumpToBottom = installJumpToBottom(editor, tui);
			imagePreview?.dispose();
			imagePreview = installImagePreview(editor, tui, ctx);
			installEditorNavigation(editor, keybindings);
			installInlineSlashAutocomplete(editor);
			installRecorder(
				editor,
				record,
				(text) => imagePreview?.prepare(text) ?? text,
			);
			installModelAutocompleteSubmit(editor, keybindings);
			installAutocompleteDetails(editor, tui, theme);
			removeFooterColors?.();
			removeFooterColors = installFooterColors(tui, ctx);
			for (const prompt of seeded) historyGuard?.add(prompt);
			return editor;
		};
		factory[WRAPPED] = base ?? null;

		ctx.ui.setEditorComponent(factory);
	});
}
