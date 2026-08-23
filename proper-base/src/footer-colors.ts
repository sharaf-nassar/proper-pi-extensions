import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	sliceByColumn,
	stripTerminalSequences,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.footer-colors");
const FIELD_COLORS = {
	path: [137, 152, 163],
	branch: [134, 165, 128],
	input: [111, 159, 190],
	output: [126, 174, 132],
	cacheRead: [153, 143, 196],
	cacheWrite: [194, 143, 114],
	cacheHit: [115, 176, 160],
	cost: [202, 165, 103],
	context: [181, 143, 168],
	contextWarning: [213, 160, 84],
	contextDanger: [218, 122, 122],
	model: [192, 132, 252],
} as const;
const RAINBOW = [
	[255, 95, 175],
	[255, 215, 95],
	[95, 215, 255],
	[175, 135, 255],
	[95, 215, 135],
] as const;
const ANIMATION_INTERVAL_MS = 120;
const HIGHLIGHT_CYCLE_MS = 4000;
const USAGE_THROUGH_COST =
	/^((?:(?:↑|↓|R|W|CH)\S+\s+)*\$\S+(?:\s+\(sub\))?)(?:\s+|$)/;
const USAGE_FIELD =
	/(?:^|\s)(CH\S+|↑\S+|↓\S+|R\S+|W\S+|\$\S+(?:\s+\(sub\))?)(?=\s|$)/g;
const CONTEXT_FIELD = /(?:\d+(?:\.\d+)?%|\?)\/\S+(?:\s+\(auto\))?/;

type FooterTheme = ExtensionContext["ui"]["theme"];
type FooterState = {
	ctx: ExtensionContext;
	tui: TUI;
};
type FooterController = {
	update(state: FooterState): void;
	uninstall(): void;
};
type DecoratedFooter = Component & {
	dispose?: () => void;
	[INSTALLED]?: FooterController;
};
type ComponentWithChildren = Component & { children?: Component[] };
type FooterThinkingLevel = ExtensionContext["thinkingLevel"] | "ultra";
type FooterColorState = {
	level: FooterThinkingLevel;
	model: string | undefined;
	now: number;
	theme: FooterTheme;
};

export function installFooterColors(
	tui: TUI,
	ctx: ExtensionContext,
): (() => void) | undefined {
	const footer = findFooter(tui);
	if (!footer) return undefined;

	const existing = footer[INSTALLED];
	if (existing) {
		existing.update({ ctx, tui });
		return existing.uninstall;
	}

	let state = { ctx, tui };
	let timer: ReturnType<typeof setInterval> | undefined;
	const ownsRender = Object.hasOwn(footer, "render");
	const render = footer.render;
	const dispose = footer.dispose;
	const stopAnimation = () => {
		if (!timer) return;
		clearInterval(timer);
		timer = undefined;
	};
	const startAnimation = () => {
		if (timer) return;
		timer = setInterval(() => {
			if (!isMounted(state.tui, footer)) {
				stopAnimation();
				return;
			}
			state.tui.requestRender();
		}, ANIMATION_INTERVAL_MS);
		timer.unref?.();
	};

	const controller: FooterController = {
		update(next) {
			state = next;
		},
		uninstall() {
			if (footer[INSTALLED] !== controller) return;
			stopAnimation();
			if (ownsRender) footer.render = render;
			else Reflect.deleteProperty(footer, "render");
			if (dispose) footer.dispose = dispose;
			else delete footer.dispose;
			delete footer[INSTALLED];
		},
	};
	footer.render = (width: number) => {
		const level = state.ctx.thinkingLevel as FooterThinkingLevel;
		if (level === "max" || level === "ultra") startAnimation();
		else stopAnimation();
		const theme = state.ctx.ui.theme;
		return colorFooter(
			layoutFooter(render.call(footer, width), width, theme, (wide) =>
				render.call(footer, wide),
			),
			{
				level,
				model: state.ctx.model?.id,
				now: Date.now(),
				theme,
			},
		);
	};
	footer.dispose = () => {
		controller.uninstall();
		dispose?.call(footer);
	};
	footer[INSTALLED] = controller;
	return controller.uninstall;
}

