import {
	stripTerminalSequences,
	type TUI,
	visibleWidth,
} from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.smart-selection");
const QUOTES = new Set(['"', "'", "`"]);
const WRAPPER_PAIRS = new Map([
	["(", ")"],
	["[", "]"],
	["{", "}"],
	["<", ">"],
]);
const TRAILING_PUNCTUATION = new Set([".", ",", ";", "!", "?"]);

type SelectionPoint = {
	row: number;
	col: number;
	scrollView?: unknown;
	boundary?: boolean;
};

type SelectionRange = {
	start: SelectionPoint;
	end: SelectionPoint;
};

type SelectionTui = TUI & {
	getSelectionSourceLine?(point: SelectionPoint): string;
	getWordSelection?(point: SelectionPoint): SelectionRange | undefined;
	[INSTALLED]?: () => void;
};

export type SmartSelectionRange = { start: number; end: number };

function columns(
	line: string,
	startIndex: number,
	endIndex: number,
): SmartSelectionRange {
	return {
		start: visibleWidth(line.slice(0, startIndex)),
		end: visibleWidth(line.slice(0, endIndex)),
	};
}

function contains(range: SmartSelectionRange, column: number): boolean {
	return column >= range.start && column < range.end;
}

function quotedRange(
	line: string,
	column: number,
): SmartSelectionRange | undefined {
	for (let start = 0; start < line.length; start++) {
		const quote = line[start];
		if (!quote || !QUOTES.has(quote)) continue;
		for (let end = start + 1; end < line.length; end++) {
			if (line[end] === "\\") {
				end++;
				continue;
			}
			if (line[end] !== quote) continue;
			const range = columns(line, start, end + 1);
			if (contains(range, column)) return range;
			start = end;
			break;
		}
	}
	return undefined;
}

function trimToken(line: string, start: number, end: number): [number, number] {
	while (
		start < end &&
		WRAPPER_PAIRS.get(line[start] ?? "") === line[end - 1]
	) {
		start++;
		end--;
	}
	while (start < end && WRAPPER_PAIRS.has(line[start] ?? "")) start++;
	while (start < end && TRAILING_PUNCTUATION.has(line[end - 1] ?? "")) end--;
	for (const [open, close] of WRAPPER_PAIRS) {
		while (line[end - 1] === close) {
			const token = line.slice(start, end);
			if (token.split(close).length <= token.split(open).length) break;
			end--;
		}
	}
	return [start, end];
}

function isSmartToken(token: string): boolean {
	if (/^(?:https?|file):\/\/\S+$/iu.test(token) || /^www\.\S+$/iu.test(token))
		return true;
	if (/^--?[A-Za-z0-9][\w.-]*(?:=\S+)?$/u.test(token)) return true;
	if (/^\d+[\\/]\d+$/u.test(token)) return false;
	if (
		/^(?:~[\\/]|\.{0,2}[\\/]|[A-Za-z]:[\\/])\S+$/u.test(token) ||
		/^[\w@.-]+(?:[\\/][\w@.+~:#%=-]+)+(?::\d+(?::\d+)?)?$/u.test(token)
	)
		return true;
	return /^[A-Za-z_$][\w$-]*(?:(?:::|->|\.)[A-Za-z_$][\w$-]*)+$/u.test(token);
}

export function findSmartSelectionRange(
	line: string,
	column: number,
): SmartSelectionRange | undefined {
	const plain = stripTerminalSequences(line);
	const quoted = quotedRange(plain, column);
	if (quoted) return quoted;

	for (const match of plain.matchAll(/\S+/gu)) {
		const value = match[0];
		const rawStart = match.index;
		let [start, end] = trimToken(plain, rawStart, rawStart + value.length);
		while (start < end && QUOTES.has(plain[start] ?? "")) start++;
		while (start < end && QUOTES.has(plain[end - 1] ?? "")) end--;
		const range = columns(plain, start, end);
		if (contains(range, column) && isSmartToken(plain.slice(start, end))) {
			return range;
		}
	}
	return undefined;
}

/**
 * Extend Pi's native fullscreen word selection without replacing its click,
 * drag, highlight, viewport, or clipboard behavior. Unknown renderer shapes and
 * unrecognized text keep Pi's native selection unchanged.
 */
export function installSmartSelection(tui: TUI): (() => void) | undefined {
	const host = tui as SelectionTui;
	if (host[INSTALLED]) return host[INSTALLED];
	if (!host.getWordSelection || !host.getSelectionSourceLine) return undefined;

	const hadOwnMethod = Object.hasOwn(host, "getWordSelection");
	const original = host.getWordSelection;
	const wrapped = (point: SelectionPoint): SelectionRange | undefined => {
		if (point.scrollView) {
			const range = findSmartSelectionRange(
				host.getSelectionSourceLine?.(point) ?? "",
				point.col,
			);
			if (range) {
				return {
					start: { ...point, col: range.start },
					end: { ...point, col: range.end, boundary: true },
				};
			}
		}
		return original.call(host, point);
	};
	host.getWordSelection = wrapped;

	const dispose = () => {
		if (host.getWordSelection !== wrapped) return;
		if (hadOwnMethod) host.getWordSelection = original;
		else delete host.getWordSelection;
		delete host[INSTALLED];
	};
	host[INSTALLED] = dispose;
	return dispose;
}
