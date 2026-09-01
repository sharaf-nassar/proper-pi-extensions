import type { TUI, TuiInputListener } from "@earendil-works/pi-tui";
import {
	compositeTuiLine,
	sliceByColumn,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

import { prioritize } from "./jump-to-bottom.ts";
import type { OutlineEntry } from "./transcript-cleanup.ts";

const INSTALLED = Symbol.for("pi-proper-base.prompt-jump");
// Plain arrows rather than arrowheads or chevrons: U+2303/U+2304 and the
// box-drawing carets are missing from common monospace fonts and render as a
// blank cell there.
const UP = " ↑ ";
const DOWN = " ↓ ";
/** Columns kept clear to the right of the chips, sparing the scrollbar. */
const RIGHT_GAP = 1;
/** Topmost rail row the stack may grow up to, below the chips. */
const RAIL_TOP = 2;
// One relevant symbol per action type, from code points common monospace
// fonts carry: the transcript's own › marks prompts, ‹ mirrors it for
// replies, × marks failures, and tool families map by name with a plain
// dot as the fallback.
const USER_SYMBOL = "›";
const ASSISTANT_SYMBOL = "‹";
const ERROR_SYMBOL = "×";
const FALLBACK_TOOL_SYMBOL = "·";
const TOOL_SYMBOLS: ReadonlyArray<readonly [RegExp, string]> = [
	[/grep|search|find|glob|locate/, "/"],
	[/read/, "≡"],
	[/edit/, "±"],
	[/write/, "+"],
	[/bash|exec|command|shell/, "$"],
	[/fetch|web|url|http/, "@"],
	[/agent|task/, "&"],
];
/** Widest hover-expanded row: symbol, space, and the action name. */
const MAX_EXPANDED_WIDTH = 16;
// Fixed truecolors, following the footer's precedent: prompts, replies, and
// failures keep stable identities, and each tool name hashes into the
// palette so one tool always wears one color.
const USER_COLOR = "38;2;120;170;255";
const ASSISTANT_COLOR = "38;2;140;200;140";
const ERROR_COLOR = "38;2;235;110;110";
const TOOL_COLORS = [
	"38;2;80;190;180",
	"38;2;175;150;235",
	"38;2;210;170;90",
	"38;2;215;125;95",
	"38;2;120;155;205",
	"38;2;225;140;175",
	"38;2;160;180;95",
	"38;2;95;190;225",
];
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
	rect?: { y: number; height: number };
	children?: LayoutBox[];
};
type LayoutFrame = { root: LayoutBox; primaryScrollView?: unknown };
type Installed = Scroller & { [INSTALLED]?: () => void };
/** Screen columns of the rendered chips, in 0-based terminal cells. */
type Hit = { start: number; middle: number; end: number };
/** Screen cells of the rendered rail, with each tile's content row. */
type RailHit = { start: number; end: number; top: number; rows: number[] };
export type PromptJumpOptions = {
	color(value: string): string;
	/** Weaker than `color`, so the reading recedes behind the chips. */
	subtle(value: string): string;
	/** Session actions painted as the rail; omitted or empty disables it. */
	outline?(): readonly OutlineEntry[];
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

function primaryBox(view: Scroller): LayoutBox | undefined {
	const layout = view.currentLayout;
	const scrollView = layout?.primaryScrollView;
	if (!layout || !scrollView) return undefined;
	const visit = (box: LayoutBox): LayoutBox | undefined => {
		if (box.scrollView === scrollView) return box;
		for (const child of box.children ?? []) {
			const found = visit(child);
			if (found) return found;
		}
		return undefined;
	};
	return visit(layout.root);
}

function contentLines(view: Scroller): readonly string[] | undefined {
	return primaryBox(view)?.scrollContentLines;
}

/** FNV-1a, the same tiny stable hash the OSC 8 id tagging uses. */
function fnv1a(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

function tileColor(entry: OutlineEntry): string {
	if (entry.kind === "user") return USER_COLOR;
	if (entry.kind === "assistant") return ASSISTANT_COLOR;
	if (entry.kind === "error") return ERROR_COLOR;
	return TOOL_COLORS[fnv1a(entry.label) % TOOL_COLORS.length] ?? USER_COLOR;
}

function railSymbol(entry: OutlineEntry): string {
	if (entry.kind === "user") return USER_SYMBOL;
	if (entry.kind === "assistant") return ASSISTANT_SYMBOL;
	if (entry.kind === "error") return ERROR_SYMBOL;
	const name = entry.label.toLowerCase();
	for (const [pattern, symbol] of TOOL_SYMBOLS) {
		if (pattern.test(name)) return symbol;
	}
	return FALLBACK_TOOL_SYMBOL;
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
function promptCount(
	lines: readonly string[],
	top: number,
): string | undefined {
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
 * transcript viewport, and the clickable session action rail beneath them.
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
	let railHit: RailHit | undefined;
	/** Viewport rect the last painted frame placed the rail with. */
	let railRect: { y: number; height: number } | undefined;
	// The rail rests faint — the closest a character grid comes to
	// transparency — and takes full intensity while the pointer hovers its
	// column. Pure no-button motion is the evidence hover tracking works at
	// all: multiplexers run button-motion tracking only, and there the rail
	// keeps full intensity instead of resting permanently dim.
	let railHovered = false;
	let motionSeen = false;
	// Whether a button press is currently unreleased, tracked from the raw
	// stream. xterm encodes no-button motion with base 3, but Scribe uses
	// base 0 — the left button's — so that shape only reads as hover while
	// nothing is actually held; with a press open it is drag motion.
	let buttonHeld = false;
	const railDimmed = () => motionSeen && !railHovered;
	// The prompt scan walks every transcript line and runs once per frame
	// while the viewport is scrolled up, so it is cached on the pair that
	// changes when the reading can change.
	// ponytail: keyed on (line count, scroll top) — an in-place rewrite that
	// keeps the length can show a stale reading until either key moves.
	let countCache:
		| { length: number; top: number; value: string | undefined }
		| undefined;
	const chipWidth = visibleWidth(UP) + visibleWidth(DOWN);
	const hadOwnMethod = Object.hasOwn(view, "compositeFlashes");
	const flashes = view.compositeFlashes;

	/**
	 * Paint the session action rail: one uniquely colored, type-relevant
	 * symbol per action in a single column against the scrollbar gap, stacked
	 * in session order and anchored to the bottom of the transcript viewport.
	 * The stack grows upward from there, does not move with transcript
	 * scrolling, and when it overflows it shows the newest tail, sliding only
	 * to keep the action the viewport currently sits in on screen.
	 *
	 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Session action rail]]
	 */
	const paintRail = (
		painted: string[],
		width: number,
		rect: { y: number; height: number } | undefined,
	): RailHit | undefined => {
		const entries = options.outline?.() ?? [];
		if (!entries.length) return undefined;
		// One cell against the scrollbar gap.
		const start = width - RIGHT_GAP - 1;
		if (start < 0) return undefined;
		const bottom = rect ? rect.y + rect.height : 0;
		const height = bottom - RAIL_TOP;
		if (height <= 0) return undefined;
		// The action the viewport currently sits in; -1 above the first one.
		let current = entries.length - 1;
		if (!view.isFollowingOutput) {
			current = -1;
			for (let index = 0; index < entries.length; index++) {
				const entry = entries[index];
				if (!entry || entry.row > view.viewportTop) break;
				current = index;
			}
		}
		const offset =
			entries.length <= height
				? 0
				: Math.min(entries.length - height, Math.max(0, current));
		const count = Math.min(entries.length - offset, height);
		// Anchored to the bottom of the transcript viewport: the stack grows
		// upward from there and only slides once it reaches the top.
		const top = bottom - count;
		const rows: number[] = [];
		// While the pointer hovers, each row expands to "symbol name", still
		// flush against the gap; the hit band widens with the longest row so
		// the pointer can travel along the names without collapsing them.
		// The no-motion fallback stays a compact fully lit column.
		let bandWidth = 1;
		for (let index = offset; index < offset + count; index++) {
			const entry = entries[index];
			if (!entry) break;
			const row = top + rows.length;
			const text = railHovered
				? truncateToWidth(
						`${railSymbol(entry)} ${entry.label}`,
						MAX_EXPANDED_WIDTH,
						"…",
					)
				: railSymbol(entry);
			const textWidth = visibleWidth(text);
			const columnStart = width - RIGHT_GAP - textWidth;
			if (columnStart < 0) {
				rows.push(entry.row);
				continue;
			}
			bandWidth = Math.max(bandWidth, textWidth);
			// Resting, the rail sits underneath the session text: a symbol paints
			// only when its cell is blank, and a transcript row running through
			// the column keeps its text. Hover lifts the stack to the top.
			if (
				railDimmed() &&
				stripTerminalSequences(
					sliceByColumn(painted[row] ?? "", columnStart, textWidth, true),
				).trim()
			) {
				rows.push(entry.row);
				continue;
			}
			let tile = `\x1b[${tileColor(entry)}m${text}\x1b[39m`;
			if (index === current) tile = `\x1b[7m${tile}\x1b[27m`;
			// Faint keeps the per-type colors readable while receding behind the
			// transcript; hover restores full intensity.
			if (railDimmed()) tile = `\x1b[2m${tile}\x1b[22m`;
			paintRow(painted, row, tile, textWidth, columnStart, width);
			rows.push(entry.row);
		}
		return { start: width - RIGHT_GAP - bandWidth, end: start + 1, top, rows };
	};

	const decorate = (screen: string[], width: number): string[] => {
		const painted = [...screen];
		const start = width - RIGHT_GAP - chipWidth;
		if (start < 0) {
			hit = undefined;
		} else {
			hit = { start, middle: start + visibleWidth(UP), end: start + chipWidth };
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
			// The reading only answers "where am I", so it stays out of the way
			// while the viewport is already following the newest output.
			let count: string | undefined;
			if (!view.isFollowingOutput) {
				const lines = contentLines(view) ?? [];
				const top = view.viewportTop;
				if (
					!countCache ||
					countCache.length !== lines.length ||
					countCache.top !== top
				) {
					countCache = {
						length: lines.length,
						top,
						value: promptCount(lines, top),
					};
				}
				count = countCache.value;
			}
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
		}
		railRect = primaryBox(view)?.rect;
		railHit = paintRail(painted, width, railRect);
		return painted;
	};

	/**
	 * The renderer assigns the frame's layout only after compositing, so the
	 * rail is always placed with the previous frame's viewport. The frames of
	 * a settled session make that invisible — except right after a reload,
	 * where the one frame drawn against the outgoing layout can be the last
	 * for a while, leaving the stack floating above the bottom. Once this
	 * frame's own layout lands, ask for one corrective repaint if it moved;
	 * repainting re-runs this check, which stops as soon as the rects agree.
	 */
	const verify = () => {
		if (!(options.outline?.() ?? []).length) return;
		const now = primaryBox(view)?.rect;
		if (now?.y === railRect?.y && now?.height === railRect?.height) return;
		view.requestRender();
	};

	const wrapped = (screen: string[], width: number, height: number) => {
		// This runs inside the renderer's own frame, where anything thrown leaves
		// the process with no handler and takes the session down. A decoration is
		// never worth that, so a failure drops the chips for the frame instead.
		let painted = screen;
		try {
			painted = decorate(screen, width);
			// After the current frame completes and its layout is assigned.
			queueMicrotask(verify);
		} catch {
			hit = undefined;
			railHit = undefined;
		}
		// Flashes composite last, so a transient message still wins the row.
		return flashes.call(view, painted, width, height);
	};
	view.compositeFlashes = wrapped;

	const listener: TuiInputListener = (data) => {
		if (!data.startsWith(ESC)) return undefined;
		// A moving pointer batches several SGR events into one stdin chunk, so
		// motion is scanned per sequence — a whole-chunk match would miss every
		// coalesced stream and never prove hover tracking. The last position
		// wins. Pure no-button motion drives the hover reveal and is never
		// consumed: the renderer needs it for its own hover surfaces.
		let moved = false;
		let pointerColumn = 0;
		let pointerRow = 0;
		for (const segment of data.split(ESC)) {
			if (!segment) continue;
			const event = SGR_MOUSE_TAIL.exec(segment);
			if (!event) continue;
			const code = Number.parseInt(event[1] ?? "", 10);
			if ((code & 32) !== 32) {
				// Plain button traffic: remember whether a press is unreleased,
				// which is what separates drag motion from hover below. Wheel
				// reports carry bit 64 and say nothing about held buttons.
				if ((code & 64) === 0) buttonHeld = event[4] === "M";
				continue;
			}
			if ((code & 3) !== 3 && buttonHeld) continue;
			moved = true;
			pointerColumn = Number.parseInt(event[2] ?? "", 10) - 1;
			pointerRow = Number.parseInt(event[3] ?? "", 10) - 1;
		}
		if (moved) {
			const rail = railHit;
			const wasDimmed = railDimmed();
			motionSeen = true;
			railHovered =
				!!rail &&
				pointerColumn >= rail.start &&
				pointerColumn < rail.end &&
				pointerRow >= RAIL_TOP &&
				pointerRow < rail.top + rail.rows.length;
			if (railDimmed() !== wasDimmed) view.requestRender();
			return undefined;
		}
		const match = SGR_MOUSE_TAIL.exec(data.slice(1));
		if (!match || match[1] !== LEFT_BUTTON) return undefined;
		const column = Number.parseInt(match[2] ?? "", 10) - 1;
		const row = Number.parseInt(match[3] ?? "", 10) - 1;
		const button = hit;
		if (button && row === 0 && column >= button.start && column < button.end) {
			// Consume the release too, so the renderer never sees a half press and
			// starts a text selection at the chips.
			if (match[4] === "M") jump(view, column < button.middle ? -1 : 1);
			return { consume: true };
		}
		const rail = railHit;
		if (
			rail &&
			column >= rail.start &&
			column < rail.end &&
			row >= rail.top &&
			row < rail.top + rail.rows.length
		) {
			if (match[4] === "M") {
				const target = rail.rows[row - rail.top];
				if (target !== undefined) view.scrollBy(target - view.viewportTop);
			}
			return { consume: true };
		}
		return undefined;
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
		railHit = undefined;
		delete target[INSTALLED];
	};
	target[INSTALLED] = dispose;
	return dispose;
}
