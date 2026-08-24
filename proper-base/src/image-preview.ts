import { readFileSync } from "node:fs";
import { basename, extname, isAbsolute } from "node:path";
import {
	type Component,
	getCapabilities,
	getCellDimensions,
	getImageDimensions,
	Image,
	type ImageTheme,
	Loader,
	type OverlayHandle,
	type OverlayMargin,
	type OverlayOptions,
	setCapabilities,
	type TUI,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import sharp from "sharp";

import { isMounted, rowsBelow } from "./autocomplete-details.ts";

const INSTALLED = Symbol.for("pi-proper-base.image-preview");
const ACTIVE_OVERLAY = Symbol.for("pi-proper-base.image-preview-overlay");
const FOCUS_REFRESH = Symbol.for("pi-proper-base.image-preview-focus-refresh");
const FOCUS_IN = "\x1b[I";
const CLIPBOARD_IMAGE = /^pi-clipboard-[0-9a-f-]+\.(?:gif|jpe?g|png|webp)$/i;
const CLIPBOARD_IMAGE_PATH =
	/(?:[A-Za-z]:[\\/]|\/)[^\s]*?pi-clipboard-[0-9a-f-]+\.(?:gif|jpe?g|png|webp)/gi;
const PREVIEW_WIDTH = 24;
const PREVIEW_HEIGHT = 6;
const THUMBNAIL_TIMEOUT_SECONDS = 5;

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
	getCursor?(): { line: number; col: number };
	state?: { lines?: string[]; cursorLine: number; cursorCol: number };
	historyIndex?: number;
	setCursorCol?(column: number): void;
	onChange?: (text: string) => void;
	autocompleteList?: {
		getSelectedItem(): { description?: string } | null;
	};
};

type PreviewImage = {
	base64: string;
	mimeType: string;
};

type PreviewTheme = ImageTheme & {
	loadingColor?: (value: string) => string;
};

type Thumbnailer = (
	path: string,
	widthPx: number,
	heightPx: number,
	done: (image: PreviewImage | undefined) => void,
) => () => void;

type Preview = {
	marker: string;
	path: string;
	image: PreviewImage | undefined;
	cancelThumbnail: (() => void) | undefined;
};

type PreviewImagePlan = {
	image: PreviewImage | undefined;
	thumbnail: { widthPx: number; heightPx: number } | undefined;
};

export type ImagePreviewController = {
	prepare(text: string): string;
	clear(): void;
	dispose(): void;
};

type InstalledEditor = PreviewEditor & {
	[INSTALLED]?: ImagePreviewController;
};
type OverlayTui = TUI & { [ACTIVE_OVERLAY]?: OverlayHandle };
type FocusRefreshController = {
	restore(): void;
};
type FocusRefreshTui = OverlayTui & {
	handleViewportInput?(data: string): unknown;
	uploadedKittyImages?: Map<unknown, unknown>;
	[FOCUS_REFRESH]?: FocusRefreshController;
};

function installFocusRefresh(tui: TUI, refresh: () => void): () => void {
	const host = tui as FocusRefreshTui;
	host[FOCUS_REFRESH]?.restore();
	const original = host.handleViewportInput;
	if (!original) return () => {};
	const controller: FocusRefreshController = {
		restore() {
			if (host[FOCUS_REFRESH] !== controller) return;
			host.handleViewportInput = original;
			delete host[FOCUS_REFRESH];
		},
	};
	host.handleViewportInput = function (data: string) {
		const result = original.call(this, data);
		if (data === FOCUS_IN) refresh();
		return result;
	};
	host[FOCUS_REFRESH] = controller;
	return () => controller.restore();
}

export function enableScribeImageCapability(): void {
	if (process.env.TERM_PROGRAM?.toLowerCase() !== "scribe") return;
	const capabilities = getCapabilities();
	if (capabilities.images !== "kitty") {
		setCapabilities({ ...capabilities, images: "kitty" });
	}
}

function sharpThumbnail(
	path: string,
	widthPx: number,
	heightPx: number,
	done: (image: PreviewImage | undefined) => void,
): () => void {
	let cancelled = false;
	const pipeline = sharp(path, { pages: 1 })
		.rotate()
		.resize({
			width: widthPx,
			height: heightPx,
			fit: "inside",
			withoutEnlargement: true,
		})
		.png()
		.timeout({ seconds: THUMBNAIL_TIMEOUT_SECONDS });
	void pipeline
		.toBuffer()
		.then((output) => {
			if (!cancelled) {
				done({ base64: output.toString("base64"), mimeType: "image/png" });
			}
		})
		.catch(() => {
			if (!cancelled) done(undefined);
		});
	return () => {
		cancelled = true;
		pipeline.destroy();
	};
}

