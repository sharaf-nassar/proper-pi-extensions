import {
	type Component,
	decodeKittyPrintable,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.editor-navigation");
const REVERSE_SEARCH_INSTALLED = Symbol.for(
	"pi-proper-base.reverse-history-search",
);
const PROMPT_CLEAR_INSTALLED = Symbol.for("pi-proper-base.prompt-clear");
const CLEAR_EXIT_WINDOW_MS = 500;
const IMAGE_MARKER = /\[image [1-9]\d*\]/g;

type Keybindings = {
	matches(data: string, action: string): boolean;
};

type PromptClearContext = {
	shutdown(): void;
	ui: {
		theme: { fg(color: "warning", text: string): string };
	};
};

type PromptClearController = {
	cleanup(): void;
	update(
		tui: Pick<TUI, "requestRender">,
		keybindings: Keybindings,
		ctx: PromptClearContext,
	): void;
};

type TextSegment = {
	segment: string;
	index: number;
	input: string;
};

type NavigableEditor = Component & {
	borderColor?(text: string): string;
	handleInput?(data: string): void;
	getCursor?(): { line: number; col: number };
	getLines?(): string[];
	getText?(): string;
	isShowingAutocomplete?(): boolean;
	onChange?(text: string): void;
	setText?(text: string): void;
	historyIndex?: number;
	state?: {
		lines: string[];
		cursorLine: number;
		cursorCol: number;
	};
	setCursorCol?(column: number): void;
	segment?(text: string, mode: "grapheme" | "word"): Iterable<TextSegment>;
	lastWidth?: number;
	buildVisualLineMap?(width: number): Array<{
		logicalLine: number;
		startCol: number;
		length: number;
	}>;
	findCurrentVisualLine?(
		visualLines: Array<{
			logicalLine: number;
			startCol: number;
			length: number;
		}>,
	): number;
	[INSTALLED]?: boolean;
	[REVERSE_SEARCH_INSTALLED]?: ReverseHistorySearchController;
	[PROMPT_CLEAR_INSTALLED]?: PromptClearController;
};

export type ReverseHistorySearchController = {
	add(text: string): void;
	reset(prompts: readonly string[]): void;
};

/** The large-paste registry pi-tui's `setText()` clears alongside the text. */
type PasteRegistryEditor = {
	setText?(text: string): void;
	pastes?: Map<number, string>;
	pasteCounter?: number;
};

// pi-tui's `setText()` empties its `[paste #N]` registry even when the new
// text keeps the markers; submission would then send the literal tag instead
// of the pasted content. Restore the entries the new text still references,
// and the id counter with them so the next paste cannot collide with a kept
// id.
export function setTextKeepingPastes(editor: unknown, text: string): void {
	const target = editor as PasteRegistryEditor;
	const registry =
		target.pastes instanceof Map ? [...target.pastes] : undefined;
	const counter = target.pasteCounter;
	target.setText?.(text);
	if (!registry?.length || !(target.pastes instanceof Map)) return;
	let kept = false;
	for (const [id, content] of registry) {
		const marker = `[paste #${id}`;
		if (!text.includes(`${marker}]`) && !text.includes(`${marker} `)) continue;
		target.pastes.set(id, content);
		kept = true;
	}
	if (kept && typeof counter === "number") target.pasteCounter = counter;
}

function segmentImageMarkers(
	text: string,
	segments: Iterable<TextSegment>,
): TextSegment[] {
	const markers = [...text.matchAll(IMAGE_MARKER)].map((match) => ({
		start: match.index,
		end: match.index + match[0].length,
	}));
	if (markers.length === 0) return [...segments];

	const result: TextSegment[] = [];
	let markerIndex = 0;
	for (const segment of segments) {
		while (
			markerIndex < markers.length &&
			(markers[markerIndex]?.end ?? 0) <= segment.index
		) {
			markerIndex += 1;
		}
		const marker = markers[markerIndex];
		if (marker && segment.index >= marker.start && segment.index < marker.end) {
			if (segment.index === marker.start) {
				result.push({
					segment: text.slice(marker.start, marker.end),
					index: marker.start,
					input: text,
				});
			}
			continue;
		}
		result.push(segment);
	}
	return result;
}

function imageMarkerCursorTarget(
	line: string,
	column: number,
	direction: "left" | "right",
): number | undefined {
	for (const match of line.matchAll(IMAGE_MARKER)) {
		const start = match.index;
		const end = start + match[0].length;
		if (direction === "left" && column > start && column <= end) return start;
		if (direction === "right" && column >= start && column < end) return end;
	}
	return undefined;
}

export function installEditorNavigation(
	editor: Component,
	keybindings: Keybindings,
): void {
	const target = editor as NavigableEditor;
	if (
		target[INSTALLED] ||
		!target.handleInput ||
		!target.getCursor ||
		!target.getLines
	) {
		return;
	}

	const segment = target.segment?.bind(target);
	if (segment) {
		target.segment = (text, mode) =>
			segmentImageMarkers(text, segment(text, mode));
	}
	const handleInput = target.handleInput.bind(target);
	target.handleInput = (data: string) => {
		const home = keybindings.matches(data, "tui.editor.cursorLineStart");
		const end = keybindings.matches(data, "tui.editor.cursorLineEnd");
		const left = keybindings.matches(data, "tui.editor.cursorLeft");
		const right = keybindings.matches(data, "tui.editor.cursorRight");
		const backspace = keybindings.matches(
			data,
			"tui.editor.deleteCharBackward",
		);
		const previous =
			keybindings.matches(data, "tui.editor.cursorUp") ||
			keybindings.matches(data, "tui.editor.historyPrevious");
		if (target.isShowingAutocomplete?.()) {
			handleInput(data);
			return;
		}
		if (backspace) {
			const cursor = target.getCursor?.();
			const state = target.state;
			const line = cursor ? target.getLines?.()[cursor.line] : undefined;
			const marker = line
				? [...line.matchAll(IMAGE_MARKER)].find(
						(match) => match.index === cursor?.col,
					)
				: undefined;
			if (cursor && state && marker) {
				const end = marker.index + marker[0].length;
				if (target.setCursorCol) target.setCursorCol(end);
				else state.cursorCol = end;
				handleInput(data);
				return;
			}
		}
		if (left || right) {
			const cursor = target.getCursor?.();
			const state = target.state;
			const line = cursor ? target.getLines?.()[cursor.line] : undefined;
			const column =
				cursor && line !== undefined
					? imageMarkerCursorTarget(line, cursor.col, left ? "left" : "right")
					: undefined;
			if (column !== undefined && state) {
				if (target.setCursorCol) target.setCursorCol(column);
				else state.cursorCol = column;
				return;
			}
		}
		if (previous) {
			// Pi recalls history on Up from the first visual row whenever the
			// cursor sits at column 0, so Home followed by Up, or Up pressed
			// twice from a short first line, replaces a draft with an older
			// prompt. Recall is only for an empty prompt: with a draft and no
			// recall in progress, Up at that position is already at the line
			// start Pi would otherwise jump to, so it does nothing. The dedicated
			// history binding is left alone; it is opt-in and explicit.
			if (
				keybindings.matches(data, "tui.editor.cursorUp") &&
				(target.historyIndex ?? -1) < 0 &&
				target.getCursor?.().col === 0 &&
				target.getLines?.().some((line) => line !== "")
			) {
				const visualLines = target.buildVisualLineMap?.(target.lastWidth ?? 80);
				const visualIndex = visualLines
					? target.findCurrentVisualLine?.(visualLines)
					: undefined;
				if (visualIndex === 0) return;
			}
			const before = target.getLines?.().join("\n");
			handleInput(data);
			const state = target.state;
			if (state && target.getLines?.().join("\n") !== before) {
				state.cursorLine = 0;
				if (target.setCursorCol) target.setCursorCol(0);
				else state.cursorCol = 0;
			}
			return;
		}
		if (!home && !end) {
			handleInput(data);
			return;
		}

		const lines = target.getLines?.() ?? [];
		const cursor = target.getCursor?.();
		const state = target.state;
		if (home) {
			const visualLines = target.buildVisualLineMap?.(target.lastWidth ?? 80);
			const visualIndex = visualLines
				? target.findCurrentVisualLine?.(visualLines)
				: undefined;
			const visualLine =
				visualIndex === undefined || visualIndex < 0
					? undefined
					: visualLines?.[visualIndex];
			if (!cursor || !state || !visualLine) {
				handleInput(data);
				return;
			}
			if (cursor.col > visualLine.startCol) {
				if (target.setCursorCol) target.setCursorCol(visualLine.startCol);
				else state.cursorCol = visualLine.startCol;
				return;
			}
			if (cursor.line > 0 || cursor.col > 0) {
				state.cursorLine = 0;
				if (target.setCursorCol) target.setCursorCol(0);
				else state.cursorCol = 0;
				return;
			}
			handleInput(data);
			return;
		}

		const currentLine = cursor ? lines[cursor.line] : undefined;
		if (
			!cursor ||
			currentLine === undefined ||
			cursor.col < currentLine.length
		) {
			handleInput(data);
			return;
		}

		const lastLine = lines.length - 1;
		if (cursor.line >= lastLine) {
			handleInput(data);
			return;
		}

		if (state && Array.isArray(state.lines)) {
			state.cursorLine = lastLine;
			const column = lines[lastLine]?.length ?? 0;
			if (target.setCursorCol) target.setCursorCol(column);
			else state.cursorCol = column;
			return;
		}

		// Compatibility fallback for custom editors that expose cursor reads but
		// not pi-tui's state object.
		for (let attempts = 0; attempts < lines.length * 4; attempts++) {
			const before = target.getCursor?.();
			if (!before || before.line >= lastLine) break;
			handleInput("\x1b[B");
			const after = target.getCursor?.();
			if (!after || (after.line === before.line && after.col === before.col))
				break;
		}
		handleInput(data);
	};
	target[INSTALLED] = true;
}

// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Prompt clearing and exit]]
export function installPromptClear(
	editor: Component,
	tui: Pick<TUI, "requestRender">,
	keybindings: Keybindings,
	ctx: PromptClearContext,
): (() => void) | undefined {
	const target = editor as NavigableEditor;
	const installed = target[PROMPT_CLEAR_INSTALLED];
	if (installed) {
		installed.update(tui, keybindings, ctx);
		return installed.cleanup;
	}
	if (!target.handleInput || !target.getText || !target.setText) return;

	let active = { tui, keybindings, ctx };
	let lastEmptyClear = 0;
	let warningVisible = false;
	let warningTimer: NodeJS.Timeout | undefined;
	const handleInput = target.handleInput.bind(target);
	const render = target.render.bind(target);
	const clearWarning = (requestRender: boolean) => {
		if (warningTimer) clearTimeout(warningTimer);
		warningTimer = undefined;
		if (!warningVisible) return;
		warningVisible = false;
		if (requestRender) active.tui.requestRender();
	};
	const showWarning = () => {
		clearWarning(false);
		warningVisible = true;
		warningTimer = setTimeout(() => {
			warningTimer = undefined;
			warningVisible = false;
			active.tui.requestRender();
		}, CLEAR_EXIT_WINDOW_MS);
		warningTimer.unref?.();
		active.tui.requestRender();
	};
	const controller: PromptClearController = {
		cleanup() {
			lastEmptyClear = 0;
			clearWarning(false);
		},
		update(nextTui, nextKeybindings, nextCtx) {
			controller.cleanup();
			active = {
				tui: nextTui,
				keybindings: nextKeybindings,
				ctx: nextCtx,
			};
		},
	};

	target.handleInput = (data: string) => {
		if (!active.keybindings.matches(data, "app.clear")) {
			if (warningVisible) {
				lastEmptyClear = 0;
				clearWarning(true);
			}
			handleInput(data);
			return;
		}
		if (target.getText?.()) {
			lastEmptyClear = 0;
			clearWarning(false);
			target.setText?.("");
			active.tui.requestRender();
			return;
		}

		const now = Date.now();
		if (now - lastEmptyClear < CLEAR_EXIT_WINDOW_MS) {
			lastEmptyClear = 0;
			clearWarning(true);
			active.ctx.shutdown();
			return;
		}
		lastEmptyClear = now;
		showWarning();
	};
	target.render = (width: number) => {
		const lines = render(width);
		if (!warningVisible) return lines;
		const warning = truncateToWidth(" Press Ctrl+C again to exit", width, "");
		return [active.ctx.ui.theme.fg("warning", warning), ...lines];
	};
	target[PROMPT_CLEAR_INSTALLED] = controller;
	return controller.cleanup;
}

// @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Reverse history search]]
export function installReverseHistorySearch(
	editor: Component,
	tui: Pick<TUI, "requestRender">,
	keybindings: Keybindings,
	prompts: readonly string[],
	limit: number,
): ReverseHistorySearchController | undefined {
	const target = editor as NavigableEditor;
	const installed = target[REVERSE_SEARCH_INSTALLED];
	if (installed) {
		installed.reset(prompts);
		return installed;
	}
	if (
		!target.handleInput ||
		!target.getText ||
		(!target.state && !target.setText)
	)
		return undefined;

	let entries: string[] = [];
	let search:
		| {
				draft: string;
				cursor: { line: number; col: number } | undefined;
				query: string;
				index: number;
				failed: boolean;
		  }
		| undefined;
	const handleInput = target.handleInput.bind(target);
	const render = target.render.bind(target);

	const replaceText = (
		text: string,
		cursor?: { line: number; col: number },
	) => {
		const state = target.state;
		if (!state) {
			target.setText?.(text);
			return;
		}
		state.lines = text.split("\n");
		state.cursorLine = Math.max(
			0,
			Math.min(cursor?.line ?? state.lines.length - 1, state.lines.length - 1),
		);
		const line = state.lines[state.cursorLine] ?? "";
		state.cursorCol = Math.max(
			0,
			Math.min(cursor?.col ?? line.length, line.length),
		);
		target.onChange?.(text);
	};
	const findMatch = (startExclusive: number) => {
		if (!search) return;
		for (
			let index = Math.min(startExclusive, entries.length) - 1;
			index >= 0;
			index--
		) {
			const entry = entries[index];
			if (entry?.includes(search.query)) {
				search.index = index;
				search.failed = false;
				replaceText(entry);
				tui.requestRender();
				return;
			}
		}
		search.failed = true;
		tui.requestRender();
	};
	const finish = (restoreDraft: boolean) => {
		const active = search;
		search = undefined;
		if (restoreDraft && active) replaceText(active.draft, active.cursor);
		tui.requestRender();
	};
	const start = () => {
		const draft = target.getText?.();
		if (draft === undefined) return;
		if (target.isShowingAutocomplete?.()) handleInput("\x1b");
		const cursor = target.getCursor?.();
		// Exit Pi's native Up/Down history mode without adding an undo entry.
		// Its setText also wipes the large-paste registry while the draft keeps
		// its markers, so the entries the draft references are restored.
		setTextKeepingPastes(target, draft);
		search = {
			draft,
			cursor,
			query: "",
			index: -1,
			failed: false,
		};
		findMatch(entries.length);
	};
	const normalize = (values: readonly string[]) => {
		const next: string[] = [];
		for (const value of values) {
			const prompt = value.trim();
			if (prompt && next.at(-1) !== prompt) next.push(prompt);
		}
		return next.slice(-limit);
	};

	const controller: ReverseHistorySearchController = {
		add(text) {
			const prompt = text.trim();
			if (!prompt || entries.at(-1) === prompt) return;
			entries.push(prompt);
			if (entries.length > limit) entries.shift();
		},
		reset(next) {
			finish(true);
			entries = normalize(next);
		},
	};

	target.handleInput = (data: string) => {
		if (matchesKey(data, "ctrl+r")) {
			if (!search) start();
			else findMatch(search.index < 0 ? entries.length : search.index);
			return;
		}
		if (!search) {
			handleInput(data);
			return;
		}
		if (matchesKey(data, "ctrl+g")) {
			finish(true);
			return;
		}
		if (
			keybindings.matches(data, "tui.editor.deleteCharBackward") ||
			matchesKey(data, "shift+backspace")
		) {
			search.query = [...search.query].slice(0, -1).join("");
			findMatch(search.index < 0 ? entries.length : search.index + 1);
			return;
		}
		if (keybindings.matches(data, "tui.input.submit")) {
			finish(false);
			handleInput(data);
			return;
		}
		if (matchesKey(data, "escape")) {
			finish(false);
			return;
		}

		const printable =
			decodeKittyPrintable(data) ??
			(/^[^\p{Cc}]+$/u.test(data) ? data : undefined);
		if (printable !== undefined) {
			search.query += printable;
			findMatch(search.index < 0 ? entries.length : search.index + 1);
			return;
		}

		finish(false);
		handleInput(data);
	};
	target.render = (width: number) => {
		const lines = [...render(width)];
		if (!search || lines.length === 0) return lines;
		const label = `(${search.failed ? "failing " : ""}reverse-i-search)\`${search.query}':`;
		const clipped = truncateToWidth(label, width, "");
		const border = `${clipped}${"─".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
		lines[lines.length - 1] = target.borderColor?.(border) ?? border;
		return lines;
	};
	target[REVERSE_SEARCH_INSTALLED] = controller;
	controller.reset(prompts);
	return controller;
}
