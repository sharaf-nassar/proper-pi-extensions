import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { stripTerminalSequences } from "@earendil-works/pi-tui";
import properBase from "../index.ts";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";

test("footer layout, colors, and shutdown restoration stay composed", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-footer-"));
	type SessionHandler = (event: unknown, ctx: any) => void | Promise<void>;
	let onSessionStart: SessionHandler | undefined;
	let onSessionShutdown: SessionHandler | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: any) => any)
		| undefined;
	let effort = "low";
	let contextPercent = 55.5;
	let stale = false;

	properBase({
		on(event: string, handler: SessionHandler) {
			if (event === "session_start") onSessionStart = handler;
			if (event === "session_shutdown") onSessionShutdown = handler;
		},
		getCommands: () => [],
	} as any);

	class FooterComponent {
		render(_width?: number) {
			const label = effort === "off" ? "thinking off" : effort;
			return [
				"~/work/scribe (main)",
				`↑10M ↓261K R114M W2M CH99.5% $115.997 ${contextPercent.toFixed(1)}%/1.0M (auto)  gpt-5.6-sol • ${label}`,
			];
		}
		invalidate() {}
		dispose() {}
	}

	const footer = new FooterComponent();
	let renderRequests = 0;
	const editor = {
		onSubmit: undefined,
		addToHistory() {},
		render: () => ["editor"],
	};
	const tui = {
		children: [{ children: [editor] }, { children: [footer] }],
		requestRender() {
			renderRequests++;
		},
		terminal: { rows: 24 },
		showOverlay() {
			return { hide() {} };
		},
	};
	const color = (red: number, green: number, blue: number, text: string) =>
		`\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`;
	const effortColors: Record<string, readonly [number, number, number]> = {
		thinkingOff: [80, 80, 80],
		thinkingMinimal: [110, 110, 110],
		thinkingLow: [95, 135, 175],
		thinkingMedium: [129, 162, 190],
		thinkingHigh: [178, 148, 187],
		thinkingXhigh: [209, 131, 232],
	};
	const theme = {
		fg(name: string, text: string) {
			const value = effortColors[name];
			return value ? color(...value, text) : text;
		},
		getThinkingBorderColor(level: string) {
			const name =
				level === "off"
					? "thinkingOff"
					: `thinking${level[0]?.toUpperCase()}${level.slice(1)}`;
			return (text: string) => this.fg(name, text);
		},
		getFgAnsi: () => "\x1b[38;2;102;102;102m",
	};
	const ctx = {
		cwd,
		get model() {
			if (stale) throw new Error("stale ctx");
			return { id: "gpt-5.6-sol" };
		},
		get thinkingLevel() {
			if (stale) throw new Error("stale ctx");
			return effort;
		},
		sessionManager: {
			getBranch: () => [],
			getSessionFile: () => undefined,
		},
		ui: {
			getEditorComponent: () => () => editor,
			setEditorComponent: (factory: typeof installedFactory) => {
				installedFactory = factory;
			},
			theme,
		},
	};

	try {
		await onSessionStart?.({}, ctx);
		installedFactory?.(
			tui,
			{
				borderColor: (text: string) => text,
				selectList: { description: (text: string) => text },
			},
			new KeybindingsManager(),
		);

		const lowLines = footer.render(100).map(stripTerminalSequences);
		assert.ok(lowLines[0]?.startsWith("~/work/scribe (main)"));
		assert.ok(lowLines[0]?.endsWith("↑10M ↓261K R114M W2M CH99.5% $115.997"));
		assert.equal(lowLines[0]?.length, 99);
		assert.ok(lowLines[1]?.startsWith("55.5%/1.0M (auto)"));
		assert.ok(lowLines[1]?.endsWith("gpt-5.6-sol • low"));
		assert.equal(lowLines[1]?.length, 99);
		assert.equal(lowLines[1]?.includes("$115.997"), false);

		const colored = footer.render(100);
		const usage = colored[0] ?? "";
		const low = colored[1] ?? "";
		assert.ok(usage.includes(color(137, 152, 163, "~/work/scribe")));
		assert.ok(usage.includes(color(134, 165, 128, "(main)")));
		for (const [rgb, value] of [
			[[111, 159, 190], "↑10M"],
			[[126, 174, 132], "↓261K"],
			[[153, 143, 196], "R114M"],
			[[194, 143, 114], "W2M"],
			[[115, 176, 160], "CH99.5%"],
			[[202, 165, 103], "$115.997"],
		] as const) {
			assert.ok(usage.includes(color(rgb[0], rgb[1], rgb[2], value)));
		}
		assert.ok(low.includes(color(181, 143, 168, "55.5%/1.0M (auto)")));
		contextPercent = 75;
		assert.ok(
			footer.render(100)[1]?.includes(color(213, 160, 84, "75.0%/1.0M (auto)")),
		);
		contextPercent = 95;
		assert.ok(
			footer
				.render(100)[1]
				?.includes(color(218, 122, 122, "95.0%/1.0M (auto)")),
		);
		contextPercent = 55.5;
		assert.ok(low.includes("\x1b[38;2;192;132;252mgpt-5.6-sol\x1b[39m"));
		assert.ok(low.includes("\x1b[38;2;95;135;175mlow\x1b[39m"));

		for (const [level, token] of [
			["off", "thinkingOff"],
			["minimal", "thinkingMinimal"],
			["medium", "thinkingMedium"],
			["high", "thinkingHigh"],
			["xhigh", "thinkingXhigh"],
		] as const) {
			effort = level;
			const label = level === "off" ? "thinking off" : level;
			const rgb = effortColors[token];
			assert.ok(rgb);
			const line = footer.render(100)[1];
			assert.ok(line?.includes(color(...rgb, label)));
			assert.equal(stripTerminalSequences(line ?? "").length, 99);
		}

		effort = "xhigh";
		const narrow = stripTerminalSequences(footer.render(76)[1] ?? "");
		assert.ok(narrow.endsWith("gpt-5.6-sol • xhigh"));
		assert.equal(narrow.length, 75);

		effort = "max";
		const firstMax = footer.render(100)[1];
		assert.ok(firstMax);
		await new Promise((resolve) => setTimeout(resolve, 180));
		assert.ok(stripTerminalSequences(firstMax).endsWith("gpt-5.6-sol • max"));
		assert.ok(renderRequests > 0);
		assert.ok(firstMax.split("\x1b[38;2;").length - 1 >= 4);

		effort = "ultra";
		const requestsBeforeUltra = renderRequests;
		const ultra = footer.render(100)[1];
		assert.ok(ultra);
		await new Promise((resolve) => setTimeout(resolve, 180));
		assert.ok(stripTerminalSequences(ultra).endsWith("gpt-5.6-sol • ultra"));
		assert.ok(renderRequests > requestsBeforeUltra);
		assert.ok(ultra.split("\x1b[38;2;").length - 1 >= 6);

		await onSessionShutdown?.({}, ctx);
		const replacementRender = () => ["gpt-5.6-sol • low • fast"];
		FooterComponent.prototype.render = replacementRender;
		assert.equal(Object.hasOwn(footer, "render"), false);
		assert.equal(footer.render, replacementRender);
		stale = true;
		assert.doesNotThrow(() => footer.render());
	} finally {
		footer.dispose();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("footer layout reclaims usage width so model tags survive", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-footer-fast-"));
	type SessionHandler = (event: unknown, ctx: any) => void | Promise<void>;
	let onSessionStart: SessionHandler | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: any) => any)
		| undefined;

	properBase({
		on(event: string, handler: SessionHandler) {
			if (event === "session_start") onSessionStart = handler;
		},
		getCommands: () => [],
	} as unknown as Parameters<typeof properBase>[0]);

	const statsLeft =
		"\u219110M \u2193261K R114M W2M CH99.5% $115.997 55.5%/1.0M (auto)";
	const right = "gpt-5.6-sol \u2022 xhigh \u2022 fast";
	class FooterComponent {
		render(width: number) {
			// Mimic pi's footer: right-align the model side and cut it with
			// no ellipsis when the one-line stats row does not fit.
			let stats: string;
			if (statsLeft.length + 2 + right.length <= width) {
				const pad = " ".repeat(width - statsLeft.length - right.length);
				stats = `${statsLeft}${pad}${right}`;
			} else {
				const cut = right.slice(0, Math.max(0, width - statsLeft.length - 2));
				const pad = " ".repeat(
					Math.max(0, width - statsLeft.length - cut.length),
				);
				stats = `${statsLeft}${pad}${cut}`;
			}
			return ["~/work/scribe (main)", stats, "mcp ok"];
		}
		invalidate() {}
		dispose() {}
	}

	const footer = new FooterComponent();
	const editor = {
		onSubmit: undefined,
		addToHistory() {},
		render: () => ["editor"],
	};
	const tui = {
		children: [{ children: [editor] }, { children: [footer] }],
		requestRender() {},
		terminal: { rows: 24 },
		showOverlay() {
			return { hide() {} };
		},
	};
	const theme = {
		fg: (_name: string, text: string) => text,
		getThinkingBorderColor: () => (text: string) => text,
		getFgAnsi: () => "",
	};
	const ctx = {
		cwd,
		model: { id: "gpt-5.6-sol" },
		thinkingLevel: "xhigh",
		sessionManager: {
			getBranch: () => [],
			getSessionFile: () => undefined,
		},
		ui: {
			getEditorComponent: () => () => editor,
			setEditorComponent: (factory: typeof installedFactory) => {
				installedFactory = factory;
			},
			theme,
		},
	};

	try {
		await onSessionStart?.({}, ctx);
		installedFactory?.(
			tui,
			{
				borderColor: (text: string) => text,
				selectList: { description: (text: string) => text },
			},
			new KeybindingsManager(),
		);

		// At width 76 pi's own render drops " \u2022 fast"; the wide
		// re-render must reclaim the usage columns so the tag survives.
		assert.ok(
			stripTerminalSequences(
				new FooterComponent().render(76)[1] ?? "",
			).endsWith("gpt-5.6-sol \u2022 xhigh"),
		);
		const lines = footer.render(76).map(stripTerminalSequences);
		assert.ok(lines[0]?.endsWith("$115.997"));
		assert.ok(lines[1]?.endsWith("gpt-5.6-sol \u2022 xhigh \u2022 fast"));
		assert.equal(lines[1]?.length, 75);
		assert.equal(lines[2], "mcp ok");
	} finally {
		footer.dispose();
		await rm(cwd, { recursive: true, force: true });
	}
});