function layoutFooter(
	lines: string[],
	width: number,
	theme: FooterTheme,
	reRender?: (width: number) => string[],
): string[] {
	if (lines.length < 2 || !Number.isFinite(width) || width < 20) return lines;

	let statsLine = lines[1];
	if (!statsLine) return lines;
	let match = stripTerminalSequences(statsLine).match(USAGE_THROUGH_COST);
	const usage = match?.[1];
	if (!match || !usage) return lines;

	const contentWidth = width - 1;
	const usageWidth = visibleWidth(usage);
	const availablePathWidth = contentWidth - usageWidth - 1;
	if (availablePathWidth < 8) return lines;

	// Pi right-aligns the model segment against the original width and cuts
	// its tail (thinking level, fast, paused) with no ellipsis when the
	// one-line stats row overflows. This layout frees exactly the usage
	// block's columns, so re-render at that width to recover the cut tags.
	if (reRender) {
		const wide = reRender(width + usageWidth);
		const wideStats = wide[1] ?? "";
		const wideMatch =
			stripTerminalSequences(wideStats).match(USAGE_THROUGH_COST);
		if (wideMatch?.[1] === usage) {
			lines = wide;
			statsLine = wideStats;
			match = wideMatch;
		}
	}

	const result = [...lines];
	const path = truncateToWidth(
		result[0] ?? "",
		availablePathWidth,
		theme.fg("dim", "..."),
	);
	const topPadding = " ".repeat(
		Math.max(1, contentWidth - visibleWidth(path) - usageWidth),
	);
	result[0] = `${path}${topPadding}${theme.fg("dim", usage)}`;

	const consumed = visibleWidth(match[0]);
	const remainder = sliceByColumn(
		statsLine,
		consumed,
		Math.max(0, visibleWidth(statsLine) - consumed),
		true,
	);
	result[1] = realignFooterRemainder(remainder, contentWidth, theme);
	for (let index = 2; index < result.length; index++) {
		result[index] = truncateToWidth(
			result[index] ?? "",
			width,
			theme.fg("dim", "..."),
		);
	}
	return result;
}

function realignFooterRemainder(
	line: string,
	width: number,
	theme: FooterTheme,
): string {
	const plain = stripTerminalSequences(line);
	const gaps = [...plain.matchAll(/ {2,}/g)];
	const gap = gaps.at(-1);
	if (!gap || gap.index === undefined) {
		return truncateToWidth(line, width, theme.fg("dim", "..."));
	}

	const rightStart = gap.index + gap[0].length;
	const left = sliceByColumn(line, 0, gap.index, true);
	const right = sliceByColumn(
		line,
		rightStart,
		Math.max(0, visibleWidth(line) - rightStart),
		true,
	);
	const padding = " ".repeat(
		Math.max(2, width - visibleWidth(left) - visibleWidth(right)),
	);
	return truncateToWidth(
		`${left}${padding}${right}`,
		width,
		theme.fg("dim", "..."),
	);
}

function colorFooter(
	lines: string[],
	{ level, model, now, theme }: FooterColorState,
): string[] {
	const result = [...lines];
	if (result[0]) result[0] = colorPathAndUsage(result[0], theme);
	if (result[1]) result[1] = colorUsageAndContext(result[1], theme);

	if (!model) return result;
	const index = result.findIndex((line) =>
		stripTerminalSequences(line).includes(model),
	);
	if (index < 0) return result;

	let line = result[index] ?? "";
	line = line.replace(model, paintField(model, FIELD_COLORS.model, theme));
	if (level) {
		const label = level === "off" ? "thinking off" : level;
		const styled =
			level === "max" || level === "ultra"
				? rainbowHighlight(label, now)
				: theme.getThinkingBorderColor(level)(label);
		line = replaceLast(line, label, emphasize(styled, theme));
	}
	result[index] = line;
	return result;
}

function colorPathAndUsage(line: string, theme: FooterTheme): string {
	const plain = stripTerminalSequences(line);
	const usageStart = usageFields(plain)[0]?.index ?? -1;
	const pathArea = (
		usageStart < 0 ? plain : plain.slice(0, usageStart)
	).trimEnd();
	const pathMatch = pathArea.match(/^(.*?)(?:\s+(\([^()]+\)))?(?:\s+•\s+.*)?$/);
	let colored = line;
	const path = pathMatch?.[1]?.trimEnd();
	const branch = pathMatch?.[2];
	if (path)
		colored = colored.replace(path, paintField(path, FIELD_COLORS.path, theme));
	if (branch) {
		colored = colored.replace(
			branch,
			paintField(branch, FIELD_COLORS.branch, theme),
		);
	}
	return colorUsage(colored, theme);
}

