import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import properCustoms from "../index.ts";
import { installAutocompleteDetails } from "../src/autocomplete-details.ts";

test("hidden autocomplete details release their TUI overlay", async () => {
	let description: string | undefined = "details";
	let activeOverlays = 0;
	let isOverlayVisible: (() => boolean) | undefined;
	const editor = {
		autocompleteList: {
			getSelectedItem: () => ({ description }),
		},
		render: (_width: number) => ["editor"],
		invalidate() {},
	};
	const children: any[] = [editor];
	const tui = {
		children,
		terminal: { rows: 24 },
		showOverlay(_component: unknown, options: { visible: () => boolean }) {
			isOverlayVisible = options.visible;
			activeOverlays++;
			let active = true;
			return {
				hide() {
					if (!active) return;
					active = false;
					activeOverlays--;
				},
			};
		},
	};

	installAutocompleteDetails(editor, tui as any, {
		borderColor: (text: string) => text,
		selectList: { description: (text: string) => text },
	});

	editor.render(20);
	assert.equal(activeOverlays, 1);

	description = undefined;
	editor.render(20);
	assert.equal(activeOverlays, 0);

	description = "details";
	editor.render(20);
	assert.equal(activeOverlays, 1);

	children.length = 0;
	assert.equal(isOverlayVisible?.(), false);
	await Promise.resolve();
	assert.equal(activeOverlays, 0);
});

test("autocomplete descriptions overlay above the prompt without changing its height", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-customs-autocomplete-"));
	let onSessionStart: ((event: unknown, ctx: any) => Promise<void>) | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: any) => any)
		| undefined;
	let overlayComponent: { render(width: number): string[] } | undefined;
	let overlayOptions: any;

	properCustoms({
		on(event: string, handler: typeof onSessionStart) {
			if (event === "session_start") onSessionStart = handler;
		},
	} as any);

	let description: string | undefined = "full description text";
	const editor = {
		onSubmit: undefined,
		addToHistory() {},
		getPaddingX: () => 0,
		autocompleteList: {
			getSelectedItem: () => ({ description }),
		},
		render: () => ["editor", "→ item…"],
	};

	try {
		await onSessionStart?.(
			{},
			{
				cwd,
				sessionManager: {
					getBranch: () => [],
					getSessionFile: () => undefined,
				},
				ui: {
					getEditorComponent: () => () => editor,
					setEditorComponent: (factory: typeof installedFactory) => {
						installedFactory = factory;
					},
				},
			},
		);

		const footer = { render: () => ["cwd", "stats"] };
		const tui = {
			children: [{ children: [editor] }, footer],
			terminal: { rows: 24 },
			showOverlay(component: typeof overlayComponent, options: any) {
				overlayComponent = component;
				overlayOptions = options;
				return { hide() {} };
			},
		};
		const wrapped = installedFactory?.(
			tui,
			{
				borderColor: (text: string) => text,
				selectList: { description: (text: string) => text },
			},
			new KeybindingsManager(),
		);
		const lines = wrapped.render(20) as string[];

		assert.deepEqual(lines, ["editor", "→ item…"]);
		assert.ok(overlayComponent);
		assert.equal(overlayOptions.nonCapturing, true);
		assert.equal(overlayOptions.anchor, "bottom-left");
		assert.equal(overlayOptions.margin.bottom, 4);
		assert.equal(overlayOptions.visible(20, 24), true);

		const box = overlayComponent.render(20);
		assert.equal(
			box
				.slice(1, -1)
				.map((line) => line.slice(1, -1).trim())
				.join(" "),
			"full description text",
		);
		assert.ok(box.every((line) => line.length <= 20));

		description = undefined;
		assert.deepEqual(wrapped.render(20), ["editor", "→ item…"]);
		assert.equal(overlayOptions.visible(20, 24), false);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
