import {
	type Component,
	sliceByColumn,
	stripTerminalSequences,
	type TUI,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.clipboard-selection");
type Point = {
	row: number;
	col: number;
	scrollView?: Component;
	boundary?: boolean;
};
type Bounds = { start: Point; end: Point };
type Row = {
	source: string;
	offset: number;
	end: number;
	column: number;
	group: object;
	skip: number;
};
type Token = { type: string };
type MarkdownHost = Component & {
	text: string;
	paddingX: number;
	paddingY: number;
	theme: { codeBlockIndent?: string };
	cachedLines?: string[];
	blocks?: unknown;
	renderToken(token: Token, width: number, ...rest: unknown[]): string[];
};
type Layout = {
	children: Layout[];
	scrollView?: Component;
	scrollContentLines?: readonly string[];
	rect: { width: number };
};
type Host = TUI & {
	currentLayout?: { root?: Layout };
	getActiveSelectionText?(): string | undefined;
	getSelectionBounds?(): Bounds | undefined;
	getSelectionColumns?(
		line: string,
		row: number,
		bounds: Bounds,
	): { start: number; end: number };
	[INSTALLED]?: () => void;
};

function plain(line: string): string {
	return stripTerminalSequences(line).trimEnd();
}

/** Map native wrapping back to the logical line, including spaces lost at wraps. */
function wrappedRows(
	line: string,
	width: number,
	skip: number,
): { lines: string[]; rows: Row[] } | undefined {
	const source = stripTerminalSequences(line);
	const lines = wrapTextWithAnsi(line, width).map(plain);
	const group = {};
	const rows: Row[] = [];
	let offset = 0;
	for (const fragment of lines) {
		let start = offset;
		while (!source.startsWith(fragment, start) && source[start] === " ")
			start++;
		if (!source.startsWith(fragment, start)) return undefined;
		rows.push({
			source,
			offset: start,
			end: start + fragment.length,
			column: 0,
			group,
			skip,
		});
		offset = start + fragment.length;
	}
	return { lines, rows };
}

/**
 * Replay only a Markdown clone. Its native token renderer supplies the logical
 * lines and wrapping widths; the live component and terminal output stay intact.
 */
function markdownRows(component: MarkdownHost, width: number) {
	const clone = Object.assign(
		Object.create(Object.getPrototypeOf(component)),
		component,
	) as MarkdownHost;
	delete clone.cachedLines;
	// Pi 1.5.0 reuses rendered blocks across renders; drop them so every token replays.
	delete clone.blocks;
	const renderToken = component.renderToken;
	const rows = new Map<number, Row>();
	let depth = 0;
	let blocked = 0;
	let rowOffset = component.paddingY;
	let groups: Array<{ lines: string[]; rows: Row[] }> = [];
	clone.renderToken = function (token, tokenWidth, ...rest) {
		const outer = depth++ === 0;
		if (outer) groups = [];
		const unsupported = ![
			"blockquote",
			"paragraph",
			"text",
			"code",
			"space",
		].includes(token.type);
		if (unsupported) blocked++;
		const lines = renderToken.call(this, token, tokenWidth, ...rest);
		if (!blocked && token.type !== "blockquote") {
			const indent = stripTerminalSequences(
				this.theme.codeBlockIndent ?? "  ",
			).length;
			for (const [index, line] of lines.entries()) {
				// Code fences are display framing, not source code.
				if (token.type === "code" && (index === 0 || plain(line) === "```"))
					continue;
				for (const logical of line.split(/\r\n|\r|\n/u)) {
					const group = wrappedRows(
						logical,
						tokenWidth,
						token.type === "code" ? indent : 0,
					);
					if (group) groups.push(group);
				}
			}
		}
		if (unsupported) blocked--;
		depth--;
		if (outer) {
			const rendered = lines
				.flatMap((line) => wrapTextWithAnsi(line, tokenWidth))
				.map(plain);
			let cursor = 0;
			for (const group of groups) {
				for (
					let start = cursor;
					start <= rendered.length - group.lines.length;
					start++
				) {
					const prefixes = group.lines.map((fragment, index) => {
						const line = rendered[start + index] ?? "";
						if (!line.endsWith(fragment)) return undefined;
						const prefix = line.slice(0, line.length - fragment.length);
						return /^[ │]*$/u.test(prefix) ? prefix : undefined;
					});
					if (prefixes.some((prefix) => prefix === undefined)) continue;
					for (const [index, row] of group.rows.entries()) {
						rows.set(rowOffset + start + index, {
							...row,
							column: component.paddingX + visibleWidth(prefixes[index] ?? ""),
						});
					}
					cursor = start + group.lines.length;
					break;
				}
			}
			rowOffset += rendered.length;
		}
		return lines;
	};
	return { lines: clone.render(width).map(plain), rows };
}

function findScrollBox(box: Layout, scrollView: Component): Layout | undefined {
	if (box.scrollView === scrollView) return box;
	for (const child of box.children ?? []) {
		const found = findScrollBox(child, scrollView);
		if (found) return found;
	}
	return undefined;
}

function selectionRows(
	root: Component,
	width: number,
	source: readonly string[],
	bounds: Bounds,
): Map<number, Row> {
	const result = new Map<number, Row>();
	const ambiguous = new Set<number>();
	const sourceLines = source.map(plain);
	function visit(component: Component, available: number, padding: number) {
		const candidate = component as Partial<MarkdownHost> & {
			children?: Component[];
		};
		if (
			typeof candidate.renderToken === "function" &&
			typeof candidate.text === "string" &&
			typeof candidate.paddingX === "number" &&
			typeof candidate.paddingY === "number" &&
			candidate.theme
		) {
			const mapped = markdownRows(candidate as MarkdownHost, available);
			if (!mapped.lines.some((line) => line.trim())) return;
			const lines = mapped.lines.map((line) =>
				(" ".repeat(padding) + line).trimEnd(),
			);
			for (
				let start = Math.max(0, bounds.start.row - lines.length + 1);
				start <= bounds.end.row;
				start++
			) {
				if (!lines.every((line, index) => sourceLines[start + index] === line))
					continue;
				for (const [index, row] of mapped.rows) {
					const target = start + index;
					if (result.has(target)) ambiguous.add(target);
					result.set(target, { ...row, column: row.column + padding });
				}
			}
			return;
		}
		const inset =
			typeof candidate.paddingX === "number" ? candidate.paddingX : 0;
		for (const child of candidate.children ?? [])
			visit(child, Math.max(1, available - inset * 2), padding + inset);
	}
	// ponytail: scan Markdown on copy only; add a render-time source map if large transcripts make copying slow.
	visit(root, width, 0);
	for (const row of ambiguous) result.delete(row);
	return result;
}

/** @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Clipboard selection cleanup]] */
export function installClipboardSelection(tui: TUI): (() => void) | undefined {
	const host = tui as Host;
	if (
		typeof host.getActiveSelectionText !== "function" ||
		typeof host.getSelectionBounds !== "function" ||
		typeof host.getSelectionColumns !== "function"
	)
		return undefined;
	host[INSTALLED]?.();
	const original = host.getActiveSelectionText;
	const own = Object.hasOwn(host, "getActiveSelectionText");
	const wrapped = () => {
		const native = original.call(host);
		const bounds = host.getSelectionBounds?.();
		if (!native || !bounds?.start.scrollView || !host.currentLayout?.root)
			return native;
		const scrollView = bounds.start.scrollView;
		const box = findScrollBox(host.currentLayout.root, scrollView);
		if (!box?.scrollContentLines) return native;
		const getWidth = (
			scrollView as Component & { getContentWidth?(width: number): number }
		).getContentWidth;
		if (typeof getWidth !== "function") return native;
		const rows = selectionRows(
			scrollView,
			getWidth.call(scrollView, box.rect.width),
			box.scrollContentLines,
			bounds,
		);
		if (rows.size === 0) return native;
		let text = "";
		let previous: { row: Row; end: number } | undefined;
		for (let index = bounds.start.row; index <= bounds.end.row; index++) {
			const line = box.scrollContentLines[index] ?? "";
			const columns = host.getSelectionColumns?.(line, index, bounds);
			if (!columns) return native;
			const row = rows.get(index);
			if (!row) {
				text +=
					(index === bounds.start.row ? "" : "\n") +
					plain(
						sliceByColumn(
							line,
							columns.start,
							Math.max(0, columns.end - columns.start),
							true,
						),
					);
				previous = undefined;
				continue;
			}
			const fragment = row.source.slice(row.offset, row.end);
			const at = (column: number) =>
				Math.max(
					row.skip,
					row.offset +
						sliceByColumn(fragment, 0, Math.max(0, column - row.column), true)
							.length,
				);
			const start = at(columns.start);
			const end = Math.max(start, at(columns.end));
			if (previous?.row.group === row.group)
				text += row.source.slice(previous.end, start);
			else if (index !== bounds.start.row) text += "\n";
			text += row.source.slice(start, end);
			previous = { row, end };
		}
		return text || undefined;
	};
	host.getActiveSelectionText = wrapped;
	const dispose = () => {
		if (host[INSTALLED] !== dispose) return;
		if (host.getActiveSelectionText === wrapped) {
			if (own) host.getActiveSelectionText = original;
			else delete host.getActiveSelectionText;
		}
		delete host[INSTALLED];
	};
	host[INSTALLED] = dispose;
	return dispose;
}
