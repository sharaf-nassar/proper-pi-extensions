import { readFileSync } from "node:fs";
import { basename, extname, isAbsolute } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	getCapabilities,
	Image,
	type OverlayHandle,
	type OverlayMargin,
	type OverlayOptions,
	setCapabilities,
	type TUI,
} from "@earendil-works/pi-tui";

import { isMounted, rowsBelow } from "./autocomplete-details.ts";

const INSTALLED = Symbol.for("pi-proper-base.image-preview");
const ACTIVE_OVERLAY = Symbol.for("pi-proper-base.image-preview-overlay");
const CLIPBOARD_IMAGE = /^pi-clipboard-[0-9a-f-]+\.(?:gif|jpe?g|png|webp)$/i;
const CLIPBOARD_IMAGE_PATH =
	/(?:[A-Za-z]:[\\/]|\/)[^\s]*?pi-clipboard-[0-9a-f-]+\.(?:gif|jpe?g|png|webp)/gi;
const PREVIEW_WIDTH = 24;
const PREVIEW_HEIGHT = 6;

const MIME_TYPES: Record<string, string> = {
	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
};

type PreviewEditor = Component & {
	getText?(): string;
	setText?(text: string): void;
	onChange?: (text: string) => void;
	autocompleteList?: {
		getSelectedItem(): { description?: string } | null;
	};
};

type Preview = {
	marker: string;
	path: string;
	base64: string;
	mimeType: string;
};

export type ImagePreviewController = {
	prepare(text: string): string;
	clear(): void;
	dispose(): void;
	update(ctx: ExtensionContext): void;
};

type InstalledEditor = PreviewEditor & {
	[INSTALLED]?: ImagePreviewController;
};
type OverlayTui = TUI & { [ACTIVE_OVERLAY]?: OverlayHandle };

export function enableScribeImageCapability(): void {
	if (process.env.TERM_PROGRAM?.toLowerCase() !== "scribe") return;
	const capabilities = getCapabilities();
	if (capabilities.images !== "kitty") {
		setCapabilities({ ...capabilities, images: "kitty" });
	}
}

function singleDeletionIndex(before: string, after: string): number | undefined {
	if (before.length !== after.length + 1) return undefined;
	let index = 0;
	while (index < after.length && before[index] === after[index]) index++;
	return before.slice(0, index) + before.slice(index + 1) === after
		? index
		: undefined;
}

