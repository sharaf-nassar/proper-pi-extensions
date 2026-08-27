import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	getCapabilities,
	getCellDimensions,
	setCapabilities,
	setCellDimensions,
} from "@earendil-works/pi-tui";
import sharp from "sharp";
import properBase from "../index.ts";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { installEditorNavigation } from "../src/editor-navigation.ts";
import { installImagePreview, planPreviewImage } from "../src/image-preview.ts";
import { readPrompts, storePath } from "../src/store.ts";

const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
	"base64",
);

test("large previews use bounded thumbnail payloads", () => {
	const previousCells = getCellDimensions();
	const largePng = Buffer.from(PNG_1X1);
	largePng.writeUInt32BE(4096, 16);
	largePng.writeUInt32BE(2160, 20);
	setCellDimensions({ widthPx: 9, heightPx: 18 });

	try {
		assert.deepEqual(planPreviewImage("image/png", largePng), {
			image: undefined,
			thumbnail: { widthPx: 216, heightPx: 108 },
		});
		assert.deepEqual(planPreviewImage("image/png", PNG_1X1), {
			image: {
				base64: PNG_1X1.toString("base64"),
				mimeType: "image/png",
			},
			thumbnail: undefined,
		});
	} finally {
		setCellDimensions(previousCells);
	}
});

