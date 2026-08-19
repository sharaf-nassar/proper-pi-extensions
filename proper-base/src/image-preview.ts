import { accessSync, constants } from "node:fs";
import { basename, isAbsolute } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type OverlayHandle,
	type OverlayMargin,
	type OverlayOptions,
	type TUI,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { isMounted, rowsBelow } from "./autocomplete-details.ts";

const INSTALLED = Symbol.for("pi-proper-base.image-preview");
const ACTIVE_OVERLAY = Symbol.for("pi-proper-base.image-preview-overlay");
const CLIPBOARD_IMAGE = /^pi-clipboard-[0-9a-f-]+\.(?:gif|jpe?g|png|webp)$/i;
const CLIPBOARD_IMAGE_PATH =
	/(?:[A-Za-z]:[\\/]|\/)[^\s]*?pi-clipboard-[0-9a-f-]+\.(?:gif|jpe?g|png|webp)/gi;

type PreviewEditor = Component & {
	getText?(): string;
	setText?(text: string): void;
	getCursor?(): { line: number; col: number };
	state?: { cursorLine: number; cursorCol: number };
	setCursorCol?(column: number): void;
	onChange?: (text: string) => void;
	autocompleteList?: {
		getSelectedItem(): { description?: string } | null;
	};
};

type Preview = {
	marker: string;
	path: string;
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
	_ctx: ExtensionContext,
): ImagePreviewController | undefined {
	const target = editor as InstalledEditor;
	const existing = target[INSTALLED];
	if (existing) {
		existing.update(_ctx);
		return existing;
	}
	if (!target.getText || !target.setText) return undefined;

	let counter = 0;
	let changingText = false;
	let previousText = target.getText();
	let visibleMarkers = "";
	let activePreviews: Preview[] = [];
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
			return activePreviews.flatMap((preview) =>
				wrapTextWithAnsi(`${preview.marker} ${preview.path}`, width),
			);
		},
		invalidate() {},
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
		}
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
		try {
			accessSync(path, constants.R_OK);
		} catch {
			return;
		}
		const marker = `[image ${++counter}]`;
		previews.set(marker, { marker, path });
		markersByPath.set(path, marker);
		return marker;
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
			let prepared = text;
			for (const preview of previews.values()) {
				prepared = prepared.replaceAll(preview.marker, preview.path);
			}
			visibleMarkers = "";
			activePreviews = [];
			releaseOverlay();
			return prepared;
		},
		clear() {
			previews.clear();
			markersByPath.clear();
			visibleMarkers = "";
			activePreviews = [];
			releaseOverlay();
		},
		dispose() {
			if (target[INSTALLED] !== controller) return;
			controller.clear();
			target.render = render;
			delete target.onChange;
			if (handler) target.onChange = handler;
			delete target[INSTALLED];
		},
		update(_next) {
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
