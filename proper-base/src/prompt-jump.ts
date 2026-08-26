import type { TUI, TuiInputListener } from "@earendil-works/pi-tui";
import {
	compositeTuiLine,
	sliceByColumn,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { prioritize } from "./jump-to-bottom.ts";

const INSTALLED = Symbol.for("pi-proper-base.prompt-jump");
// Plain arrows rather than arrowheads or chevrons: U+2303/U+2304 and the
// box-drawing carets are missing from common monospace fonts and render as a
// blank cell there.
const UP = " ↑ ";
const DOWN = " ↓ ";
/** Columns kept clear to the right of the chips, sparing the scrollbar. */
const RIGHT_GAP = 1;
// ESC prefix is matched separately: biome bans control characters in
// regexes, and string literals carry it fine.
const SGR_MOUSE_TAIL = /^\[<(\d+);(\d+);(\d+)([Mm])$/;
const LEFT_BUTTON = "0";
// The ESC is matched separately for the same reason as the mouse sequence
// above: biome bans control characters in regexes, whichever escape spells
// them, while string literals carry them fine.
const ESC = "\x1b";
const SGR_TAIL = /^\[[0-9;]*m/;
// OSC 133 zone markers open both user and assistant transcript blocks. A user
// block opens with its background-padded box row, an assistant block with an
// empty spacer row, so trailing content after the markers identifies a prompt.
const ZONE_START = "\x1b]133;A\x07";
const ZONE_MARK = "\x1b]133;";

/** Alternate-screen renderer surface used for the chips. */
type Scroller = TUI & {
	readonly viewportTop: number;
	readonly isFollowingOutput: boolean;
	scrollBy(lines: number): void;
	scrollToBottom(): void;
	compositeFlashes(screen: string[], width: number, height: number): string[];
	currentLayout?: LayoutFrame;
};
type LayoutBox = {
	scrollView?: unknown;
	scrollContentLines?: readonly string[];
	children?: LayoutBox[];
};
type LayoutFrame = { root: LayoutBox; primaryScrollView?: unknown };
type Installed = Scroller & { [INSTALLED]?: () => void };
/** Screen columns of the rendered chips, in 0-based terminal cells. */
type Hit = { start: number; middle: number; end: number };
export type PromptJumpOptions = {
	color(value: string): string;
	/** Weaker than `color`, so the reading recedes behind the chips. */
	subtle(value: string): string;
};

function scroller(tui: TUI): Scroller | undefined {
	const candidate = tui as Partial<Scroller>;
	return typeof candidate.scrollBy === "function" &&
		typeof candidate.scrollToBottom === "function" &&
		typeof candidate.compositeFlashes === "function" &&
		typeof candidate.isFollowingOutput === "boolean" &&
		typeof candidate.viewportTop === "number"
		? (candidate as Scroller)
		: undefined;
}

function contentLines(view: Scroller): readonly string[] | undefined {
	const layout = view.currentLayout;
	const scrollView = layout?.primaryScrollView;
	if (!layout || !scrollView) return undefined;
	const visit = (box: LayoutBox): readonly string[] | undefined => {
		if (box.scrollView === scrollView) return box.scrollContentLines;
		for (const child of box.children ?? []) {
			const found = visit(child);
			if (found) return found;
		}
		return undefined;
	};
	return visit(layout.root);
}

/**
 * Leading SGR sequences of a slice, which carry the colors already active at
 * that column. Replaying them under the glyphs keeps the transcript's own
 * background intact, because compositing otherwise resets the covered cells to
 * the terminal default and cuts a hole in the row.
 *
 * Each step consumes a whole matched sequence, so the walk always advances and
 * a truncated escape ends it. That matters because this runs inside the
 * renderer's frame, where a loop that fails to terminate freezes the whole
 * application rather than degrading one row.
 */
function activeStyle(slice: string): string {
	let index = 0;
	for (;;) {
		if (slice[index] !== ESC) break;
		const tail = SGR_TAIL.exec(slice.slice(index + 1));
		if (!tail) break;
		index += 1 + tail[0].length;
	}
	return slice.slice(0, index);
}

/** Composite content onto one screen row at a column, keeping its colors. */
function paintRow(
	screen: string[],
	row: number,
	content: string,
	contentWidth: number,
	start: number,
	width: number,
): void {
	if (start < 0 || row >= screen.length) return;
	const line = screen[row] ?? "";
	const beneath = activeStyle(sliceByColumn(line, start, contentWidth, true));
	screen[row] = compositeTuiLine(
		line,
		`${beneath}${content}`,
		start,
		contentWidth,
		width,
	);
}

function isPromptRow(line: string): boolean {
	if (!line.startsWith(ZONE_START)) return false;
	let index = 0;
	while (line.startsWith(ZONE_MARK, index)) index += ZONE_START.length;
	return index < line.length;
}

/**
 * Position of the prompt the viewport currently sits in, counted from the top
 * of the transcript, alongside the session's total prompt count. Scrolling
 * above the first prompt reports position zero, so one down click always
 * advances the reading by one.
 */
function promptCount(view: Scroller): string | undefined {
	const lines = contentLines(view) ?? [];
	const top = view.viewportTop;
	let current = 0;
	let total = 0;
	for (let row = 0; row < lines.length; row++) {
		if (!isPromptRow(lines[row] ?? "")) continue;
		total += 1;
		if (row <= top) current = total;
	}
	return total > 0 ? `${current}/${total}` : undefined;
}

/**
 * Scroll to the neighbouring user prompt, or to the transcript end when the
 * last prompt is already above the viewport.
 */
function jump(view: Scroller, direction: 1 | -1): void {
	const lines = contentLines(view) ?? [];
	const from = view.viewportTop;
	for (
		let row = from + direction;
		row >= 0 && row < lines.length;
		row += direction
	) {
		if (!isPromptRow(lines[row] ?? "")) continue;
		view.scrollBy(row - from);
		return;
	}
	if (direction === 1) view.scrollToBottom();
}

/**
 * Render clickable previous/next prompt chips in the top-right corner of the
 * transcript viewport.
 *
 * The chips composite into the finished screen rather than an overlay: any
 * visible overlay disables Pi's scrollbar hit testing, which is a gesture
 * users reach for in the same scrolled-up state. They carry no background of
 * their own and replay the covered row's colors, so the transcript reads
 * through as two quiet arrows instead of a punched-out block.
 *
 * Regular-mode terminals scroll themselves, so nothing is installed there.
 *
 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Prompt jump chips]]
 */
export function installPromptJump(
	tui: TUI,
	options: PromptJumpOptions,
): (() => void) | undefined {
	const view = scroller(tui);
	if (!view) return undefined;
	const target = view as Installed;
	// A reload runs the new instance's editor factory before the outgoing
	// instance shuts down, so take over any wrapper it left on the renderer.
	target[INSTALLED]?.();

	let hit: Hit | undefined;
	const chipWidth = visibleWidth(UP) + visibleWidth(DOWN);
	const hadOwnMethod = Object.hasOwn(view, "compositeFlashes");
	const flashes = view.compositeFlashes;

	const decorate = (screen: string[], width: number): string[] => {
		const start = width - RIGHT_GAP - chipWidth;
		if (start < 0) {
			hit = undefined;
			return screen;
		}
		hit = { start, middle: start + visibleWidth(UP), end: start + chipWidth };
		const painted = [...screen];
		// Colored per frame rather than once at install, so a theme that rejects
		// the request fails inside the guard instead of out of the editor factory.
		paintRow(
			painted,
			0,
			options.color(`${UP}${DOWN}`),
			chipWidth,
			start,
			width,
		);
		// The reading only answers "where am I", so it stays out of the way while
		// the viewport is already following the newest output.
		const count = view.isFollowingOutput ? undefined : promptCount(view);
		if (count) {
			const countWidth = visibleWidth(count);
			// Centred on the chips rather than the screen edge: the chips carry a
			// padding column each, so sharing the right margin would sit the
			// reading off to one side of the arrows.
			const centred = Math.min(
				start + Math.round((chipWidth - countWidth) / 2),
				width - RIGHT_GAP - countWidth,
			);
			paintRow(painted, 1, options.subtle(count), countWidth, centred, width);
		}
		return painted;
	};

	const wrapped = (screen: string[], width: number, height: number) => {
		// This runs inside the renderer's own frame, where anything thrown leaves
		// the process with no handler and takes the session down. A decoration is
		// never worth that, so a failure drops the chips for the frame instead.
		let painted = screen;
		try {
			painted = decorate(screen, width);
		} catch {
			hit = undefined;
		}
		// Flashes composite last, so a transient message still wins the row.
		return flashes.call(view, painted, width, height);
	};
	view.compositeFlashes = wrapped;

	const listener: TuiInputListener = (data) => {
		const button = hit;
		if (!button) return undefined;
		if (!data.startsWith("\x1b")) return undefined;
		const match = SGR_MOUSE_TAIL.exec(data.slice(1));
		if (!match || match[1] !== LEFT_BUTTON) return undefined;
		const column = Number.parseInt(match[2] ?? "", 10) - 1;
		const row = Number.parseInt(match[3] ?? "", 10) - 1;
		if (row !== 0 || column < button.start || column >= button.end) {
			return undefined;
		}
		// Consume the release too, so the renderer never sees a half press and
		// starts a text selection at the chips.
		if (match[4] === "M") jump(view, column < button.middle ? -1 : 1);
		return { consume: true };
	};
	const unsubscribe = tui.addInputListener(listener);
	prioritize(tui, listener);

	// A disposer left over from a previous extension instance must not unwrap
	// the installation that replaced it.
	const dispose = () => {
		if (view.compositeFlashes !== wrapped) return;
		unsubscribe();
		if (hadOwnMethod) view.compositeFlashes = flashes;
		else delete (view as Partial<Scroller>).compositeFlashes;
		hit = undefined;
		delete target[INSTALLED];
	};
	target[INSTALLED] = dispose;
	return dispose;
}
