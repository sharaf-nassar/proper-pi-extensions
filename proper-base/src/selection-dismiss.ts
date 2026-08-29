import {
	isKeyRelease,
	parseKey,
	type TUI,
	type TuiInputListener,
} from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.selection-dismiss");
const PASTE_START = "\x1b[200~";

/**
 * Alternate-screen renderer surface holding the mouse-selection state. Every
 * field is TypeScript-private upstream, so the shape is duck-typed here and a
 * rename disables the dismissal rather than breaking selection itself.
 */
type SelectionHost = TUI & {
	getSelectionBounds?(): unknown;
	stopSelectionAutoScroll?(): void;
	selectionPressActive?: boolean;
	selectionDragged?: boolean;
	selectionAnchor?: unknown;
	selectionFocus?: unknown;
	selectionGranularity?: string;
	selectionInitialRange?: unknown;
	[INSTALLED]?: () => void;
};

/**
 * Whether terminal input is a keystroke or paste headed for the focused
 * component, as opposed to a terminal report such as a cell-size response.
 * Mouse, wheel, viewport-key, and focus input never reaches the listener at
 * all: the renderer's own earlier listener consumes it.
 */
export function isTypingInput(data: string): boolean {
	if (data.length === 0) return false;
	// Printable text, Enter, Backspace, control chars, non-ASCII graphemes,
	// and multi-character bursts all arrive without an escape prefix.
	if (!data.startsWith("\x1b")) return true;
	if (data.startsWith(PASTE_START)) return true;
	// Kitty release events repeat the press encoding and must not re-dismiss.
	if (isKeyRelease(data)) return false;
	return parseKey(data) !== undefined;
}

/**
 * Dismiss the fullscreen mouse selection when typing reaches the editor.
 *
 * Pi's alternate-screen renderer clears its selection on focus loss and on
 * the next mouse press, but never on keyboard input, so a highlight survives
 * typing and keeps painting whatever new content lands on its rows. The copy
 * already happened on mouse release, so dropping the highlight loses nothing.
 *
 * The listener registers after the renderer's own constructor-installed
 * listener, so it only sees input the viewport declined: scroll keys and
 * mouse gestures keep the selection, matching terminal convention. Keys the
 * caller marks preserved also keep it: Pi 0.84.4's `app.message.copy` action
 * (Ctrl+X) copies the active selection when `fullscreenCopyOnSelect` is
 * disabled, and it runs at the editor after this listener, so dismissing on
 * that keystroke would clear the selection before the copy reads it. It resets
 * the same private fields the renderer's focus-loss branch resets and never
 * consumes the input, so the keystroke still reaches the editor.
 *
 * Renderers without the selection surface, including regular mode, install
 * nothing. The renderer outlives an extension reload, so installation takes
 * over a previous instance's listener and disposal is identity-guarded.
 *
 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Selection dismissal]]
 */
export function installSelectionDismiss(
	tui: TUI,
	isPreservedInput?: (data: string) => boolean,
): (() => void) | undefined {
	const host = tui as SelectionHost;
	if (
		typeof host.getSelectionBounds !== "function" ||
		typeof host.stopSelectionAutoScroll !== "function"
	) {
		return undefined;
	}
	// A reload runs the new instance's editor factory before the outgoing
	// instance shuts down, so take over any listener it left on the renderer.
	host[INSTALLED]?.();

	const listener: TuiInputListener = (data) => {
		// A drag in progress owns the selection it is building.
		if (host.selectionPressActive) return undefined;
		if (host.getSelectionBounds?.() === undefined) return undefined;
		if (!isTypingInput(data)) return undefined;
		if (isPreservedInput?.(data)) return undefined;
		host.stopSelectionAutoScroll?.();
		host.selectionAnchor = undefined;
		host.selectionFocus = undefined;
		host.selectionGranularity = "character";
		host.selectionInitialRange = undefined;
		host.selectionDragged = false;
		host.requestRender();
		return undefined;
	};
	const unsubscribe = tui.addInputListener(listener);

	// A disposer left over from a previous extension instance must not remove
	// the listener that replaced it.
	const dispose = () => {
		if (host[INSTALLED] !== dispose) return;
		unsubscribe();
		delete host[INSTALLED];
	};
	host[INSTALLED] = dispose;
	return dispose;
}
