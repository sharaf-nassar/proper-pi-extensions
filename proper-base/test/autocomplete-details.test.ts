import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import properBase from "../index.ts";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import {
	installAutocompleteDetails,
	sortModelAutocompleteDescending,
} from "../src/autocomplete-details.ts";

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

test("no selected description skips measuring rows below the editor", () => {
	let description: string | undefined;
	let belowRenders = 0;
	const editor = {
		autocompleteList: {
			getSelectedItem: () => (description ? { description } : null),
		},
		render: (_width: number) => ["editor"],
		invalidate() {},
	};
	const below = {
		render() {
			belowRenders++;
			return ["footer"];
		},
		invalidate() {},
	};
	const tui = {
		children: [editor, below],
		terminal: { rows: 24 },
		showOverlay: () => ({ hide() {} }),
	};

	installAutocompleteDetails(editor, tui as unknown as TUI, {
		borderColor: (text: string) => text,
		selectList: { description: (text: string) => text },
	});

	// Idle frames must not re-render the components below the editor just to
	// position an overlay that cannot show.
	editor.render(20);
	assert.equal(belowRenders, 0);

	description = "details";
	editor.render(20);
	assert.ok(belowRenders > 0);
});

test("inline slash autocomplete targets only the active command", async () => {
	const requests: Array<{ line: string; cursorCol: number; force?: boolean }> =
		[];
	const provider = sortModelAutocompleteDescending({
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			requests.push({
				line: lines[cursorLine] ?? "",
				cursorCol,
				...(options.force === undefined ? {} : { force: options.force }),
			});
			if ((lines[cursorLine] ?? "") === "/rev") {
				return {
					prefix: "/rev",
					items: [{ value: "review", label: "review" }],
				};
			}
			if ((lines[cursorLine] ?? "") === "/model op") {
				return {
					prefix: "op",
					items: [{ value: "opus", label: "opus" }],
				};
			}
			return null;
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const current = lines[cursorLine] ?? "";
			const replacement = prefix.startsWith("/")
				? `/${item.value} `
				: item.value;
			const next = [...lines];
			next[cursorLine] =
				current.slice(0, cursorCol - prefix.length) +
				replacement +
				current.slice(cursorCol);
			return {
				lines: next,
				cursorLine,
				cursorCol: cursorCol - prefix.length + replacement.length,
			};
		},
	});
	const options = { signal: new AbortController().signal };

	const suggestions = await provider.getSuggestions(
		["please /rev"],
		0,
		11,
		options,
	);
	assert.equal(requests[0]?.line, "/rev");
	assert.equal(requests[0]?.cursorCol, 4);
	assert.equal(requests[0]?.force, false);
	assert.equal(suggestions?.prefix, "/rev");
	assert.deepEqual(
		provider.applyCompletion(
			["please /rev later"],
			0,
			11,
			{ value: "review", label: "review" },
			"/rev",
		),
		{
			lines: ["please /review  later"],
			cursorLine: 0,
			cursorCol: 15,
		},
	);
	assert.deepEqual(
		provider.applyCompletion(
			["first line", "then /rev now"],
			1,
			9,
			{ value: "review", label: "review" },
			"/rev",
		),
		{
			lines: ["first line", "then /review  now"],
			cursorLine: 1,
			cursorCol: 13,
		},
	);

	const argumentSuggestions = await provider.getSuggestions(
		["use /model op"],
		0,
		13,
		{ ...options, force: true },
	);
	assert.equal(requests.at(-1)?.line, "/model op");
	assert.equal(requests.at(-1)?.cursorCol, 9);
	assert.equal(requests.at(-1)?.force, false);
	assert.equal(argumentSuggestions?.prefix, "op");
	assert.deepEqual(
		provider.applyCompletion(
			["use /model op"],
			0,
			13,
			{ value: "opus", label: "opus" },
			"op",
		),
		{
			lines: ["use /model opus"],
			cursorLine: 0,
			cursorCol: 15,
		},
	);

	await provider.getSuggestions(["see https://pi.dev"], 0, 18, options);
	assert.equal(requests.at(-1)?.line, "see https://pi.dev");

	let onSessionStart: ((event: unknown, ctx: any) => Promise<void>) | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: any) => any)
		| undefined;
	let triggered = 0;
	let updated = 0;
	const editor = {
		state: { lines: ["please "], cursorLine: 0, cursorCol: 7 },
		showing: false,
		accept: undefined as (() => void) | undefined,
		onSubmit: undefined,
		addToHistory() {},
		handleInput(data: string) {
			const accept = this.accept;
			if (accept) {
				this.accept = undefined;
				accept();
				return;
			}
			const line = this.state.lines[this.state.cursorLine] ?? "";
			this.state.lines[this.state.cursorLine] =
				line.slice(0, this.state.cursorCol) +
				data +
				line.slice(this.state.cursorCol);
			this.state.cursorCol += data.length;
		},
		isShowingAutocomplete() {
			return this.showing;
		},
		tryTriggerAutocomplete() {
			triggered++;
		},
		updateAutocomplete() {
			updated++;
		},
		render: () => ["editor"],
	};
	properBase({
		on(event: string, handler: typeof onSessionStart) {
			if (event === "session_start") onSessionStart = handler;
		},
		getCommands: () => [],
	} as any);
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-inline-slash-"));
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
					addAutocompleteProvider() {},
					getEditorComponent: () => () => editor,
					setEditorComponent(factory: typeof installedFactory) {
						installedFactory = factory;
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
		wrapped.handleInput("/");
		assert.equal(triggered, 1);
		wrapped.handleInput("r");
		assert.equal(triggered, 2);

		editor.state = { lines: ["path src"], cursorLine: 0, cursorCol: 8 };
		wrapped.handleInput("/");
		assert.equal(triggered, 2);

		editor.state = { lines: ["first", ""], cursorLine: 1, cursorCol: 0 };
		wrapped.handleInput("/");
		assert.equal(triggered, 3);

		// Tab-accepting "/mo" -> "/model " closes the command list; the
		// wrapper must reopen suggestions so the argument menu shows without
		// another keystroke.
		editor.state = { lines: ["/mo"], cursorLine: 0, cursorCol: 3 };
		editor.showing = true;
		editor.accept = () => {
			editor.state = { lines: ["/model "], cursorLine: 0, cursorCol: 7 };
			editor.showing = false;
		};
		wrapped.handleInput("\t");
		assert.equal(triggered, 4);

		// Esc dismisses without a text change; the list just closed must not
		// reopen.
		editor.state = { lines: ["/model "], cursorLine: 0, cursorCol: 7 };
		editor.showing = true;
		editor.accept = () => {
			editor.showing = false;
		};
		wrapped.handleInput("\x1b");
		assert.equal(triggered, 4);

		// A completed multi-segment file path is not a command token; no menu
		// pops behind it.
		editor.state = { lines: ["see /mo"], cursorLine: 0, cursorCol: 7 };
		editor.showing = true;
		editor.accept = () => {
			editor.state = {
				lines: ["see /etc/passwd "],
				cursorLine: 0,
				cursorCol: 16,
			};
			editor.showing = false;
		};
		wrapped.handleInput("\t");
		assert.equal(triggered, 4);

		// Alt+backspace deletes the word but pi never refreshes the open
		// list; the wrapper re-requests so the stale menu closes.
		editor.state = { lines: ["/model "], cursorLine: 0, cursorCol: 7 };
		editor.showing = true;
		editor.accept = () => {
			editor.state = { lines: [""], cursorLine: 0, cursorCol: 0 };
		};
		wrapped.handleInput("\x1b\x7f");
		assert.equal(updated, 1);
		assert.equal(triggered, 4);

		// Plain backspace already refreshes inside the editor; no second
		// request.
		editor.state = { lines: ["/model "], cursorLine: 0, cursorCol: 7 };
		editor.showing = true;
		editor.accept = () => {
			editor.state = { lines: ["/model"], cursorLine: 0, cursorCol: 6 };
		};
		wrapped.handleInput("\x7f");
		assert.equal(updated, 1);

		// Keys that change no text while the list is open request nothing.
		editor.state = { lines: ["/model "], cursorLine: 0, cursorCol: 7 };
		editor.showing = true;
		editor.accept = () => {};
		wrapped.handleInput("\x1b[A");
		assert.equal(updated, 1);
		assert.equal(triggered, 4);
		editor.showing = false;
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("model autocomplete sorts names descending and submits immediately", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-model-autocomplete-"));
	let onSessionStart: ((event: unknown, ctx: any) => Promise<void>) | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: any) => any)
		| undefined;
	let autocompleteWrapper: ((current: any) => any) | undefined;
	const selected = { value: "cliproxyapi/gpt-5.6-sol" };
	type SelectedList = { getSelectedItem: () => { value: string } } | undefined;
	const editor = {
		text: "/model gpt",
		completed: "/model cliproxyapi/gpt-5.6-sol",
		onSubmit: undefined as ((text: string) => void) | undefined,
		addToHistory() {},
		getPaddingX: () => 0,
		getText() {
			return this.text;
		},
		autocompleteList: {
			getSelectedItem: () => selected,
		} as SelectedList,
		triggered: 0,
		tryTriggerAutocomplete() {
			this.triggered++;
		},
		handleInput(data: string) {
			if (this.autocompleteList && (data === "\r" || data === "\t")) {
				this.text = this.completed;
				this.autocompleteList = undefined;
				return;
			}
			if (data === "\t") return;
			if (data !== "\r") {
				this.text += data;
				return;
			}
			const submitted = this.text;
			this.text = "";
			this.onSubmit?.(submitted);
		},
		render: () => ["editor"],
	};
	const model = { provider: "cliproxyapi", id: "gpt-5.6-sol" };
	const applied: Array<string> = [];

	properBase({
		on(event: string, handler: typeof onSessionStart) {
			if (event === "session_start") onSessionStart = handler;
		},
		getCommands: () => [],
		getThinkingLevel: () => "high",
		async setModel(next: typeof model) {
			applied.push(`${next.provider}/${next.id}`);
			return true;
		},
		setThinkingLevel(level: string) {
			applied.push(level);
		},
	} as any);

	try {
		await onSessionStart?.(
			{},
			{
				cwd,
				scopedModels: [],
				modelRegistry: { getAvailable: () => [model] },
				sessionManager: {
					getBranch: () => [],
					getSessionFile: () => undefined,
				},
				ui: {
					notify() {},
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

		// Tab accepts the model name and stops there, leaving the separator and
		// an open level menu behind: add a level, or press Enter on the level
		// already in effect.
		editor.text = "/model gpt";
		editor.autocompleteList = {
			getSelectedItem: () => selected,
		};
		submitted = undefined;
		wrapped.handleInput("\t");
		assert.equal(submitted, undefined);
		assert.equal(wrapped.getText(), "/model cliproxyapi/gpt-5.6-sol ");
		assert.equal(editor.triggered, 1);

		// A separator typed by hand reaches the same menu; Pi never reopens
		// suggestions from a space on its own.
		editor.text = "/model cliproxyapi/gpt-5.6-sol";
		wrapped.handleInput(" ");
		assert.equal(wrapped.getText(), "/model cliproxyapi/gpt-5.6-sol ");
		assert.equal(editor.triggered, 2);

		// A space anywhere else asks for nothing.
		editor.text = "tell me";
		wrapped.handleInput(" ");
		assert.equal(editor.triggered, 2);

		// Enter on a thinking-level completion submits both arguments, which the
		// editor takes over instead of handing Pi a two-word model search.
		editor.text = "/model cliproxyapi/gpt-5.6-sol hi";
		editor.completed = "/model cliproxyapi/gpt-5.6-sol high";
		editor.autocompleteList = {
			getSelectedItem: () => ({ value: "high" }),
		};
		submitted = undefined;
		wrapped.handleInput("\r");
		assert.equal(submitted, undefined);
		assert.equal(wrapped.getText(), "");
		// The level is applied after the model resolves, so let that settle.
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.deepEqual(applied, ["cliproxyapi/gpt-5.6-sol", "high"]);

		// An unknown model reference stays Pi's problem; its picker still opens.
		applied.length = 0;
		editor.text = "/model nope/absent high";
		editor.autocompleteList = undefined;
		wrapped.handleInput("\r");
		assert.equal(submitted, "/model nope/absent high");
		assert.deepEqual(applied, []);

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

		// A completed model reference opens the thinking argument, and an
		// explicit Tab there must still list levels rather than file paths. The
		// level in effect leads, so Enter on the default selection keeps it.
		const levels = await provider.getSuggestions(
			["/model cliproxyapi/gpt-5.6-sol "],
			0,
			31,
			{ ...options, force: true },
		);
		assert.equal(levels.prefix, "");
		assert.deepEqual(
			levels.items.map((item: { value: string }) => item.value),
			["high", "off", "minimal", "low", "medium", "xhigh", "max"],
		);

		const level = await provider.getSuggestions(
			["/model cliproxyapi/gpt-5.6-sol hi"],
			0,
			33,
			options,
		);
		assert.equal(level.prefix, "hi");
		assert.deepEqual(
			level.items.map((item: { value: string }) => item.value),
			["high"],
		);

		// A second term naming no level keeps searching models, so a reference
		// typed one word at a time still narrows the way it used to.
		const stillModels = await provider.getSuggestions(
			["/model gpt/x 4"],
			0,
			14,
			options,
		);
		assert.deepEqual(
			stillModels.items.map((item: { label: string }) => item.label),
			["gpt-5.6", "gpt-5.4", "claude-sonnet-5"],
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
		getCommands: () => [],
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
				selectList: {
					selectedText: (text: string) => `\x1b[36m${text}\x1b[39m`,
					description: (text: string) => `\x1b[2m${text}\x1b[22m`,
				},
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
				.map((line) => stripTerminalSequences(line).slice(1, -1).trim())
				.join(" "),
			"full description text",
		);
		assert.ok(box.join("\n").includes("\x1b[36mfull description\x1b[39m"));
		assert.equal(box.join("\n").includes("\x1b[2m"), false);
		assert.ok(box.every((line) => stripTerminalSequences(line).length <= 20));

		description = undefined;
		assert.deepEqual(wrapped.render(20), ["editor", "→ item…"]);
		assert.equal(overlayOptions.visible(20, 24), false);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