function colorUsageAndContext(line: string, theme: FooterTheme): string {
	let colored = colorUsage(line, theme);
	const context = stripTerminalSequences(colored).match(CONTEXT_FIELD)?.[0];
	if (context) {
		colored = colored.replace(
			context,
			paintField(context, contextColor(context), theme),
		);
	}
	return colored;
}

function colorUsage(line: string, theme: FooterTheme): string {
	let colored = line;
	for (const { value } of usageFields(stripTerminalSequences(line))) {
		colored = colored.replace(
			value,
			paintField(value, usageColor(value), theme),
		);
	}
	return colored;
}

function usageFields(line: string): Array<{ value: string; index: number }> {
	return [...line.matchAll(USAGE_FIELD)].flatMap((match) => {
		const value = match[1];
		if (!value) return [];
		return [
			{ value, index: (match.index ?? 0) + match[0].length - value.length },
		];
	});
}

function usageColor(field: string): readonly [number, number, number] {
	if (field.startsWith("↑")) return FIELD_COLORS.input;
	if (field.startsWith("↓")) return FIELD_COLORS.output;
	if (field.startsWith("CH")) return FIELD_COLORS.cacheHit;
	if (field.startsWith("R")) return FIELD_COLORS.cacheRead;
	if (field.startsWith("W")) return FIELD_COLORS.cacheWrite;
	return FIELD_COLORS.cost;
}

function contextColor(context: string): readonly [number, number, number] {
	const percent = Number.parseFloat(context);
	if (percent > 90) return FIELD_COLORS.contextDanger;
	if (percent > 70) return FIELD_COLORS.contextWarning;
	return FIELD_COLORS.context;
}

function paintField(
	text: string,
	color: readonly [number, number, number],
	theme: FooterTheme,
): string {
	return emphasize(rgb(color, text), theme);
}

function rainbowHighlight(text: string, now: number): string {
	const characters = [...text];
	const travel = characters.length + 4;
	const highlight =
		((now % HIGHLIGHT_CYCLE_MS) / HIGHLIGHT_CYCLE_MS) * travel - 2;
	return characters
		.map((character, index) => {
			const base = RAINBOW[index % RAINBOW.length] ?? RAINBOW[0];
			const strength = Math.max(0, 1 - Math.abs(index - highlight) / 1.15);
			const color = base.map((channel: number) =>
				Math.round(channel + (255 - channel) * strength * 0.9),
			) as unknown as readonly [number, number, number];
			const bold = strength > 0.6;
			return `${bold ? "\x1b[1m" : ""}${rgb(color, character)}${
				bold ? "\x1b[22m" : ""
			}`;
		})
		.join("");
}

function rgb(color: readonly [number, number, number], text: string): string {
	return `\x1b[38;2;${color.join(";")}m${text}\x1b[39m`;
}

function emphasize(text: string, theme: FooterTheme): string {
	return `${text}${theme.getFgAnsi("dim")}`;
}

function replaceLast(
	text: string,
	search: string,
	replacement: string,
): string {
	const index = text.lastIndexOf(search);
	if (index < 0) return text;
	return `${text.slice(0, index)}${replacement}${text.slice(index + search.length)}`;
}

function findFooter(tui: TUI): DecoratedFooter | undefined {
	for (const root of roots(tui)) {
		const footer = find(
			root,
			(component) =>
				(component as { constructor?: { name?: string } }).constructor?.name ===
				"FooterComponent",
		);
		if (footer) return footer as DecoratedFooter;
	}
	return undefined;
}

function isMounted(tui: TUI, target: Component): boolean {
	return roots(tui).some((root) =>
		find(root, (component) => component === target),
	);
}

function find(
	root: Component,
	matches: (component: Component) => boolean,
): Component | undefined {
	if (matches(root)) return root;
	for (const child of childrenOf(root)) {
		const match = find(child, matches);
		if (match) return match;
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
