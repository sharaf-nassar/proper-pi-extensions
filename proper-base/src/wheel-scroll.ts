/**
 * Pi's fullscreen renderer scrolls its transcript exactly one line per
 * mouse-wheel report: the renderer's `wheelScrollLines` option defaults to 1
 * and pi passes no override and exposes no setting. Terminals natively
 * multiply a wheel notch to about three lines, so fullscreen scrolling feels
 * slower than every other terminal surface.
 *
 * No escape sequence lets an application query the terminal's own wheel
 * configuration, so the step defaults to the 3-line application convention
 * (vim, less) and honors a per-terminal `PROPER_WHEEL_SCROLL_LINES`
 * environment override that each terminal's profile can export.
 */

const DEFAULT_WHEEL_SCROLL_LINES = 3;

/** Renderer surface carrying the per-wheel-event line count. */
type WheelHost = { wheelScrollLines?: unknown };

/** Lines per wheel event: a positive integer override, else the 3-line convention. */
export function resolveWheelScrollLines(
	env: Record<string, string | undefined> = process.env,
): number {
	const parsed = Number.parseInt(env.PROPER_WHEEL_SCROLL_LINES ?? "", 10);
	return parsed >= 1 ? parsed : DEFAULT_WHEEL_SCROLL_LINES;
}

/**
 * Raise the fullscreen renderer's wheel step. Only a renderer that already
 * exposes a numeric `wheelScrollLines` is touched, so regular mode — where
 * the terminal scrolls natively — and a renamed upstream field fail open to
 * pi's own behavior.
 *
 * ponytail: SGR wheel reports cannot distinguish a discrete mouse notch from
 * one line of a high-rate trackpad stream, so a terminal emitting one report
 * per native line scrolls proportionally faster; exporting
 * PROPER_WHEEL_SCROLL_LINES=1 there restores pi's original pace.
 */
export function installWheelScrollLines(
	tui: unknown,
	lines: number = resolveWheelScrollLines(),
): boolean {
	const host = tui as WheelHost;
	if (typeof host.wheelScrollLines !== "number") return false;
	host.wheelScrollLines = Math.floor(lines);
	return true;
}
