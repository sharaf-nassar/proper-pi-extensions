import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import {
	getCapabilities,
	setCapabilities,
} from "@earendil-works/pi-tui";
import properBase from "../index.ts";

const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
	"base64",
);

test("clipboard image paths render as previews and expand on submit", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-image-preview-"));
	const imagePath = join(tmpdir(), "pi-clipboard-12345678-1234-1234-1234-123456789abc.png");
	await writeFile(imagePath, PNG_1X1);
	let onSessionStart: ((event: unknown, ctx: any) => Promise<void>) | undefined;
	let installedFactory: ((tui: any, theme: any, keybindings: any) => any) | undefined;
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

		wrapped.insertTextAtCursor(imagePath);
		wrapped.render(40);
		assert.equal(wrapped.getText(), "[image 1]");
		assert.ok(overlayComponent);
		assert.equal(overlayOptions.anchor, "bottom-left");
		assert.equal(overlayOptions.nonCapturing, true);
		assert.equal(overlayOptions.margin.bottom, 1);
		assert.equal(tui.imageProtocol, "kitty");
		assert.ok(overlayComponent.render(40).join("\n").includes("\x1b_G"));

		wrapped.setText("[image 1");
		assert.equal(wrapped.getText(), "");

		wrapped.setText(imagePath);
		assert.equal(wrapped.getText(), "[image 2]");

		wrapped.onSubmit(wrapped.getText());
		assert.equal(submitted, imagePath);
	} finally {
		if (previousTermProgram === undefined) delete process.env.TERM_PROGRAM;
		else process.env.TERM_PROGRAM = previousTermProgram;
		setCapabilities(previousCapabilities);
		await rm(cwd, { recursive: true, force: true });
		await rm(imagePath, { force: true });
	}
});
