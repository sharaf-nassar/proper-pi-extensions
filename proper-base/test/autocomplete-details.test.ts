import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import properBase from "../index.ts";
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

test("model autocomplete sorts names descending and submits immediately", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-model-autocomplete-"));
	let onSessionStart: ((event: unknown, ctx: any) => Promise<void>) | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: any) => any)
		| undefined;
	let autocompleteWrapper: ((current: any) => any) | undefined;
	const selected = { value: "cliproxyapi/gpt-5.6-sol" };
	const editor = {
		text: "/model gpt",
		onSubmit: undefined as ((text: string) => void) | undefined,
		addToHistory() {},
		getPaddingX: () => 0,
		getText() {
			return this.text;
		},
		autocompleteList: {
			getSelectedItem: () => selected,
		},
		handleInput(data: string) {
			if (data !== "\r" && data !== "\t") return;
			if (this.autocompleteList) {
				this.text = `/model ${selected.value}`;
				this.autocompleteList = undefined as any;
				return;
			}
			if (data === "\t") return;
			const submitted = this.text;
			this.text = "";
			this.onSubmit?.(submitted);
		},
		render: () => ["editor"],
	};

	properBase({
		on(event: string, handler: typeof onSessionStart) {
			if (event === "session_start") onSessionStart = handler;
		},
	} as any);

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
					addAutocompleteProvider: (factory: typeof autocompleteWrapper) => {
						autocompleteWrapper = factory;
					},
				},
			},
		);

		const wrapped = installedFactory?.(
			{ children: [editor], terminal: { rows: 24 } },
			{
				borderColor: (text: string) => text,
				selectList: { description: (text: string) => text },
			},
			new KeybindingsManager(),
		);
		let submitted: string | undefined;
		wrapped.onSubmit = (text: string) => {
			submitted = text;
		};

		wrapped.handleInput("\r");

		assert.equal(submitted, "/model cliproxyapi/gpt-5.6-sol");
		assert.equal(wrapped.getText(), "");

		editor.text = "/model gpt";
		editor.autocompleteList = {
			getSelectedItem: () => selected,
		};
		submitted = undefined;
		wrapped.handleInput("\t");
		assert.equal(submitted, "/model cliproxyapi/gpt-5.6-sol");
		assert.equal(wrapped.getText(), "");

		assert.ok(autocompleteWrapper);
		const originalItems = [
			{ value: "cliproxyapi/gpt-5.4", label: "gpt-5.4" },
			{ value: "cliproxyapi/claude-sonnet-5", label: "claude-sonnet-5" },
			{ value: "cliproxyapi/gpt-5.6", label: "gpt-5.6" },
		];
		const filteredItems = [
			{ value: "cliproxyapi/claude-opus-4", label: "claude-opus-4" },
			{ value: "cliproxyapi/claude-sonnet-5", label: "claude-sonnet-5" },
			{ value: "cliproxyapi/claude-opus-5", label: "claude-opus-5" },
			{ value: "cliproxyapi/gpt-5.6-luna", label: "gpt-5.6-luna" },
			{ value: "cliproxyapi/claude-opus-4-7", label: "claude-opus-4-7" },
		];
		const provider = autocompleteWrapper({
			getSuggestions: async (lines: string[]) =>
				lines[0]?.startsWith("/model op")
					? { prefix: lines[0].slice(7), items: filteredItems }
					: { prefix: "", items: originalItems },
			applyCompletion() {},
		});
		const options = { signal: new AbortController().signal };
		const sorted = await provider.getSuggestions(["/model "], 0, 7, options);
		assert.deepEqual(
			sorted.items.map((item: { label: string }) => item.label),
			["gpt-5.6", "gpt-5.4", "claude-sonnet-5"],
		);

		const filtered = await provider.getSuggestions(
			["/model opu"],
			0,
			10,
			options,
		);
		assert.deepEqual(
			filtered.items.map((item: { label: string }) => item.label),
			["claude-opus-5", "claude-opus-4-7", "claude-opus-4"],
		);

		const multiTerm = await provider.getSuggestions(
			["/model opus 4"],
			0,
			13,
			options,
		);
		assert.deepEqual(
			multiTerm.items.map((item: { label: string }) => item.label),
			["claude-opus-4-7", "claude-opus-4"],
		);

		const untouched = await provider.getSuggestions(["/login "], 0, 7, options);
		assert.deepEqual(untouched.items, originalItems);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("autocomplete descriptions overlay above the prompt without changing its height", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-autocomplete-"));
	let onSessionStart: ((event: unknown, ctx: any) => Promise<void>) | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: any) => any)
		| undefined;
	let overlayComponent: { render(width: number): string[] } | undefined;
	let overlayOptions: any;

	properBase({
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