test("frames without a visible preview skip measuring rows below the editor", async () => {
	const dir = await mkdtemp(join(tmpdir(), "proper-base-image-margin-"));
	const imagePath = join(
		dir,
		"pi-clipboard-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
	);
	await writeFile(imagePath, PNG_1X1);
	let text = "";
	let belowRenders = 0;
	const editor = {
		onChange: undefined as ((value: string) => void) | undefined,
		getText: () => text,
		setText(value: string) {
			text = value;
			this.onChange?.(text);
		},
		insertTextAtCursor(value: string) {
			text += value;
			this.onChange?.(text);
		},
		render: (_width: number) => [text],
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
		requestRender() {},
		showOverlay: () => ({ hide() {} }),
	};

	try {
		installImagePreview(editor, tui as never, {
			fallbackColor: (value) => value,
		});

		// Idle frames must not re-render the components below the editor just
		// to position an overlay that cannot show.
		editor.render(20);
		assert.equal(belowRenders, 0);

		editor.insertTextAtCursor(imagePath);
		assert.equal(text, "[image 1]");
		editor.render(20);
		assert.ok(belowRenders > 0);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("thumbnail completion promotes path fallback to Kitty preview", async () => {
	const dir = await mkdtemp(join(tmpdir(), "proper-base-image-thumbnail-"));
	const imagePath = join(
		dir,
		"pi-clipboard-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
	);
	const largePng = Buffer.from(PNG_1X1);
	largePng.writeUInt32BE(4096, 16);
	largePng.writeUInt32BE(2160, 20);
	await writeFile(imagePath, largePng);
	let text = "";
	let overlayComponent: { render(width: number): string[] } | undefined;
	let requestRenderCount = 0;
	const previousCapabilities = getCapabilities();
	const previousCells = getCellDimensions();
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
	setCellDimensions({ widthPx: 9, heightPx: 18 });
	const editor = {
		onChange: undefined as ((value: string) => void) | undefined,
		getText: () => text,
		setText(value: string) {
			text = value;
			this.onChange?.(text);
		},
		insertTextAtCursor(value: string) {
			text += value;
			this.onChange?.(text);
		},
		render: () => [text],
		invalidate() {},
	};
	const tui = {
		children: [editor],
		terminal: { rows: 24 },
		requestRender() {
			requestRenderCount += 1;
		},
		showOverlay(component: typeof overlayComponent) {
			overlayComponent = component;
			return { hide() {} };
		},
	};

	try {
		installImagePreview(
			editor,
			tui as never,
			{ fallbackColor: (value) => value },
			(_path, widthPx, heightPx, done) => {
				assert.deepEqual(
					{ widthPx, heightPx },
					{ widthPx: 216, heightPx: 108 },
				);
				queueMicrotask(() =>
					done({
						base64: PNG_1X1.toString("base64"),
						mimeType: "image/png",
					}),
				);
				return () => {};
			},
		);
		editor.insertTextAtCursor(imagePath);
		assert.equal(text, "[image 1]");
		const loadingText = overlayComponent?.render(200).join("\n") ?? "";
		assert.ok(loadingText.includes("⠋"));
		assert.ok(!loadingText.includes(imagePath));

		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.ok(overlayComponent?.render(200).join("\n").includes("\x1b_G"));
		assert.equal(requestRenderCount, 2);
		await new Promise<void>((resolve) => setTimeout(resolve, 100));
		assert.equal(requestRenderCount, 2);
	} finally {
		setCapabilities(previousCapabilities);
		setCellDimensions(previousCells);
		await rm(dir, { recursive: true, force: true });
	}
});

test("sharp thumbnails supported clipboard formats", async () => {
	const dir = await mkdtemp(join(tmpdir(), "proper-base-image-sharp-"));
	const previousCapabilities = getCapabilities();
	const previousCells = getCellDimensions();
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
	setCellDimensions({ widthPx: 9, heightPx: 18 });

	try {
		for (const format of ["png", "jpeg", "gif", "webp"] as const) {
			const imagePath = join(
				dir,
				`pi-clipboard-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.${format}`,
			);
			await writeFile(
				imagePath,
				await sharp({
					create: {
						width: 400,
						height: 200,
						channels: 4,
						background: { r: 0, g: 128, b: 255, alpha: 1 },
					},
				})
					.toFormat(format)
					.toBuffer(),
			);
			let text = "";
			let overlayComponent: { render(width: number): string[] } | undefined;
			const editor = {
				onChange: undefined as ((value: string) => void) | undefined,
				getText: () => text,
				setText(value: string) {
					text = value;
					this.onChange?.(text);
				},
				insertTextAtCursor(value: string) {
					text += value;
					this.onChange?.(text);
				},
				render: () => [text],
				invalidate() {},
			};
			const tui = {
				children: [editor],
				terminal: { rows: 24 },
				requestRender() {},
				showOverlay(component: typeof overlayComponent) {
					overlayComponent = component;
					return { hide() {} };
				},
			};
			const controller = installImagePreview(editor, tui as never);
			editor.insertTextAtCursor(imagePath);
			assert.ok(overlayComponent?.render(200).join("\n").includes("⠋"));
			for (let attempts = 0; attempts < 100; attempts += 1) {
				if (overlayComponent?.render(200).join("\n").includes("\x1b_G")) {
					break;
				}
				await new Promise<void>((resolve) => setTimeout(resolve, 10));
			}
			assert.ok(
				overlayComponent?.render(200).join("\n").includes("\x1b_G"),
				format,
			);
			controller?.dispose();
		}
	} finally {
		setCapabilities(previousCapabilities);
		setCellDimensions(previousCells);
		await rm(dir, { recursive: true, force: true });
	}
});

test("sharp lock includes macOS runtime artifacts", async () => {
	const lock = JSON.parse(
		await readFile(
			join(import.meta.dirname, "..", "package-lock.json"),
			"utf8",
		),
	) as {
		packages: Record<
			string,
			{ cpu?: string[]; os?: string[]; optional?: boolean }
		>;
	};
	for (const [name, cpu] of [
		["node_modules/@img/sharp-darwin-arm64", "arm64"],
		["node_modules/@img/sharp-darwin-x64", "x64"],
	] as const) {
		const entry = lock.packages[name];
		assert.deepEqual(entry?.os, ["darwin"]);
		assert.deepEqual(entry?.cpu, [cpu]);
		assert.equal(entry?.optional, true);
	}
});

test("focus return forces Kitty preview retransmission", async () => {
	const dir = await mkdtemp(join(tmpdir(), "proper-base-image-focus-"));
	const imagePath = join(
		dir,
		"pi-clipboard-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
	);
	await writeFile(imagePath, PNG_1X1);
	let text = "";
	let overlayComponent: { render(width: number): string[] } | undefined;
	const renderForces: Array<boolean | undefined> = [];
	const focusInputs: string[] = [];
	const previousCapabilities = getCapabilities();
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
	const editor = {
		onChange: undefined as ((value: string) => void) | undefined,
		getText: () => text,
		setText(value: string) {
			text = value;
			this.onChange?.(text);
		},
		insertTextAtCursor(value: string) {
			text += value;
			this.onChange?.(text);
		},
		render: () => [text],
		invalidate() {},
	};
	const originalFocusInput = (data: string) => {
		focusInputs.push(data);
		return { consume: true };
	};
	const tui = {
		children: [editor],
		terminal: { rows: 24 },
		uploadedKittyImages: new Map([[1, {}]]),
		handleViewportInput: originalFocusInput,
		requestRender(force?: boolean) {
			renderForces.push(force);
		},
		showOverlay(component: typeof overlayComponent) {
			overlayComponent = component;
			return { hide() {} };
		},
	};

	try {
		const controller = installImagePreview(editor, tui as never);
		editor.insertTextAtCursor(imagePath);
		assert.ok(overlayComponent?.render(200).join("\n").includes("\x1b_G"));

		assert.deepEqual(tui.handleViewportInput("\x1b[I"), { consume: true });
		assert.deepEqual(focusInputs, ["\x1b[I"]);
		assert.equal(tui.uploadedKittyImages.size, 0);
		assert.deepEqual(renderForces, [true]);

		controller?.dispose();
		assert.equal(tui.handleViewportInput, originalFocusInput);
	} finally {
		setCapabilities(previousCapabilities);
		await rm(dir, { recursive: true, force: true });
	}
});

test("image marker rewrites preserve the cursor location", async () => {
	const dir = await mkdtemp(join(tmpdir(), "proper-base-image-cursor-"));
	const imagePath = join(
		dir,
		"pi-clipboard-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
	);
	await writeFile(imagePath, PNG_1X1);
	let text = "before  after";
	const state = { lines: [text], cursorLine: 0, cursorCol: 7 };
	const editor = {
		state,
		onChange: undefined as ((value: string) => void) | undefined,
		getText: () => text,
		getCursor: () => ({ line: state.cursorLine, col: state.cursorCol }),
		setCursorCol(column: number) {
			state.cursorCol = column;
		},
		setText(value: string) {
			text = value;
			state.lines = value.split("\n");
			state.cursorLine = state.lines.length - 1;
			state.cursorCol = state.lines.at(-1)?.length ?? 0;
			this.onChange?.(value);
		},
		insertTextAtCursor(value: string) {
			text =
				text.slice(0, state.cursorCol) + value + text.slice(state.cursorCol);
			state.lines = [text];
			state.cursorCol += value.length;
			this.onChange?.(text);
		},
		render: () => [text],
		invalidate() {},
	};
	const tui = {
		children: [editor],
		terminal: { rows: 24 },
		showOverlay() {
			return { hide() {} };
		},
	};

	try {
		installImagePreview(editor, tui as never);
		editor.insertTextAtCursor(imagePath);
		assert.equal(text, "before [image 1] after");
		assert.deepEqual(editor.getCursor(), { line: 0, col: 16 });

		const markerStart = text.indexOf("[image 1]");
		const deletion = markerStart + 4;
		text = text.slice(0, deletion) + text.slice(deletion + 1);
		state.lines = [text];
		state.cursorCol = deletion;
		editor.onChange?.(text);
		assert.equal(text, "before  after");
		assert.deepEqual(editor.getCursor(), { line: 0, col: markerStart });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("recalled image prompts keep history browsing active", async () => {
	const dir = await mkdtemp(join(tmpdir(), "proper-base-image-history-"));
	const imagePath = join(
		dir,
		"pi-clipboard-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
	);
	await writeFile(imagePath, PNG_1X1);
	const tui = {
		children: [] as unknown[],
		terminal: { rows: 24 },
		requestRender() {},
		showOverlay() {
			return { hide() {} };
		},
	};
	const editor = new Editor(
		tui as never,
		{ borderColor: (value: string) => value, selectList: {} } as never,
	);
	tui.children.push(editor);
	editor.addToHistory("older prompt");
	editor.addToHistory(`inspect ${imagePath}`);
	const keybindings = new KeybindingsManager();

	try {
		installImagePreview(editor, tui as never);
		installEditorNavigation(editor, keybindings);

		editor.handleInput("\x1b[A");
		assert.equal(editor.getText(), "inspect [image 1]");
		assert.equal(
			(editor as unknown as { historyIndex: number }).historyIndex,
			0,
		);

		editor.handleInput("\x1b[A");
		assert.equal(editor.getText(), "older prompt");
		assert.equal(
			(editor as unknown as { historyIndex: number }).historyIndex,
			1,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("clipboard image markers render Kitty previews and expand before submission", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-image-preview-"));
	const imagePath = join(
		tmpdir(),
		"pi-clipboard-12345678-1234-1234-1234-123456789abc.png",
	);
	const historyPath = storePath(getAgentDir(), cwd);
	await writeFile(imagePath, PNG_1X1);
	let onSessionStart: ((event: unknown, ctx: any) => Promise<void>) | undefined;
	let installedFactory:
		| ((tui: any, theme: any, keybindings: any) => any)
		| undefined;
	let overlayComponent: { render(width: number): string[] } | undefined;
	let overlayOptions: any;
	let text = "";
	let submitted: string | undefined;
	const previousTermProgram = process.env.TERM_PROGRAM;
	const previousCapabilities = getCapabilities();
	process.env.TERM_PROGRAM = "Scribe";
	setCapabilities({ images: null, trueColor: true, hyperlinks: false });

	properBase({
		on(event: string, handler: typeof onSessionStart) {
			if (event === "session_start") onSessionStart = handler;
		},
		getCommands: () => [],
	} as any);
	assert.equal(getCapabilities().images, "kitty");

	const editor = {
		onSubmit: undefined as ((text: string) => void) | undefined,
		onChange: undefined as ((text: string) => void) | undefined,
		addToHistory() {},
		getText: () => text,
		setText(value: string) {
			text = value;
			this.onChange?.(text);
		},
		insertTextAtCursor(value: string) {
			text += value;
			this.onChange?.(text);
		},
		render: () => [text],
	};
	const ctx = {
		cwd,
		isIdle: () => true,
		sessionManager: {
			getBranch: () => [],
			getSessionFile: () => undefined,
		},
		ui: {
			theme: { fg: (_name: string, value: string) => value },
			addAutocompleteProvider() {},
			getEditorComponent: () => () => editor,
			setEditorComponent(factory: typeof installedFactory) {
				installedFactory = factory;
			},
			onTerminalInput() {
				return () => {};
			},
			setWidget() {},
		},
	};

	try {
		await onSessionStart?.({}, ctx);
		const tui = {
			mode: "fullscreen",
			imageProtocol: getCapabilities().images,
			children: [editor],
			terminal: { rows: 24 },
			getFocusedComponent: () => editor,
			showOverlay(component: typeof overlayComponent, options: any) {
				overlayComponent = component;
				overlayOptions = options;
				return { hide() {} };
			},
		};
		const wrapped = installedFactory?.(
			tui,
			{
				borderColor: (value: string) => value,
				selectList: { description: (value: string) => value },
			},
			new KeybindingsManager(),
		);
		wrapped.onSubmit = (value: string) => {
			submitted = value;
		};
		wrapped.onChange = () => {};

		wrapped.insertTextAtCursor(`inspect ${imagePath}`);
		wrapped.render(40);
		assert.equal(wrapped.getText(), "inspect [image 1]");
		assert.ok(overlayComponent);
		assert.equal(overlayOptions.anchor, "bottom-left");
		assert.equal(overlayOptions.nonCapturing, true);
		assert.equal(tui.imageProtocol, "kitty");
		const kittyOverlay = overlayComponent.render(200).join("\n");
		assert.ok(kittyOverlay.includes("\x1b_G"));

		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		const textOverlay = overlayComponent.render(200).join("\n");
		assert.ok(textOverlay.includes(`[image 1] ${imagePath}`));
		assert.ok(!textOverlay.includes("\x1b_G"));

		wrapped.setText("inspect [image 1");
		assert.equal(wrapped.getText(), "inspect ");
		wrapped.setText(`inspect ${imagePath}`);
		assert.equal(wrapped.getText(), "inspect [image 2]");

		wrapped.onSubmit(wrapped.getText());
		assert.equal(submitted, `inspect ${imagePath}`);
		assert.equal(readPrompts(historyPath).at(-1)?.text, `inspect ${imagePath}`);
	} finally {
		if (previousTermProgram === undefined) delete process.env.TERM_PROGRAM;
		else process.env.TERM_PROGRAM = previousTermProgram;
		setCapabilities(previousCapabilities);
		await rm(cwd, { recursive: true, force: true });
		await rm(historyPath, { force: true });
		await rm(imagePath, { force: true });
	}
});
