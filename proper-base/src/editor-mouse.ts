import type {
	Component,
	TuiMouseEvent,
	TuiMouseEventResult,
} from "@earendil-works/pi-tui";

const INSTALLED = Symbol.for("pi-proper-base.editor-mouse");

type MouseHandler = (event: TuiMouseEvent) => TuiMouseEventResult | undefined;
type MouseEditor = Component & {
	handleMouse?: MouseHandler;
	renderedVisibleLineCount?: number;
	[INSTALLED]?: () => void;
};

/**
 * Keep prompt clicks from moving the editor cursor while the setting is off.
 *
 * Since Pi 0.85.0 the fullscreen renderer routes mouse input through
 * component `handleMouse` methods, and the editor's own handler turns a left
 * click on a prompt row into a cursor move. That is the wrong default for
 * anyone who clicks the prompt area to focus the terminal or to select text:
 * the cursor jumps away from where typing left it. This wraps the editor
 * instance's `handleMouse` and, while `enabled()` is false, swallows left
 * clicks that land on the prompt's text rows. The event is still reported
 * handled so the click neither falls through to the renderer's selection
 * path nor moves focus, and the drag-to-select gesture is untouched because
 * the editor already leaves press, drag, and release to the renderer.
 *
 * Clicks on the autocomplete rows below the prompt, and on the border rows,
 * keep Pi's native behavior: the guard only covers the text rows Pi itself
 * bounds with `renderedVisibleLineCount`. Editors without a `handleMouse`
 * (Pi before 0.85.0, or a renderer without mouse dispatch) install nothing.
 *
 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Prompt mouse clicks]]
 */
export function installEditorMouseGuard(
	editor: Component,
	enabled: () => boolean,
): (() => void) | undefined {
	const target = editor as MouseEditor;
	target[INSTALLED]?.();
	if (typeof target.handleMouse !== "function") return undefined;

	const hadOwnMethod = Object.hasOwn(target, "handleMouse");
	const original = target.handleMouse;
	const wrapped: MouseHandler = function (this: MouseEditor, event) {
		if (
			!enabled() &&
			event.type === "click" &&
			event.button === "left" &&
			event.y > 0 &&
			event.y <= (target.renderedVisibleLineCount ?? 0)
		) {
			return { handled: true };
		}
		return original.call(this, event);
	};
	target.handleMouse = wrapped;

	const dispose = () => {
		if (target.handleMouse !== wrapped) return;
		if (hadOwnMethod) target.handleMouse = original;
		else delete target.handleMouse;
		delete target[INSTALLED];
	};
	target[INSTALLED] = dispose;
	return dispose;
}