export function installImagePreview(
	editor: Component,
	tui: TUI,
	_ctx: ExtensionContext,
): ImagePreviewController | undefined {
	const target = editor as InstalledEditor;
	const existing = target[INSTALLED];
	if (existing) {
		existing.update(_ctx);
		return existing;
	}
	if (!target.getText || !target.setText) return undefined;

	let ctx = _ctx;
	let counter = 0;
	let changingText = false;
	let previousText = target.getText();
	let visibleMarkers = "";
	let activeImages: Image[] = [];
	let handler = target.onChange;
	const previews = new Map<string, Preview>();
	const markersByPath = new Map<string, string>();
	const render = target.render;
	const host = tui as OverlayTui;
	const margin: OverlayMargin = { bottom: 0 };
	let overlay: OverlayHandle | undefined;

	const releaseOverlay = () => {
		const active = overlay;
		if (!active) return;
		active.hide();
		overlay = undefined;
		if (host[ACTIVE_OVERLAY] === active) host[ACTIVE_OVERLAY] = undefined;
	};
	const hasDescription = () =>
		Boolean(target.autocompleteList?.getSelectedItem()?.description);
	const isVisible = () => activeImages.length > 0 && !hasDescription();
	const scheduleReleaseOverlay = () => {
		const inactive = overlay;
		if (!inactive) return;
		queueMicrotask(() => {
			if (
				overlay === inactive &&
				(!isVisible() || !isMounted(tui, target))
			) {
				releaseOverlay();
			}
		});
	};
	const component: Component = {
		render(width: number) {
			return activeImages.flatMap((image) =>
				image.render(Math.min(width, PREVIEW_WIDTH + 2)),
			);
		},
		invalidate() {
			for (const image of activeImages) image.invalidate();
		},
	};
	const options: OverlayOptions = {
		anchor: "bottom-left",
		margin,
		nonCapturing: true,
		width: PREVIEW_WIDTH + 2,
		visible: () => {
			const visible = isVisible() && isMounted(tui, target);
			if (!visible) scheduleReleaseOverlay();
			return visible;
		},
	};
	const ensureOverlay = () => {
		const active = host[ACTIVE_OVERLAY];
		if (overlay && active === overlay) return;
		active?.hide();
		overlay = tui.showOverlay(component, options);
		host[ACTIVE_OVERLAY] = overlay;
	};

	const sync = (text: string) => {
		const active = [...previews.values()].filter((preview) =>
			text.includes(preview.marker),
		);
		const signature = active.map((preview) => preview.marker).join("\0");
		if (signature !== visibleMarkers) {
			visibleMarkers = signature;
			activeImages = active.map(
				(preview) =>
					new Image(
						preview.base64,
						preview.mimeType,
						{ fallbackColor: (value) => ctx.ui.theme.fg("dim", value) },
						{
							filename: preview.marker.slice(1, -1),
							maxWidthCells: PREVIEW_WIDTH,
							maxHeightCells: PREVIEW_HEIGHT,
						},
					),
			);
		}
		if (isVisible() && isMounted(tui, target)) ensureOverlay();
		else releaseOverlay();
	};

	const markerForPath = (path: string): string | undefined => {
		const known = markersByPath.get(path);
		if (known) return known;
		if (!isAbsolute(path) || !CLIPBOARD_IMAGE.test(basename(path))) return;
		const mimeType = MIME_TYPES[extname(path).toLowerCase()];
		if (!mimeType) return;
		try {
			const marker = `[image ${++counter}]`;
			previews.set(marker, {
				marker,
				path,
				base64: readFileSync(path).toString("base64"),
				mimeType,
			});
			markersByPath.set(path, marker);
			return marker;
		} catch {
			return;
		}
	};
	const ingest = (text: string) =>
		text.replace(CLIPBOARD_IMAGE_PATH, (path) => markerForPath(path) ?? path);
	const onChange = (text: string) => {
		if (changingText) {
			previousText = text;
			sync(text);
			handler?.(text);
			return;
		}

		const deletedIndex = singleDeletionIndex(previousText, text);
		if (deletedIndex !== undefined) {
			for (const preview of previews.values()) {
				const markerStart = previousText.indexOf(preview.marker);
				if (
					markerStart < 0 ||
					deletedIndex < markerStart ||
					deletedIndex >= markerStart + preview.marker.length
				) {
					continue;
				}
				previews.delete(preview.marker);
				markersByPath.delete(preview.path);
				const cleaned =
					text.slice(0, markerStart) +
					text.slice(markerStart + preview.marker.length - 1);
				changingText = true;
				target.setText?.(cleaned);
				changingText = false;
				return;
			}
		}

		const ingested = ingest(text);
		if (ingested !== text) {
			changingText = true;
			target.setText?.(ingested);
			changingText = false;
			return;
		}
		previousText = text;
		sync(text);
		handler?.(text);
	};

	const controller: ImagePreviewController = {
		prepare(text) {
			let prepared = text;
			for (const preview of previews.values()) {
				prepared = prepared.replaceAll(preview.marker, preview.path);
			}
			visibleMarkers = "";
			activeImages = [];
			releaseOverlay();
			return prepared;
		},
		clear() {
			previews.clear();
			markersByPath.clear();
			visibleMarkers = "";
			activeImages = [];
			releaseOverlay();
		},
		dispose() {
			if (target[INSTALLED] !== controller) return;
			controller.clear();
			target.render = render;
			delete target.onChange;
			target.onChange = handler;
			delete target[INSTALLED];
		},
		update(next) {
			ctx = next;
			visibleMarkers = "";
			sync(target.getText?.() ?? "");
		},
	};

	try {
		Object.defineProperty(target, "onChange", {
			configurable: true,
			enumerable: true,
			get: () => onChange,
			set: (next: ((text: string) => void) | undefined) => {
				handler = next;
			},
		});
	} catch {
		return undefined;
	}
	target.render = (width: number) => {
		const lines = render.call(target, width);
		sync(target.getText?.() ?? "");
		margin.bottom = lines.length + rowsBelow(tui, target, width);
		return lines;
	};
	target[INSTALLED] = controller;
	onChange(target.getText());
	return controller;
}
