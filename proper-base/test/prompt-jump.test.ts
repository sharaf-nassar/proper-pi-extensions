import assert from "node:assert/strict";
import { test } from "node:test";

import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { installPromptJump } from "../src/prompt-jump.ts";

const ZONE = "\x1b]133;A\x07";
const USER = `${ZONE}\x1b[48;5;236m          \x1b[0m`;
const ASSISTANT = ZONE;

function reading(screen: string[]): string {
	return stripTerminalSequences(screen[1] ?? "").trim();
}

function harness(
	content: string[],
	options?: { color(value: string): string; subtle(value: string): string },
) {
	const scrollView = {};
	let scrollTop = 0;
	let following = false;
	const listeners = new Set<(data: string) => unknown>();
	const tui = {
		children: [],
		terminal: { rows: 24, columns: 40 },
		currentLayout: {
			primaryScrollView: scrollView,
			root: {
				children: [{ scrollView, scrollContentLines: content, children: [] }],
			},
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
	return {
		click,
		consumed,
		dispose,
		install,
		paint,
		setFollowing: (value: boolean) => {
			following = value;
		},
		setTop: (value: number) => {
			scrollTop = value;
		},
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
