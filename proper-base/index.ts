/**
 * pi-proper-base — baseline editor, fullscreen, history, and footer behavior.
 *
 * pi's Up/Down history covers the current session only, so a new session in a
 * project you have worked in for weeks starts empty. This extension seeds the
 * editor from the other sessions recorded for the same working directory, and
 * records every prompt as you submit it.
 *
 * Recording matters because pi does not create a session file until the session
 * receives its first assistant message. A session spent on slash commands
 * leaves nothing behind, so session files alone are not a complete record.
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	SessionManager,
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
	extractPrompts,
	isRecallable,
	livePromptTexts,
	mergePrompts,
	type Prompt,
	resolveBase,
	selectSessions,
	WRAPPED,
} from "./src/history.ts";
import {
	type ImagePreviewController,
	installImagePreview,
} from "./src/image-preview.ts";
import { installRecorder } from "./src/recorder.ts";
import {
	appendPrompt,
	compactIfNeeded,
	readPrompts,
	storePath,
} from "./src/store.ts";

/** Prompts seeded into the editor. Older prompts past this point are dropped. */
const MAX_ENTRIES = 200;
const CANCEL_PROMPT_COMMAND = "__proper-cancel-prompt";
const CANCEL_ANCHOR = "proper-cancel-anchor";

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

export default function (pi: ExtensionAPI) {
	let removeFooterColors: (() => void) | undefined;
	let imagePreview: ImagePreviewController | undefined;
	let removeTerminalInput: (() => void) | undefined;
	let activeEditor: PromptEditor | undefined;
	let activeTui: EditorTui | undefined;
	let submittedPrompt: string | undefined;
	let pendingPrompt: PendingPrompt | undefined;
	let restoreRequest: RestoreRequest | undefined;

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
		imagePreview?.dispose();
		imagePreview = undefined;
		removeTerminalInput?.();
		removeTerminalInput = undefined;
		activeEditor = undefined;
		activeTui = undefined;
		submittedPrompt = undefined;
		pendingPrompt = undefined;
		restoreRequest = undefined;
	});

	pi.on("session_start", async (_event, ctx) => {
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
		const seeded = (
			await loadHistory(ctx.cwd, store, ctx.sessionManager)
		).filter((text) => isRecallable(text, commands));
		const record = (text: string, sourceText: string) => {
			if (isRecallable(text, pi.getCommands())) appendPrompt(store, text);
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
			for (const prompt of seeded) editor.addToHistory?.(prompt);
			return editor;
		};
		factory[WRAPPED] = base ?? null;

		ctx.ui.setEditorComponent(factory);
	});
}

/**
 * Prompts to seed, oldest first.
 *
 * Two sources are merged. Session files carry history from before this
 * extension was installed and survive if the store is deleted. The store covers
 * sessions pi never wrote to disk. Prompts pi seeds itself from the live
 * session are excluded so they are not listed twice.
 */
async function loadHistory(
	cwd: string,
	store: string,
	sessionManager: ExtensionContext["sessionManager"],
): Promise<string[]> {
	const sources: Prompt[][] = [readPrompts(store)];

	try {
		const sessions = selectSessions(
			await SessionManager.list(cwd),
			sessionManager.getSessionFile(),
		);
		let collected = 0;
		for (const session of sessions) {
			if (collected >= MAX_ENTRIES) break;
			const prompts = readSession(session.path);
			if (prompts.length === 0) continue;
			sources.push(prompts);
			collected += prompts.length;
		}
	} catch {
		// Seed from the store alone if the session directory cannot be read.
	}

	let live: Set<string>;
	try {
		live = livePromptTexts(sessionManager.getBranch());
	} catch {
		live = new Set();
	}

	return mergePrompts(sources, MAX_ENTRIES, live);
}

/** Read one session file. A damaged session is skipped rather than failing startup. */
function readSession(path: string): Prompt[] {
	try {
		return extractPrompts(SessionManager.open(path).getEntries());
	} catch {
		return [];
	}
}
