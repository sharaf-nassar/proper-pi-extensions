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
		if (
			!keybindings.matches(data, "tui.editor.cursorLineEnd") ||
			target.isShowingAutocomplete?.()
		) {
			handleInput(data);
			return;
		}

		const lines = target.getLines?.() ?? [];
		const cursor = target.getCursor?.();
		const currentLine = cursor ? lines[cursor.line] : undefined;
		if (!cursor || currentLine === undefined || cursor.col < currentLine.length) {
			handleInput(data);
			return;
		}

		const lastLine = lines.length - 1;
		if (cursor.line >= lastLine) {
			handleInput(data);
			return;
		}

		const state = target.state;
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
			if (!after || (after.line === before.line && after.col === before.col)) break;
		}
		handleInput(data);
	};
	target[INSTALLED] = true;
}
