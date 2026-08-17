/**
 * Submit interception for pi's editor.
 *
 * `onSubmit` is the only hook that sees every prompt. pi's `input` event fires
 * after built-in commands return and after extension commands are dispatched,
 * so `/resume` and `/piolium-help` never reach it.
 */

/** The part of pi's editor this module touches. */
export interface SubmittableEditor {
	onSubmit?: (text: string) => void;
}

const INSTALLED = Symbol.for("pi-proper-history.recorder");

/**
 * Record every prompt submitted through this editor.
 *
 * pi assigns `onSubmit` as a plain property after construction, and pi-tui
 * declares it as a class field. That field is an own property on every
 * instance, so a prototype accessor on a subclass is shadowed and never runs.
 * Redefining the property on the instance is what makes interception work.
 *
 * Recording happens before the prompt is handed on, so a failure further down
 * pi's submit path cannot cost a history entry. Returns false if the editor
 * already has a recorder, which keeps repeated `session_start` passes from
 * stacking them.
 */
export function installRecorder(editor: SubmittableEditor, record: (text: string) => void): boolean {
	const marked = editor as SubmittableEditor & { [INSTALLED]?: boolean };
	if (marked[INSTALLED]) return false;

	let handler = editor.onSubmit;
	const wrap = (next: ((text: string) => void) | undefined) => (text: string) => {
		record(text);
		next?.(text);
	};
	handler = handler ? wrap(handler) : undefined;

	try {
		Object.defineProperty(editor, "onSubmit", {
			configurable: true,
			enumerable: true,
			get: () => handler,
			set: (next: ((text: string) => void) | undefined) => {
				handler = next ? wrap(next) : undefined;
			},
		});
	} catch {
		return false;
	}

	marked[INSTALLED] = true;
	return true;
}
