import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import properCustoms from "../index.ts";

test("footer colors preserve text and release the context on shutdown", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-customs-footer-"));
	type SessionHandler = (
		event: unknown,
		ctx: any,
	) => void | Promise<void>;
	let onSessionStart: SessionHandler | undefined;
	let onSessionShutdown: SessionHandler | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: any) => any)
		| undefined;
	let effort = "low";
	let stale = false;

	properCustoms({
		on(event: string, handler: SessionHandler) {
			if (event === "session_start") onSessionStart = handler;
			if (event === "session_shutdown") onSessionShutdown = handler;
		},
	} as any);

	class FooterComponent {
		render() {
			const label = effort === "off" ? "thinking off" : effort;
			return ["cwd", `stats  gpt-5.6-sol • ${label}`];
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

		const low = footer.render()[1]!;
		assert.equal(stripTerminalSequences(low), "stats  gpt-5.6-sol • low");
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
			const line = footer.render()[1];
			assert.ok(line?.includes(color(...rgb, label)));
		}

		effort = "max";
		const firstMax = footer.render()[1];
		assert.ok(firstMax);
		await new Promise((resolve) => setTimeout(resolve, 180));
		assert.equal(stripTerminalSequences(firstMax), "stats  gpt-5.6-sol • max");
		assert.ok(renderRequests > 0);
		assert.ok((firstMax.match(/\x1b\[38;2;/g) ?? []).length >= 4);

		effort = "ultra";
		const requestsBeforeUltra = renderRequests;
		const ultra = footer.render()[1];
		assert.ok(ultra);
		await new Promise((resolve) => setTimeout(resolve, 180));
		assert.equal(stripTerminalSequences(ultra), "stats  gpt-5.6-sol • ultra");
		assert.ok(renderRequests > requestsBeforeUltra);
		assert.ok((ultra.match(/\x1b\[38;2;/g) ?? []).length >= 6);

		await onSessionShutdown?.({}, ctx);
		stale = true;
		assert.doesNotThrow(() => footer.render());
	} finally {
		footer.dispose();
		await rm(cwd, { recursive: true, force: true });
	}
});
