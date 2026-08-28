import type { TUI } from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.osc8-link-ids");
const OSC8_OPEN = "\x1b]8;;";
const ESC = "\x1b";
const BEL = "\x07";

type TerminalWriter = {
	write(data: string): void;
	[INSTALLED]?: () => void;
};

type TerminalTui = TUI & { terminal?: TerminalWriter };

/** FNV-1a of the URI in base36. */
function linkId(uri: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < uri.length; index++) {
		hash ^= uri.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

/** End of the URI starting at `uriStart`: the position of its BEL or ST
 * terminator, or -1 when the sequence is unterminated or malformed. */
function uriEndAt(data: string, uriStart: number): number {
	const belAt = data.indexOf(BEL, uriStart);
	const escAt = data.indexOf(ESC, uriStart);
	if (belAt !== -1 && (escAt === -1 || belAt < escAt)) return belAt;
	if (escAt !== -1 && data.startsWith("\\", escAt + 1)) return escAt;
	return -1;
}

/**
 * Give anonymous OSC 8 opens a stable URI-derived id. Pi reopens a wrapped
 * hyperlink on every physical row without an id, so terminals assign each
 * row its own link identity and hover-highlight one row at a time. A shared
 * id lets id-aware terminals treat all rows of one link as a unit. Closes
 * (empty URI), opens that already carry params, and malformed or split
 * sequences stay untouched, and data without an anonymous open passes
 * through by reference.
 */
export function tagAnonymousOsc8Links(data: string): string {
	let openAt = data.indexOf(OSC8_OPEN);
	if (openAt === -1) return data;
	let result = "";
	let copied = 0;
	while (openAt !== -1) {
		const uriStart = openAt + OSC8_OPEN.length;
		const uriEnd = uriEndAt(data, uriStart);
		if (uriEnd > uriStart) {
			const uri = data.slice(uriStart, uriEnd);
			result += `${data.slice(copied, openAt)}${ESC}]8;id=${linkId(uri)};${uri}`;
			copied = uriEnd;
		}
		openAt = data.indexOf(OSC8_OPEN, uriStart);
	}
	if (copied === 0) return data;
	return result + data.slice(copied);
}

/**
 * Rewrite TUI terminal writes so wrapped links share one hyperlink id.
 * Unknown terminal shapes install nothing and keep Pi's native output.
 */
export function installOsc8LinkIds(tui: TUI): (() => void) | undefined {
	const terminal = (tui as TerminalTui).terminal;
	if (!terminal || typeof terminal.write !== "function") return undefined;
	if (terminal[INSTALLED]) return terminal[INSTALLED];

	const hadOwnMethod = Object.hasOwn(terminal, "write");
	const original = terminal.write;
	const wrapped = function (this: TerminalWriter, data: string) {
		return original.call(
			this,
			typeof data === "string" ? tagAnonymousOsc8Links(data) : data,
		);
	};
	terminal.write = wrapped;

	const dispose = () => {
		if (terminal.write !== wrapped) return;
		if (hadOwnMethod) terminal.write = original;
		else delete (terminal as { write?: unknown }).write;
		delete terminal[INSTALLED];
	};
	terminal[INSTALLED] = dispose;
	return dispose;
}
