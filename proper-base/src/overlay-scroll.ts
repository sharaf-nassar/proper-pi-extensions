import {
	getKeybindings,
	isKeyRelease,
	type TUI,
	type TuiInputListener,
} from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.overlay-scroll");
/** Mirrors pi-tui's private PAGE_SCROLL_OVERLAP. */
const PAGE_OVERLAP = 4;

/** Alternate-screen renderer surface, duck-typed since most of it is private. */
type ScrollHost = TUI & {
	scrollBy(lines: number): void;
	scrollToTop(): void;
	scrollToBottom(): void;
	isOverlayFocused?(): boolean;
	getPrimaryScrollView?(): { viewportHeight: number };
	[INSTALLED]?: () => void;
};

/**
 * Keep the fullscreen transcript scrollable by key while an overlay owns
 * focus.
 *
 * Pi's viewport listener declines every `tui.altScreen` scroll key as soon as
 * a capturing overlay is focused, so an `ask_user_question` questionnaire
 * freezes the transcript behind it. (Pi 1.2.0 routes wheel events itself in
 * that state, so only keys need help.) This listener registers after the
 * renderer's own, so it only ever sees input the viewport already passed on,
 * and routes that to the same scroll methods the renderer would have used.
 * Keys are consumed so the overlay never receives a scroll chord.
 *
 * Regular mode and renderer shapes without the scroll surface install
 * nothing; a renamed private field only loses the page size, not scrolling
 * itself.
 *
 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Overlay transcript scrolling]]
 */
export function installOverlayScroll(tui: TUI): (() => void) | undefined {
	const host = tui as ScrollHost;
	if (
		typeof host.scrollBy !== "function" ||
		typeof host.scrollToTop !== "function" ||
		typeof host.scrollToBottom !== "function"
	) {
		return undefined;
	}
	host[INSTALLED]?.();

	const page = () =>
		Math.max(
			1,
			(host.getPrimaryScrollView?.().viewportHeight ?? 1) - PAGE_OVERLAP,
		);
	const half = () =>
		Math.max(
			1,
			Math.floor((host.getPrimaryScrollView?.().viewportHeight ?? 1) / 2),
		);

	const listener: TuiInputListener = (data) => {
		if (host.isOverlayFocused?.() !== true) return undefined;
		if (!data.startsWith("\x1b")) return undefined;
		const kb = getKeybindings();
		const action = kb.matches(data, "tui.altScreen.pageUp")
			? () => host.scrollBy(-page())
			: kb.matches(data, "tui.altScreen.pageDown")
				? () => host.scrollBy(page())
				: kb.matches(data, "tui.altScreen.halfPageUp")
					? () => host.scrollBy(-half())
					: kb.matches(data, "tui.altScreen.halfPageDown")
						? () => host.scrollBy(half())
						: kb.matches(data, "tui.altScreen.lineUp")
							? () => host.scrollBy(-1)
							: kb.matches(data, "tui.altScreen.lineDown")
								? () => host.scrollBy(1)
								: kb.matches(data, "tui.altScreen.top")
									? () => host.scrollToTop()
									: kb.matches(data, "tui.altScreen.bottom")
										? () => host.scrollToBottom()
										: undefined;
		if (!action) return undefined;
		if (!isKeyRelease(data)) action();
		return { consume: true };
	};
	const unsubscribe = tui.addInputListener(listener);

	const dispose = () => {
		if (host[INSTALLED] !== dispose) return;
		unsubscribe();
		delete host[INSTALLED];
	};
	host[INSTALLED] = dispose;
	return dispose;
}
