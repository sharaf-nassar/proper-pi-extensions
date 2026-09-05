import {
	type AutocompleteItem,
	type AutocompleteProvider,
	type AutocompleteSuggestions,
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

/**
 * One collator for the `/model` sort. `localeCompare` with an options object
 * constructs a collator per call, which the per-keystroke sort would pay
 * hundreds of times per keypress.
 */
const MODEL_ORDER = new Intl.Collator("en", {
	numeric: true,
	sensitivity: "base",
});

/**
 * Pi's thinking levels, weakest first. The extension API exports neither the
 * list nor the per-model subset, and Pi clamps an unsupported level when it
 * applies one, so restating the full list here costs nothing.
 */
const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export type ThinkingArgument = (typeof THINKING_LEVELS)[number];

/**
 * `/model <provider>/<id> <level>` before the cursor.
 *
 * The first argument must carry a provider slash, the exact shape a model
 * completion produces, so a multi-term model search such as `/model opus 4`
 * keeps filtering models instead of being read as a level.
 */
const MODEL_THINKING_ARGUMENT = /^\/model\s+(\S*\/\S*)\s+(\S*)$/;

/** Level suggestions for a second `/model` argument, or nothing for any other shape. */
function thinkingSuggestions(
	activeLine: string,
	current: string | undefined,
): AutocompleteSuggestions | undefined {
	const prefix = MODEL_THINKING_ARGUMENT.exec(activeLine)?.[2];
	if (prefix === undefined) return undefined;
	const query = prefix.toLowerCase();
	const matches = THINKING_LEVELS.filter((level) => level.startsWith(query));
	// The level already in effect leads the list, so accepting the menu's
	// default selection keeps the current level instead of the weakest one.
	const items: AutocompleteItem[] = [
		...matches.filter((level) => level === current),
		...matches.filter((level) => level !== current),
	].map((level) => ({ value: level, label: level }));
	return items.length > 0 ? { items, prefix } : undefined;
}

/**
 * A submitted `/model <reference> <level>`, if that is the shape.
 *
 * Pi's own `/model` treats everything after the command as one model search
 * term, so the extra argument has to be split off before Pi ever sees it.
 */
export function modelThinkingCommand(
	text: string,
): { reference: string; level: ThinkingArgument } | undefined {
	const match = /^\/model\s+(\S+)\s+(\S+)$/.exec(text.trim());
	const reference = match?.[1];
	const level = THINKING_LEVELS.find(
		(candidate) => candidate === match?.[2]?.toLowerCase(),
	);
	return reference && level ? { reference, level } : undefined;
}

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
	updateAutocomplete?(): void;
	[INLINE_SLASH_INSTALLED]?: boolean;
};

