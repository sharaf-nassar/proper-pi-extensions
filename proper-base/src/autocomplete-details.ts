import {
	type AutocompleteProvider,
	type Component,
	type OverlayHandle,
	type OverlayMargin,
	type OverlayOptions,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.autocomplete-details");
const MODEL_SUBMIT_INSTALLED = Symbol.for(
	"pi-proper-base.model-autocomplete-submit",
);
const ACTIVE_OVERLAY = Symbol.for("pi-proper-base.autocomplete-overlay");
const INLINE_SLASH_INSTALLED = Symbol.for(
	"pi-proper-base.inline-slash-autocomplete",
);

type AutocompleteEditor = Component & {
	autocompleteList?: {
		getSelectedItem(): { description?: string } | null;
	};
	[INSTALLED]?: boolean;
};

type InlineSlashEditor = Component & {
	state?: {
		lines: string[];
		cursorLine: number;
		cursorCol: number;
	};
	handleInput?(data: string): void;
	isShowingAutocomplete?(): boolean;
	tryTriggerAutocomplete?(): void;
	[INLINE_SLASH_INSTALLED]?: boolean;
};

type ModelAutocompleteEditor = Component & {
	autocompleteList?: {
		getSelectedItem(): { value?: string } | null;
	};
	getText?(): string;
	handleInput?(data: string): void;
	submitValue?(): void;
	[MODEL_SUBMIT_INSTALLED]?: boolean;
};

type EditorKeybindings = {
	matches(data: string, action: string): boolean;
};

type DetailTheme = {
	borderColor(text: string): string;
	selectList: {
		selectedText?(text: string): string;
		description(text: string): string;
	};
};

type OverlayTui = TUI & { [ACTIVE_OVERLAY]?: OverlayHandle };
type ComponentWithChildren = Component & { children?: Component[] };

type InlineSlashContext = {
	prefix: string;
	start: number;
};

function inlineSlashContext(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
): InlineSlashContext | undefined {
	const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
	const match = [...beforeCursor.matchAll(/(?:^|\s)\//g)].at(-1);
	if (!match) return undefined;
	const start = (match.index ?? 0) + match[0].length - 1;
	if (start === 0 && cursorLine === 0) return undefined;
	return { prefix: beforeCursor.slice(start), start };
}

export function installInlineSlashAutocomplete(editor: Component): void {
	const target = editor as InlineSlashEditor;
	if (
		target[INLINE_SLASH_INSTALLED] ||
		!target.handleInput ||
		!target.state ||
		!target.tryTriggerAutocomplete
	) {
		return;
	}

	const handleInput = target.handleInput.bind(target);
	target.handleInput = (data: string) => {
		handleInput(data);
		if (target.isShowingAutocomplete?.() || !/^[/a-zA-Z0-9._:-]$/.test(data)) {
			return;
		}
		const state = target.state;
		if (!state) return;
		if (inlineSlashContext(state.lines, state.cursorLine, state.cursorCol)) {
			target.tryTriggerAutocomplete?.();
		}
	};
	target[INLINE_SLASH_INSTALLED] = true;
}

function createAutocompleteDetailBox(theme: DetailTheme) {
	let description: string | undefined;
	let maxRows = 0;
	const isVisible = () => description !== undefined && maxRows >= 3;

	return {
		isVisible,
		setDescription(next: string | undefined, availableRows: number): void {
			description = next?.replace(/[\r\n]+/g, " ").trim() || undefined;
			maxRows = availableRows;
		},
		component: {
			render(width: number): string[] {
				if (!description || !isVisible() || width < 6) return [];

				const textWidth = width - 4;
				const contentRows = maxRows - 2;
				let lines = wrapTextWithAnsi(description, textWidth);
				if (lines.length > contentRows) {
					lines = lines.slice(0, contentRows);
					const last = lines.at(-1);
					if (last !== undefined) {
						const lastIndex = lines.length - 1;
						lines[lastIndex] = `${truncateToWidth(last, textWidth - 1, "")}…`;
					}
				}

				const border = (text: string) => theme.borderColor(text);
				return [
					border(`┌${"─".repeat(width - 2)}┐`),
					...lines.map(
						(line) =>
							`${border("│")} ${(theme.selectList.selectedText ?? theme.selectList.description)(line)}${" ".repeat(
								Math.max(0, textWidth - visibleWidth(line)),
							)} ${border("│")}`,
					),
					border(`└${"─".repeat(width - 2)}┘`),
				];
			},
			invalidate(): void {},
		} satisfies Component,
	};
}

export function sortModelAutocompleteDescending(
	current: AutocompleteProvider,
): AutocompleteProvider {
	return {
		...(current.triggerCharacters
			? { triggerCharacters: current.triggerCharacters }
			: {}),
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const inline = inlineSlashContext(lines, cursorLine, cursorCol);
			const requestLines = inline ? [...lines] : lines;
			if (inline) requestLines[cursorLine] = inline.prefix;
			const suggestions = await current.getSuggestions(
				requestLines,
				cursorLine,
				inline ? inline.prefix.length : cursorCol,
				inline ? { ...options, force: false } : options,
			);
			const line = lines[cursorLine] ?? "";
			const activeLine = inline?.prefix ?? line.slice(0, cursorCol);
			if (!suggestions || !activeLine.startsWith("/model ")) {
				return suggestions;
			}

			const terms = suggestions.prefix
				.toLowerCase()
				.split(/\s+/)
				.filter(Boolean);
			const strictMatches = suggestions.items.filter((item) => {
				const searchable =
					`${item.label} ${item.value} ${item.description ?? ""}`.toLowerCase();
				return terms.every((term) => searchable.includes(term));
			});
			const items =
				terms.length > 0 && strictMatches.length > 0
					? strictMatches
					: suggestions.items;

			return {
				...suggestions,
				items: [...items].sort(
					(a, b) =>
						b.label.localeCompare(a.label, "en", {
							numeric: true,
							sensitivity: "base",
						}) || b.value.localeCompare(a.value),
				),
			};
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const inline = inlineSlashContext(lines, cursorLine, cursorCol);
			if (!inline) {
				return current.applyCompletion(
					lines,
					cursorLine,
					cursorCol,
					item,
					prefix,
				);
			}
			const completed = current.applyCompletion(
				[inline.prefix],
				0,
				inline.prefix.length,
				item,
				prefix,
			);
			const replacement = completed.lines[0] ?? inline.prefix;
			const next = [...lines];
			const currentLine = lines[cursorLine] ?? "";
			next[cursorLine] =
				currentLine.slice(0, inline.start) +
				replacement +
				currentLine.slice(cursorCol);
			return {
				lines: next,
				cursorLine,
				cursorCol: inline.start + completed.cursorCol,
			};
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return (
				current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ??
				true
			);
		},
	};
}

export function installModelAutocompleteSubmit(
	editor: Component,
	keybindings: EditorKeybindings,
): void {
	const target = editor as ModelAutocompleteEditor;
	if (
		target[MODEL_SUBMIT_INSTALLED] ||
		!target.handleInput ||
		!target.getText
	) {
		return;
	}

	const handleInput = target.handleInput.bind(target);
	target.handleInput = (data: string) => {
		const selected = target.autocompleteList?.getSelectedItem();
		const selectedValue = selected?.value;
		const confirm = keybindings.matches(data, "tui.select.confirm");
		const tab = keybindings.matches(data, "tui.input.tab");
		const shouldSubmit =
			(confirm || tab) &&
			typeof selectedValue === "string" &&
			/^\/model [^\n]*$/.test(target.getText?.() ?? "");

		handleInput(data);
		if (
			shouldSubmit &&
			target.autocompleteList === undefined &&
			target.getText?.() === `/model ${selectedValue}`
		) {
			if (tab) {
				if (target.submitValue) target.submitValue();
				else handleInput("\r");
			} else {
				handleInput(data);
			}
		}
	};
	target[MODEL_SUBMIT_INSTALLED] = true;
}

export function installAutocompleteDetails(
	editor: Component,
	tui: TUI,
	theme: DetailTheme,
): void {
	const target = editor as AutocompleteEditor;
	if (target[INSTALLED]) return;

	const host = tui as OverlayTui;
	host[ACTIVE_OVERLAY]?.hide();

	const detail = createAutocompleteDetailBox(theme);
	const margin: OverlayMargin = { bottom: 0 };
	let overlay: OverlayHandle | undefined;
	const releaseOverlay = () => {
		const active = overlay;
		if (!active) return;
		active.hide();
		overlay = undefined;
		if (host[ACTIVE_OVERLAY] === active) delete host[ACTIVE_OVERLAY];
	};
	const scheduleReleaseOverlay = () => {
		const inactive = overlay;
		if (!inactive) return;
		queueMicrotask(() => {
			if (
				overlay === inactive &&
				(!detail.isVisible() || !isMounted(tui, target))
			) {
				releaseOverlay();
			}
		});
	};
	const options: OverlayOptions = {
		anchor: "bottom-left",
		margin,
		nonCapturing: true,
		width: "100%",
		visible: () => {
			const visible = detail.isVisible() && isMounted(tui, target);
			if (!visible) scheduleReleaseOverlay();
			return visible;
		},
	};
	const ensureOverlay = () => {
		const active = host[ACTIVE_OVERLAY];
		if (overlay !== undefined && active === overlay) return;
		active?.hide();
		overlay = tui.showOverlay(detail.component, options);
		host[ACTIVE_OVERLAY] = overlay;
	};

	const render = target.render.bind(target);
	target.render = (width: number) => {
		const lines = render(width);
		margin.bottom = lines.length + rowsBelow(tui, target, width);
		detail.setDescription(
			target.autocompleteList?.getSelectedItem()?.description,
			Math.max(0, tui.terminal.rows - margin.bottom),
		);
		if (detail.isVisible() && isMounted(tui, target)) ensureOverlay();
		else releaseOverlay();
		return lines;
	};
	target[INSTALLED] = true;
}

export function isMounted(tui: TUI, target: Component): boolean {
	return roots(tui).some((root) => contains(root, target));
}

function contains(root: Component, target: Component): boolean {
	if (root === target) return true;
	return childrenOf(root).some((child) => contains(child, target));
}

export function rowsBelow(tui: TUI, target: Component, width: number): number {
	const mountedRoots = roots(tui);
	for (let index = 0; index < mountedRoots.length; index++) {
		const root = mountedRoots[index];
		if (!root) continue;
		const rows = rowsAfter(root, target, width);
		if (rows === undefined) continue;
		return (
			rows +
			mountedRoots
				.slice(index + 1)
				.reduce((total, root) => total + root.render(width).length, 0)
		);
	}
	return 0;
}

function rowsAfter(
	root: Component,
	target: Component,
	width: number,
): number | undefined {
	if (root === target) return 0;

	const children = childrenOf(root);
	for (let index = 0; index < children.length; index++) {
		const child = children[index];
		if (!child) continue;
		const rows = rowsAfter(child, target, width);
		if (rows === undefined) continue;
		return (
			rows +
			children
				.slice(index + 1)
				.reduce((total, child) => total + child.render(width).length, 0)
		);
	}
	return undefined;
}

function roots(tui: TUI): Component[] {
	const layoutRoot = (tui as TUI & { layoutRoot?: Component }).layoutRoot;
	return layoutRoot ? [layoutRoot] : tui.children;
}

function childrenOf(component: Component): Component[] {
	return (component as ComponentWithChildren).children ?? [];
}