export function planPreviewImage(
	mimeType: string,
	source: Buffer,
): PreviewImagePlan {
	const base64 = source.toString("base64");
	const dimensions = getImageDimensions(base64, mimeType);
	const cells = getCellDimensions();
	const widthPx = Math.max(1, PREVIEW_WIDTH * cells.widthPx);
	const heightPx = Math.max(1, PREVIEW_HEIGHT * cells.heightPx);
	if (
		dimensions &&
		dimensions.widthPx <= widthPx &&
		dimensions.heightPx <= heightPx
	) {
		return { image: { base64, mimeType }, thumbnail: undefined };
	}
	return { image: undefined, thumbnail: { widthPx, heightPx } };
}

function singleDeletionIndex(
	before: string,
	after: string,
): number | undefined {
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
	theme: PreviewTheme = { fallbackColor: (value) => value },
	thumbnailer: Thumbnailer = sharpThumbnail,
): ImagePreviewController | undefined {
	const target = editor as InstalledEditor;
	const existing = target[INSTALLED];
	if (existing) return existing;
	if (!target.getText || !target.setText) return undefined;

	let counter = 0;
	let changingText = false;
	let previousText = target.getText();
	let visibleMarkers = "";
	let activePreviews: Preview[] = [];
	let activeImages: Array<Image | undefined> = [];
	let handler = target.onChange;
	const previews = new Map<string, Preview>();
	const markersByPath = new Map<string, string>();
	const render = target.render;
	const host = tui as OverlayTui;
	const margin: OverlayMargin = { bottom: 0 };
	let overlay: OverlayHandle | undefined;
	let loader: Loader | undefined;
	let removeFocusRefresh = () => {};

	const stopLoader = () => {
		loader?.stop();
		loader = undefined;
	};
	const renderLoader = (width: number) => {
		loader ??= new Loader(
			tui,
			theme.loadingColor ?? theme.fallbackColor,
			(value) => value,
			"",
		);
		return loader.render(Math.min(width, PREVIEW_WIDTH + 2));
	};
	const releaseOverlay = () => {
		const active = overlay;
		if (!active) return;
		active.hide();
		stopLoader();
		overlay = undefined;
		if (host[ACTIVE_OVERLAY] === active) delete host[ACTIVE_OVERLAY];
	};
	const hasDescription = () =>
		Boolean(target.autocompleteList?.getSelectedItem()?.description);
	const isVisible = () => activePreviews.length > 0 && !hasDescription();
	const scheduleReleaseOverlay = () => {
		const inactive = overlay;
		if (!inactive) return;
		queueMicrotask(() => {
			if (overlay === inactive && (!isVisible() || !isMounted(tui, target))) {
				releaseOverlay();
			}
		});
	};
	const component: Component = {
		render(width: number) {
			return activePreviews.flatMap((preview, index) => {
				const image = getCapabilities().images
					? activeImages[index]
					: undefined;
				if (image) return image.render(Math.min(width, PREVIEW_WIDTH + 2));
				if (preview.cancelThumbnail) return renderLoader(width);
				return wrapTextWithAnsi(`${preview.marker} ${preview.path}`, width);
			});
		},
		invalidate() {
			for (const image of activeImages) image?.invalidate();
		},
	};
	const options: OverlayOptions = {
		anchor: "bottom-left",
		margin,
		nonCapturing: true,
		width: "100%",
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
			activePreviews = active;
			activeImages = active.map((preview) =>
				preview.image
					? new Image(preview.image.base64, preview.image.mimeType, theme, {
							filename: preview.path,
							maxWidthCells: PREVIEW_WIDTH,
							maxHeightCells: PREVIEW_HEIGHT,
						})
					: undefined,
			);
		}
		if (!active.some((preview) => preview.cancelThumbnail)) stopLoader();
		if (isVisible() && isMounted(tui, target)) ensureOverlay();
		else releaseOverlay();
	};

	const cursorOffset = (text: string): number | undefined => {
		const cursor = target.getCursor?.();
		if (!cursor) return undefined;
		const lines = text.split("\n");
		let offset = 0;
		for (let line = 0; line < cursor.line; line++) {
			offset += (lines[line]?.length ?? 0) + 1;
		}
		return offset + cursor.col;
	};
	const restoreCursor = (text: string, offset: number | undefined) => {
		const state = target.state;
		if (offset === undefined || !state) return;
		const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
		const lines = before.split("\n");
		state.cursorLine = lines.length - 1;
		const column = lines.at(-1)?.length ?? 0;
		if (target.setCursorCol) target.setCursorCol(column);
		else state.cursorCol = column;
	};
	const replaceText = (text: string, offset: number | undefined) => {
		const state = target.state;
		if ((target.historyIndex ?? -1) >= 0 && state?.lines) {
			state.lines = text.split("\n");
			restoreCursor(text, offset);
			previousText = text;
			sync(text);
			handler?.(text);
			return;
		}
		changingText = true;
		try {
			target.setText?.(text);
		} finally {
			changingText = false;
		}
		restoreCursor(text, offset);
	};
	const markerForPath = (path: string): string | undefined => {
		const known = markersByPath.get(path);
		if (known) return known;
		if (!isAbsolute(path) || !CLIPBOARD_IMAGE.test(basename(path))) return;
		const mimeType = MIME_TYPES[extname(path).toLowerCase()];
		if (!mimeType) return;
		try {
			const marker = `[image ${++counter}]`;
			const plan = planPreviewImage(mimeType, readFileSync(path));
			const preview: Preview = {
				marker,
				path,
				image: plan.image,
				cancelThumbnail: undefined,
			};
			previews.set(marker, preview);
			markersByPath.set(path, marker);
			if (plan.thumbnail) {
				preview.cancelThumbnail = thumbnailer(
					path,
					plan.thumbnail.widthPx,
					plan.thumbnail.heightPx,
					(image) => {
						preview.cancelThumbnail = undefined;
						if (!image || previews.get(marker) !== preview) return;
						preview.image = image;
						visibleMarkers = "";
						sync(target.getText?.() ?? "");
						tui.requestRender();
					},
				);
			}
			return marker;
		} catch {
			return;
		}
	};
	const ingest = (text: string, cursor: number | undefined) => {
		let mappedCursor = cursor;
		let delta = 0;
		const ingested = text.replace(
			CLIPBOARD_IMAGE_PATH,
			(path, offset: number) => {
				const marker = markerForPath(path);
				if (!marker) return path;
				const end = offset + path.length;
				const difference = marker.length - path.length;
				if (cursor !== undefined) {
					if (cursor >= end) mappedCursor = cursor + delta + difference;
					else if (cursor > offset)
						mappedCursor = offset + delta + marker.length;
				}
				delta += difference;
				return marker;
			},
		);
		return { text: ingested, cursor: mappedCursor };
	};
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
				preview.cancelThumbnail?.();
				previews.delete(preview.marker);
				markersByPath.delete(preview.path);
				const cleaned =
					text.slice(0, markerStart) +
					text.slice(markerStart + preview.marker.length - 1);
				replaceText(cleaned, markerStart);
				return;
			}
		}

		const ingested = ingest(text, cursorOffset(text));
		if (ingested.text !== text) {
			replaceText(ingested.text, ingested.cursor);
			return;
		}
		previousText = text;
		sync(text);
		handler?.(text);
	};

	const controller: ImagePreviewController = {
		prepare(text) {
			stopLoader();
			let prepared = text;
			for (const preview of previews.values()) {
				prepared = prepared.replaceAll(preview.marker, preview.path);
				preview.cancelThumbnail?.();
				preview.cancelThumbnail = undefined;
			}
			visibleMarkers = "";
			activePreviews = [];
			activeImages = [];
			releaseOverlay();
			return prepared;
		},
		clear() {
			stopLoader();
			for (const preview of previews.values()) preview.cancelThumbnail?.();
			previews.clear();
			markersByPath.clear();
			visibleMarkers = "";
			activePreviews = [];
			activeImages = [];
			releaseOverlay();
		},
		dispose() {
			if (target[INSTALLED] !== controller) return;
			removeFocusRefresh();
			controller.clear();
			target.render = render;
			delete target.onChange;
			if (handler) target.onChange = handler;
			delete target[INSTALLED];
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
	removeFocusRefresh = installFocusRefresh(tui, () => {
		if (!isVisible() || !activeImages.some(Boolean)) return;
		const uploaded = (host as FocusRefreshTui).uploadedKittyImages;
		if (!uploaded) return;
		uploaded.clear();
		tui.requestRender(true);
	});
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