type ModelAutocompleteEditor = Component & {
	autocompleteList?: {
		getSelectedItem(): { value?: string } | null;
	};
	getText?(): string;
	handleInput?(data: string): void;
	tryTriggerAutocomplete?(): void;
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
		const wasShowing = target.isShowingAutocomplete?.() === true;
		const before = wasShowing ? target.state?.lines.join("\n") : undefined;
		handleInput(data);
		const state = target.state;
		if (!state) return;
		if (target.isShowingAutocomplete?.()) {
			// Word and line deletes (alt+backspace, ctrl+w/u/k) edit the prompt
			// without the autocomplete refresh pi's insert and backspace paths
			// run, so an open list lingers under stale text. Re-request with
			// the current prompt; an emptied context closes the list through
			// the editor's own no-suggestions path. Single printable keys and
			// backspace already refreshed inside the editor.
			if (
				wasShowing &&
				state.lines.join("\n") !== before &&
				!(data.length === 1 && data >= " ")
			) {
				target.updateAutocomplete?.();
			}
			return;
		}
		if (wasShowing) {
			// Accepting a command completion closes the list and leaves
			// "/command " behind, but pi re-opens suggestions only from typed
			// characters, so an accepted command's argument menu — /model's
			// list — stayed hidden until another keystroke. A text change
			// during the open-to-closed transition is what separates
			// acceptance from dismissal: Esc leaves the prompt untouched and
			// must not reopen the list just closed. The token shape keeps a
			// completed file path from popping a menu of its own.
			const beforeCursor = (state.lines[state.cursorLine] ?? "").slice(
				0,
				state.cursorCol,
			);
			if (
				state.lines.join("\n") !== before &&
				/(?:^|\s)\/[a-zA-Z0-9._:-]+ $/.test(beforeCursor)
			) {
				target.tryTriggerAutocomplete?.();
			}
			return;
		}
		if (!/^[/a-zA-Z0-9._:-]$/.test(data)) return;
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
	thinkingLevel?: () => string | undefined,
): AutocompleteProvider {
	return {
		...(current.triggerCharacters
			? { triggerCharacters: current.triggerCharacters }
			: {}),
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const inline = inlineSlashContext(lines, cursorLine, cursorCol);
			const activeLine =
				inline?.prefix ?? (lines[cursorLine] ?? "").slice(0, cursorCol);
			// Checked before delegating so an explicit Tab, which asks Pi for
			// forced file completion once the argument holds a space, still lists
			// levels rather than paths.
			const thinking = thinkingSuggestions(activeLine, thinkingLevel?.());
			if (thinking) return thinking;
			const requestLines = inline ? [...lines] : lines;
			if (inline) requestLines[cursorLine] = inline.prefix;
			const suggestions = await current.getSuggestions(
				requestLines,
				cursorLine,
				inline ? inline.prefix.length : cursorCol,
				inline ? { ...options, force: false } : options,
			);
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
						MODEL_ORDER.compare(b.label, a.label) ||
						b.value.localeCompare(a.value),
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

/** Whether an accepted completion left a runnable `/model` command behind. */
function completedModelCommand(text: string, value: string): boolean {
	if (!/^\/model [^\n]*$/.test(text)) return false;
	const argument = text.slice("/model ".length);
	return argument === value || argument.endsWith(` ${value}`);
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
	const openThinkingMenu = () => {
		if (
			target.autocompleteList === undefined &&
			MODEL_THINKING_ARGUMENT.test(target.getText?.() ?? "")
		) {
			target.tryTriggerAutocomplete?.();
		}
	};
	target.handleInput = (data: string) => {
		const selectedValue = target.autocompleteList?.getSelectedItem()?.value;
		const accepted =
			typeof selectedValue === "string" &&
			/^\/model [^\n]*$/.test(target.getText?.() ?? "")
				? selectedValue
				: undefined;
		const confirm = keybindings.matches(data, "tui.select.confirm");
		const tab = keybindings.matches(data, "tui.input.tab");

		handleInput(data);
		// Pi reopens suggestions only from typed characters, and the separator
		// before a thinking level is a space, which is not one of them.
		if (data === " ") {
			openThinkingMenu();
			return;
		}
		if (
			accepted === undefined ||
			target.autocompleteList !== undefined ||
			!completedModelCommand(target.getText?.() ?? "", accepted)
		) {
			return;
		}
		// Tab stops at the model name so a level can follow, and Pi's argument
		// completion appends no separator, so the space and the menu it cannot
		// trigger on its own are supplied here. Tab on the level itself has
		// nothing left to complete, so it submits like Enter.
		if (tab && accepted.includes("/")) {
			handleInput(" ");
			openThinkingMenu();
		} else if (confirm || tab) {
			handleInput("\r");
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
		// rowsBelow re-renders every component below the editor, so frames
		// without a selected description skip the measurement entirely.
		const description = target.autocompleteList?.getSelectedItem()?.description;
		if (!description) {
			detail.setDescription(undefined, 0);
			releaseOverlay();
			return lines;
		}
		margin.bottom = lines.length + rowsBelow(tui, target, width);
		detail.setDescription(
			description,
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
