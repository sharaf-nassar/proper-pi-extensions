import type { Component, TUI, TuiInputListener } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";

import { rowsBelow } from "./autocomplete-details.ts";

const INSTALLED = Symbol.for("pi-proper-base.jump-to-bottom");
const LABEL = "↓ jump to bottom";
const COMPACT_LABEL = "↓";
/** Columns kept clear to the right of the button, matching the footer. */
const RIGHT_GAP = 1;
// ESC prefix is matched separately: biome bans control characters in
// regexes, and string literals carry it fine.
const SGR_MOUSE_TAIL = /^\[<(\d+);(\d+);(\d+)([Mm])$/;
const LEFT_BUTTON = "0";

/** Alternate-screen renderer surface used for the button. */
type ScrollableTui = TUI & {
	readonly isFollowingOutput: boolean;
	scrollToBottom(): void;
};
type ListenerHost = TUI & { inputListeners?: Set<TuiInputListener> };
type JumpEditor = Component & { [INSTALLED]?: () => void };
/** Screen position of the rendered button, in 0-based terminal cells. */
type Hit = { row: number; start: number; end: number };

function scrollableTui(tui: TUI): ScrollableTui | undefined {
	const candidate = tui as Partial<ScrollableTui>;
	return typeof candidate.scrollToBottom === "function" &&
		typeof candidate.isFollowingOutput === "boolean"
		? (candidate as ScrollableTui)
		: undefined;
}

/**
 * Pi's alternate-screen renderer consumes every mouse event from a listener it
 * registers in its own constructor, so an extension listener never sees a
 * click. Moving ours to the front of the set is the only way the button can
 * respond to the mouse; if that internal field ever changes shape the button
 * keeps rendering and simply stops reacting.
 */
function prioritize(tui: TUI, listener: TuiInputListener): void {
	const listeners = (tui as ListenerHost).inputListeners;
	if (!listeners?.has(listener)) return;
	const rest = [...listeners].filter((entry) => entry !== listener);
	listeners.clear();
	listeners.add(listener);
	for (const entry of rest) listeners.add(entry);
}

/**
 * Render a clickable jump-to-bottom button above the prompt while the
 * transcript viewport is scrolled up.
 *
 * The row is part of the editor's own render output rather than an overlay:
 * any visible overlay disables Pi's scrollbar dragging, which is exactly the
 * gesture in use while the button is on screen.
 *
 * Regular-mode terminals scroll themselves, so nothing is installed there.
 */
export function installJumpToBottom(
	editor: Component,
	tui: TUI,
): (() => void) | undefined {
	const target = editor as JumpEditor;
	const existing = target[INSTALLED];
	if (existing) return existing;
	const view = scrollableTui(tui);
	if (!view) return undefined;

	let hit: Hit | undefined;

	const render = target.render.bind(target);
	target.render = (width: number) => {
		const lines = render(width);
		if (view.isFollowingOutput) {
			hit = undefined;
			return lines;
		}

		const label =
			width >= visibleWidth(LABEL) + 2 + RIGHT_GAP ? LABEL : COMPACT_LABEL;
		const chipWidth = visibleWidth(label) + 2;
		const start = width - RIGHT_GAP - chipWidth;
		if (start < 0) {
			hit = undefined;
			return lines;
		}

		hit = {
			row: tui.terminal.rows - lines.length - 1 - rowsBelow(tui, target, width),
			start,
			end: start + chipWidth,
		};
		return [
			`${" ".repeat(start)}\x1b[7m ${label} \x1b[0m${" ".repeat(RIGHT_GAP)}`,
			...lines,
		];
	};

	const listener: TuiInputListener = (data) => {
		const button = hit;
		if (!button) return undefined;
		if (!data.startsWith("\x1b")) return undefined;
		const match = SGR_MOUSE_TAIL.exec(data.slice(1));
		if (!match || match[1] !== LEFT_BUTTON) return undefined;
		const column = Number.parseInt(match[2] ?? "", 10) - 1;
		const row = Number.parseInt(match[3] ?? "", 10) - 1;
		if (row !== button.row || column < button.start || column >= button.end) {
			return undefined;
		}
		// Consume the release too, so the renderer never sees a half press and
		// starts a text selection at the button.
		if (match[4] === "M") view.scrollToBottom();
		return { consume: true };
	};
	const unsubscribe = tui.addInputListener(listener);
	prioritize(tui, listener);

	const dispose = () => {
		unsubscribe();
		hit = undefined;
		delete target[INSTALLED];
	};
	target[INSTALLED] = dispose;
	return dispose;
}
