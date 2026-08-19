import type { Component } from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.editor-navigation");

type Keybindings = {
	matches(data: string, action: string): boolean;
};

type NavigableEditor = Component & {
	handleInput?(data: string): void;
	getCursor?(): { line: number; col: number };
	getLines?(): string[];
	isShowingAutocomplete?(): boolean;
	state?: {
		lines: string[];
		cursorLine: number;
		cursorCol: number;
	};
	setCursorCol?(column: number): void;
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
};

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

	const handleInput = target.handleInput.bind(target);
	target.handleInput = (data: string) => {
		const home = keybindings.matches(data, "tui.editor.cursorLineStart");
		const end = keybindings.matches(data, "tui.editor.cursorLineEnd");
		if ((!home && !end) || target.isShowingAutocomplete?.()) {
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
