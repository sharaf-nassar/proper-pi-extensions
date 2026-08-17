import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type TUI,
	stripTerminalSequences,
} from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-customs.footer-colors");
const PURPLE = [192, 132, 252] as const;
const RAINBOW = [
	[255, 95, 175],
	[255, 215, 95],
	[95, 215, 255],
	[175, 135, 255],
	[95, 215, 135],
] as const;
const ANIMATION_INTERVAL_MS = 120;
const HIGHLIGHT_CYCLE_MS = 4000;

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
			footer.render = render;
			if (dispose) footer.dispose = dispose;
			else delete footer.dispose;
			delete footer[INSTALLED];
		},
	};
	footer.render = (width: number) => {
		const level = state.ctx.thinkingLevel as FooterThinkingLevel;
		if (level === "max" || level === "ultra") startAnimation();
		else stopAnimation();
		return colorFooter(render.call(footer, width), {
			level,
			model: state.ctx.model?.id,
			now: Date.now(),
			theme: state.ctx.ui.theme,
		});
	};
	footer.dispose = () => {
		controller.uninstall();
		dispose?.call(footer);
	};
	footer[INSTALLED] = controller;
	return controller.uninstall;
}

function colorFooter(
	lines: string[],
	{ level, model, now, theme }: FooterColorState,
): string[] {
	if (!model) return lines;
	const index = lines.findIndex((line) =>
		stripTerminalSequences(line).includes(model),
	);
	if (index < 0) return lines;

	const result = [...lines];
	let line = result[index] ?? "";
	line = line.replace(model, emphasize(rgb(PURPLE, model), theme));
	if (level) {
		const label = level === "off" ? "thinking off" : level;
		const styled =
			level === "max" || level === "ultra"
				? rainbowHighlight(label, now)
				: theme.fg(thinkingColor(level), label);
		line = replaceLast(line, label, emphasize(styled, theme));
	}
	result[index] = line;
	return result;
}

function thinkingColor(
	level: Exclude<FooterThinkingLevel, undefined | "max" | "ultra">,
) {
	switch (level) {
		case "off":
			return "thinkingOff" as const;
		case "minimal":
			return "thinkingMinimal" as const;
		case "low":
			return "thinkingLow" as const;
		case "medium":
			return "thinkingMedium" as const;
		case "high":
			return "thinkingHigh" as const;
		case "xhigh":
			return "thinkingXhigh" as const;
		default:
			return "thinkingOff" as const;
	}
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
