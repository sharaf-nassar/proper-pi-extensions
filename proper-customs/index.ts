/**
 * pi-proper-customs — cross-session history and autocomplete detail rendering.
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
	SessionManager,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { installAutocompleteDetails } from "./src/autocomplete-details.ts";
import { installFooterColors } from "./src/footer-colors.ts";
import {
	WRAPPED,
	type Prompt,
	extractPrompts,
	livePromptTexts,
	mergePrompts,
	resolveBase,
	selectSessions,
} from "./src/history.ts";
import { installRecorder } from "./src/recorder.ts";
import {
	appendPrompt,
	compactIfNeeded,
	readPrompts,
	storePath,
} from "./src/store.ts";

/** Prompts seeded into the editor. Older prompts past this point are dropped. */
const MAX_ENTRIES = 200;

type EditorFactory = NonNullable<
	ReturnType<ExtensionContext["ui"]["getEditorComponent"]>
>;

type TaggedFactory = EditorFactory & { [WRAPPED]?: EditorFactory | null };
type EditorKeybindings = Parameters<EditorFactory>[2];

const FULLSCREEN_KEYBINDINGS = Symbol.for(
	"pi-proper-customs.fullscreen-keybindings",
);
const FULLSCREEN_KEYS = {
	"tui.altScreen.pageUp": "shift+pageUp",
	"tui.altScreen.pageDown": "shift+pageDown",
	"tui.altScreen.top": "shift+home",
	"tui.altScreen.bottom": "shift+end",
} as const;

type PatchedKeybindings = EditorKeybindings & {
	[FULLSCREEN_KEYBINDINGS]?: true;
};

function installFullscreenKeybindings(keybindings: EditorKeybindings): void {
	const patched = keybindings as PatchedKeybindings;
	const apply = () => {
		keybindings.setUserBindings({
			...keybindings.getUserBindings(),
			...FULLSCREEN_KEYS,
		});
	};
	if (!patched[FULLSCREEN_KEYBINDINGS]) {
		const reload = keybindings.reload.bind(keybindings);
		keybindings.reload = () => {
			reload();
			apply();
		};
		patched[FULLSCREEN_KEYBINDINGS] = true;
	}
	apply();
}

export default function (pi: ExtensionAPI) {
	let removeFooterColors: (() => void) | undefined;

	pi.on("session_shutdown", () => {
		removeFooterColors?.();
		removeFooterColors = undefined;
	});

	pi.on("session_start", async (_event, ctx) => {
		const store = storePath(getAgentDir(), ctx.cwd);
		compactIfNeeded(store);

		const seeded = await loadHistory(ctx.cwd, store, ctx.sessionManager);
		const record = (text: string) => {
			appendPrompt(store, text);
		};

		// Wrap the installed editor rather than replacing it, so this composes
		// with extensions that provide their own editor.
		const base = resolveBase(ctx.ui.getEditorComponent());
		const factory: TaggedFactory = (tui, theme, keybindings) => {
			installFullscreenKeybindings(keybindings);
			const editor =
				base?.(tui, theme, keybindings) ??
				new CustomEditor(tui, theme, keybindings);
			installRecorder(editor, record);
			installAutocompleteDetails(editor, tui, theme);
			removeFooterColors?.();
			removeFooterColors = installFooterColors(tui, ctx);
			for (const prompt of seeded) editor.addToHistory(prompt);
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
