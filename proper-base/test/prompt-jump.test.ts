import assert from "node:assert/strict";
import { test } from "node:test";

import { stripTerminalSequences } from "@earendil-works/pi-tui";
import {
	installPromptJump,
	type PromptJumpOptions,
} from "../src/prompt-jump.ts";
import type { OutlineEntry } from "../src/transcript-cleanup.ts";

const ZONE = "\x1b]133;A\x07";
const USER = `${ZONE}\x1b[48;5;236m          \x1b[0m`;
const ASSISTANT = ZONE;

function reading(screen: string[]): string {
	return stripTerminalSequences(screen[1] ?? "").trim();
}

function harness(
	content: string[],
	options?: PromptJumpOptions,
	viewportRows = 20,
) {
	const scrollView = {};
	let scrollTop = 0;
	let following = false;
	let renderRequests = 0;
	const box = {
		scrollView,
		scrollContentLines: content,
		rect: { y: 0, height: viewportRows },
		children: [],
	};
	const listeners = new Set<(data: string) => unknown>();
	const tui = {
		children: [],
		terminal: { rows: 24, columns: 40 },
		currentLayout: {
			primaryScrollView: scrollView,
			root: { children: [box] },
		},
		requestRender() {
			renderRequests += 1;
		},
		get viewportTop() {
			return scrollTop;
		},
		get isFollowingOutput() {
			return following;
		},
		scrollBy(lines: number) {
			scrollTop = Math.max(0, scrollTop + lines);
		},
		scrollToBottom() {
			scrollTop = content.length;
		},
		compositeFlashes(screen: string[], _width: number, _height: number) {
			return screen;
		},
		inputListeners: listeners,
		addInputListener(listener: (data: string) => unknown) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	// Pi's renderer owns the first listener and consumes every mouse event.
	const consumed: string[] = [];
	listeners.add((data: string) => {
		consumed.push(data);
		return { consume: true };
	});

	const install = () =>
		installPromptJump(
			tui as never,
			options ?? {
				color: (value) => `\x1b[90m${value}\x1b[39m`,
				subtle: (value) => `\x1b[2m${value}\x1b[22m`,
			},
		);
	const dispose = install();
	const paint = (width: number, rows?: string[]) =>
		tui.compositeFlashes(
			rows ?? Array.from({ length: 24 }, () => ""),
			width,
			24,
		);
	const click = (column: number, row = 0) => {
		const press = `\x1b[<0;${column + 1};${row + 1}M`;
		for (const listener of listeners) {
			if ((listener(press) as { consume?: boolean })?.consume) return true;
		}
		return false;
	};
	// Several points join into one chunk, matching how a moving pointer's
	// events coalesce in a single stdin read. Code 35 is xterm's no-button
	// motion; Scribe encodes the same motion with base 0 as code 32.
	const move = (points: Array<[number, number]>, code = 35) => {
		const chunk = points
			.map(([column, row]) => `\x1b[<${code};${column + 1};${row + 1}M`)
			.join("");
		for (const listener of listeners) {
			if ((listener(chunk) as { consume?: boolean })?.consume) return;
		}
	};
	const release = (column: number, row: number) => {
		const event = `\x1b[<0;${column + 1};${row + 1}m`;
		for (const listener of listeners) {
			if ((listener(event) as { consume?: boolean })?.consume) return;
		}
	};
	return {
		click,
		consumed,
		dispose,
		install,
		move,
		paint,
		release,
		setFollowing: (value: boolean) => {
			following = value;
		},
		setTop: (value: number) => {
			scrollTop = value;
		},
		setViewportRows: (rows: number) => {
			box.rect = { y: 0, height: rows };
		},
		renders: () => renderRequests,
		top: () => scrollTop,
	};
}

// @lat: [[lat.md/proper-base/tests#Verification#Prompt jump fixture]]
test("the chips render in the transcript's top-right corner", () => {
	const app = harness([USER]);

	const screen = app.paint(40);
	assert.equal(
		stripTerminalSequences(screen[0] ?? ""),
		`${" ".repeat(33)} ↑  ↓  `,
	);
	assert.deepEqual(
		screen.slice(2),
		Array.from({ length: 22 }, () => ""),
	);

	// A terminal too narrow for both chips drops them entirely.
	assert.equal(app.paint(5)[0], "");
});

test("the reading counts prompts only while scrolled away from output", () => {
	const app = harness(["banner", USER, ASSISTANT, "body", USER, USER]);

	// Above the first prompt nothing has been passed yet.
	assert.equal(reading(app.paint(40)), "0/3");

	app.setTop(1);
	const screen = app.paint(40);
	assert.equal(reading(screen), "1/3");

	// Centred on the chips, not on the screen edge, and weaker than them.
	const arrows = stripTerminalSequences(screen[0] ?? "");
	const count = stripTerminalSequences(screen[1] ?? "");
	// An odd-width reading cannot land dead centre on an even-width chip pair,
	// so half a cell is the tightest achievable bound.
	const arrowCentre = (arrows.indexOf("↑") + arrows.indexOf("↓")) / 2;
	const countCentre = (count.indexOf("1") + count.indexOf("3")) / 2;
	assert.ok(
		Math.abs(countCentre - arrowCentre) <= 0.5,
		`reading centre ${countCentre} vs arrows ${arrowCentre}`,
	);
	assert.ok((screen[1] ?? "").includes("\x1b[2m1/3"));

	app.setTop(5);
	assert.equal(reading(app.paint(40)), "3/3");

	app.setFollowing(true);
	assert.equal(reading(app.paint(40)), "");

	// A transcript without prompts has nothing to report.
	const empty = harness(["body", ASSISTANT]);
	assert.equal(reading(empty.paint(40)), "");
});

test("the cached reading tracks appended prompts and scrolling", () => {
	const content = [USER, "body"];
	const app = harness(content);

	assert.equal(reading(app.paint(40)), "1/1");
	// A frame that changes neither the line count nor the scroll position
	// serves the cached reading.
	assert.equal(reading(app.paint(40)), "1/1");

	// Streaming appends invalidate through the line count.
	content.push(ASSISTANT, USER);
	assert.equal(reading(app.paint(40)), "1/2");

	// Scrolling invalidates through the viewport position.
	app.setTop(3);
	assert.equal(reading(app.paint(40)), "2/2");
});

test("the chips keep the background of the row they cover", () => {
	const app = harness([USER]);
	const banner = `\x1b[48;5;237m${" ".repeat(40)}\x1b[49m`;

	const row = app.paint(40, [banner])[0] ?? "";
	// Without replaying the covered row's style the chips reset those cells to
	// the terminal default and cut a hole in the banner.
	assert.ok(row.includes("48;5;237m\x1b[90m ↑  ↓ "));
});

test("a row ending in a truncated escape still paints", () => {
	const app = harness([USER, "body", USER]);
	app.setTop(2);

	// A slice can end mid-escape. Scanning it for the covered row's colors must
	// terminate rather than spin the render loop forever.
	const rows = Array.from({ length: 24 }, () => "");
	rows[0] = `${" ".repeat(36)}\x1b[38;2;52`;
	rows[1] = `${" ".repeat(36)}\x1b[`;
	const screen = app.paint(40, rows);

	assert.match(stripTerminalSequences(screen[0] ?? ""), /↑ {2}↓/);
	assert.equal(reading(screen), "2/2");
});

test("a failing decoration leaves the frame to the renderer", () => {
	const thrower = (value: string): string => {
		throw new Error(`theme exploded on ${value}`);
	};
	const app = harness([USER, "body", USER], {
		color: thrower,
		subtle: thrower,
	});

	// Nothing thrown here has a handler in the render loop, so it would end the
	// session rather than lose one decoration.
	const rows = Array.from({ length: 24 }, () => "transcript");
	assert.deepEqual(app.paint(40, rows), rows);
	// Nothing was drawn, so the chips must not keep swallowing clicks either.
	app.click(40 - 1 - 6 + 3);
	assert.equal(app.consumed.length, 1);
});

test("clicks walk user prompts and land on the bottom past the last one", () => {
	const app = harness([USER, ASSISTANT, "body", USER, ASSISTANT, "body"]);
	app.paint(40);
	const up = 40 - 1 - 6;
	const down = up + 3;

	// Down stops at the next user prompt, then falls through to the end.
	assert.equal(app.click(down), true);
	assert.equal(app.top(), 3);
	assert.equal(app.click(down), true);
	assert.equal(app.top(), 6);
	assert.deepEqual(app.consumed, []);

	// Up walks back through user prompts and stops at the first one.
	assert.equal(app.click(up), true);
	assert.equal(app.top(), 3);
	assert.equal(app.click(up), true);
	assert.equal(app.top(), 0);
	assert.equal(app.click(up), true);
	assert.equal(app.top(), 0);
});

test("clicks outside the chips and after disposal stay with the renderer", () => {
	const app = harness([USER, ASSISTANT, "body", USER]);
	app.paint(40);
	const down = 40 - 1 - 6 + 3;

	assert.equal(app.click(down, 1), true);
	assert.equal(app.top(), 0);
	assert.equal(app.consumed.length, 1);

	app.dispose?.();
	app.paint(40);
	assert.equal(app.click(down), true);
	assert.equal(app.top(), 0);
	assert.equal(app.consumed.length, 2);
});

// @lat: [[lat.md/proper-base/tests#Verification#Prompt jump fixture]]
test("the rail stacks typed symbols up from the bottom and jumps on click", () => {
	const outline: OutlineEntry[] = [
		{ row: 0, kind: "user", label: "prompt" },
		{ row: 1, kind: "assistant", label: "reply" },
		{ row: 3, kind: "tool", label: "read" },
		{ row: 5, kind: "error", label: "bash" },
		{ row: 6, kind: "user", label: "prompt" },
	];
	const app = harness(["a", "b", "c", "d", "e", "f", "g", "h"], {
		color: (value) => value,
		subtle: (value) => value,
		outline: () => outline,
	});
	app.setFollowing(true);
	const screen = app.paint(80);
	// A single symbol column against the scrollbar gap.
	const column = 80 - 1 - 1;
	const symbol = (row: number) =>
		stripTerminalSequences(screen[row] ?? "")[column];
	const color = (row: number) => {
		const line = screen[row] ?? "";
		const at = line.indexOf("[38;2;");
		return at < 0 ? "" : line.slice(at, line.indexOf("m", at) + 1);
	};

	// Anchored to the viewport bottom (20 rows), growing upward in session
	// order, so five actions occupy rows 15-19 and leave row 14 untouched.
	// Each action type paints its relevant symbol: › prompt, ‹ reply,
	// ≡ read, × failure.
	assert.deepEqual([15, 16, 17, 18, 19].map(symbol), ["›", "‹", "≡", "×", "›"]);
	assert.equal(stripTerminalSequences(screen[14] ?? "").trim(), "");

	// Every action type wears its own color; repeated types share one, and
	// failures carry the fixed error red.
	const distinct = new Set([15, 16, 17, 18].map(color));
	assert.equal(distinct.size, 4);
	assert.equal(color(15), color(19));
	assert.ok(color(18).includes("235;110;110"));
	// The newest action carries the current highlight while following output.
	assert.ok((screen[19] ?? "").includes("\x1b[7m"));

	// Clicking the third symbol scrolls that action's row to the viewport top.
	assert.equal(app.click(column, 17), true);
	assert.equal(app.top(), 3);
	// Above the stack the click stays with the renderer.
	assert.equal(app.click(column, 14), true);
	assert.equal(app.consumed.length, 1);
});

test("an overflowing rail shows the tail and slides with the viewport", () => {
	const outline: OutlineEntry[] = [
		{ row: 0, kind: "user", label: "prompt" },
		{ row: 1, kind: "tool", label: "one" },
		{ row: 2, kind: "tool", label: "two" },
		{ row: 3, kind: "tool", label: "three" },
		{ row: 4, kind: "tool", label: "four" },
		{ row: 5, kind: "assistant", label: "reply" },
	];
	const app = harness(
		["a", "b", "c", "d", "e", "f"],
		{
			color: (value) => value,
			subtle: (value) => value,
			outline: () => outline,
		},
		5,
	);
	const column = 80 - 1 - 1;
	const symbols = (screen: string[]) =>
		screen.slice(2, 5).map((line) => stripTerminalSequences(line)[column]);

	// Three rail rows fit between the chips and the viewport bottom; the
	// overflowing stack fills them with the newest actions while following.
	// Unmapped tool names fall back to the plain dot.
	app.setFollowing(true);
	assert.deepEqual(symbols(app.paint(80)), ["·", "·", "‹"]);

	// Scrolling up to the start slides the window to the current action.
	app.setFollowing(false);
	app.setTop(0);
	assert.deepEqual(symbols(app.paint(80)), ["›", "·", "·"]);
});

test("the rail rests faint under hover tracking and sharpens on hover", () => {
	const outline: OutlineEntry[] = [
		{ row: 0, kind: "user", label: "prompt" },
		{ row: 2, kind: "tool", label: "read" },
	];
	const app = harness(["a", "b", "c"], {
		color: (value) => value,
		subtle: (value) => value,
		outline: () => outline,
	});
	app.setFollowing(true);

	const column = 80 - 1 - 1;
	const symbolAt = (screen: string[], row: number) =>
		stripTerminalSequences(screen[row] ?? "")[column];

	// Without proof of hover tracking — a multiplexer forwards no pointer
	// motion — the rail keeps full intensity rather than resting dim.
	let screen = app.paint(80);
	assert.equal(symbolAt(screen, 19), "≡");
	assert.ok(!(screen[19] ?? "").includes("\x1b[2m"));

	// Pure no-button motion away from the column proves tracking and dims
	// the rail to its faint resting state — still readable, receded. The
	// pointer stream arrives batched, several events per chunk; last wins.
	app.move([
		[74, 19],
		[10, 5],
	]);
	assert.equal(app.renders(), 1);
	screen = app.paint(80);
	assert.equal(symbolAt(screen, 19), "≡");
	assert.ok((screen[19] ?? "").includes("\x1b[2m"));

	// The faint rail remains a control: clicks in the column still jump.
	// One consumed entry so far: the renderer saw the motion chunk.
	assert.equal(app.click(column, 19), true);
	assert.equal(app.top(), 2);
	assert.equal(app.consumed.length, 1);

	// Resting, the rail sits under the session text: a transcript row
	// running through the column keeps its text and hides that symbol, while
	// blank rows still show theirs.
	const busy = Array.from({ length: 24 }, () => "");
	busy[19] = "x".repeat(80);
	screen = app.paint(80, [...busy]);
	assert.equal(symbolAt(screen, 19), "x");
	assert.equal(symbolAt(screen, 18), "›");

	// Hovering the column lifts the stack to the top at full intensity and
	// expands each row to its symbol and name, painting over the occupied
	// row and still flush against the gap.
	app.move([
		[10, 5],
		[column, 19],
	]);
	assert.equal(app.renders(), 2);
	screen = app.paint(80, [...busy]);
	assert.ok(stripTerminalSequences(screen[19] ?? "").includes("≡ read"));
	assert.ok(stripTerminalSequences(screen[18] ?? "").includes("› prompt"));
	assert.ok(!(screen[19] ?? "").includes("\x1b[2m"));

	// The hit band widens with the expanded rows: pointing at a name keeps
	// the stack open, and clicking it jumps.
	app.move([[column - 4, 18]]);
	assert.equal(app.renders(), 2);
	assert.equal(app.click(column - 4, 18), true);
	assert.equal(app.top(), 0);

	// Leaving the expanded band returns it to faint and one cell.
	app.move([[5, 5]]);
	assert.equal(app.renders(), 3);
});

test("Scribe's zero-base motion reads as hover only while nothing is held", () => {
	const outline: OutlineEntry[] = [
		{ row: 0, kind: "user", label: "prompt" },
		{ row: 2, kind: "tool", label: "read" },
	];
	const app = harness(["a", "b", "c"], {
		color: (value) => value,
		subtle: (value) => value,
		outline: () => outline,
	});
	app.setFollowing(true);
	app.paint(80);

	// Scribe encodes no-button motion with the left button's zero base
	// rather than xterm's 3. With no press open it still proves tracking
	// and dims the rail, then sharpens it over the column.
	app.move([[10, 5]], 32);
	assert.equal(app.renders(), 1);
	app.move([[78, 19]], 32);
	assert.equal(app.renders(), 2);

	// During a genuine left drag the same code is drag motion: dragging out
	// of the column must not flicker the sharpened rail back to faint.
	app.click(10, 5);
	app.move([[5, 5]], 32);
	assert.equal(app.renders(), 2);

	// Once the press releases, the same motion shape dims the rail again.
	app.release(5, 5);
	app.move([[5, 5]], 32);
	assert.equal(app.renders(), 3);
});

test("a viewport that moves after the frame requests a corrective repaint", async () => {
	const outline: OutlineEntry[] = [{ row: 0, kind: "user", label: "prompt" }];
	const app = harness(["a"], {
		color: (value) => value,
		subtle: (value) => value,
		outline: () => outline,
	});

	// The frame's own layout matches the one the rail was painted with.
	app.paint(80);
	await Promise.resolve();
	assert.equal(app.renders(), 0);

	// A reload's first frame paints against the outgoing layout — the
	// renderer assigns its own only after compositing — and can stay on
	// screen with the stack floating. When the frame's layout lands
	// elsewhere, one corrective repaint is requested.
	app.paint(80);
	app.setViewportRows(24);
	await Promise.resolve();
	assert.equal(app.renders(), 1);

	// The repaint sees the fresh viewport and requests nothing further.
	app.paint(80);
	await Promise.resolve();
	assert.equal(app.renders(), 1);
});

test("a reload's stale disposer leaves the replacement wrapper alone", () => {
	const app = harness([USER, ASSISTANT, "body", USER]);
	const stale = app.dispose;

	// Pi runs the new instance's editor factory before the outgoing instance
	// shuts down, so the reinstall has to survive the late shutdown call.
	app.install();
	stale?.();

	assert.match(stripTerminalSequences(app.paint(40)[0] ?? ""), /↑\s+↓/);
	const down = 40 - 1 - 6 + 3;
	assert.equal(app.click(down), true);
	assert.equal(app.top(), 3);
});
