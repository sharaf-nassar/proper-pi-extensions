import { test } from "node:test";
import assert from "node:assert/strict";

import { installRecorder } from "../src/recorder.ts";

/** Mirrors pi-tui's Editor: `onSubmit` is a class field, so it is an own property. */
class FakeEditor {
	onSubmit?: (text: string) => void;
	submit(text: string): void {
		this.onSubmit?.(text);
	}
}

test("records a prompt assigned after the recorder is installed", () => {
	// pi wires onSubmit after building the editor, so this is the normal order.
	const editor = new FakeEditor();
	const seen: string[] = [];
	const delivered: string[] = [];
	installRecorder(editor, (t) => seen.push(t));
	editor.onSubmit = (t) => delivered.push(t);

	editor.submit("/resume");
	assert.deepEqual(seen, ["/resume"]);
	assert.deepEqual(delivered, ["/resume"]);
});

test("records a prompt when onSubmit was already assigned", () => {
	const editor = new FakeEditor();
	const seen: string[] = [];
	const delivered: string[] = [];
	editor.onSubmit = (t) => delivered.push(t);
	installRecorder(editor, (t) => seen.push(t));

	editor.submit("say hi");
	assert.deepEqual(seen, ["say hi"]);
	assert.deepEqual(delivered, ["say hi"]);
});

test("beats the class field that shadows a prototype accessor", () => {
	// A prototype accessor on a subclass is silently overridden by the base
	// class field. Per-instance definition is the only thing that works.
	const editor = new FakeEditor();
	assert.equal(
		Object.getOwnPropertyDescriptor(editor, "onSubmit")?.set,
		undefined,
	);
	installRecorder(editor, () => {});
	assert.equal(
		typeof Object.getOwnPropertyDescriptor(editor, "onSubmit")?.set,
		"function",
	);
});

test("records even when nothing consumes the prompt", () => {
	const editor = new FakeEditor();
	const seen: string[] = [];
	installRecorder(editor, (t) => seen.push(t));
	editor.submit("orphan");
	assert.deepEqual(seen, []);

	editor.onSubmit = () => {};
	editor.submit("adopted");
	assert.deepEqual(seen, ["adopted"]);
});

test("records before handing the prompt on", () => {
	// A throw further down pi's submit path must not cost a history entry.
	const editor = new FakeEditor();
	const seen: string[] = [];
	installRecorder(editor, (t) => seen.push(t));
	editor.onSubmit = () => {
		throw new Error("downstream failure");
	};

	assert.throws(() => editor.submit("kept anyway"));
	assert.deepEqual(seen, ["kept anyway"]);
});

test("survives pi reassigning onSubmit later", () => {
	const editor = new FakeEditor();
	const seen: string[] = [];
	installRecorder(editor, (t) => seen.push(t));
	editor.onSubmit = () => {};
	editor.submit("first");
	editor.onSubmit = () => {};
	editor.submit("second");
	assert.deepEqual(seen, ["first", "second"]);
});

test("does not stack recorders on repeated installs", () => {
	// session_start fires again on reload, resume, and fork.
	const editor = new FakeEditor();
	const seen: string[] = [];
	assert.equal(
		installRecorder(editor, (t) => seen.push(t)),
		true,
	);
	assert.equal(
		installRecorder(editor, (t) => seen.push(t)),
		false,
	);
	editor.onSubmit = () => {};

	editor.submit("once");
	assert.deepEqual(seen, ["once"]);
});

test("clearing onSubmit does not resurrect a stale handler", () => {
	const editor = new FakeEditor();
	const seen: string[] = [];
	installRecorder(editor, (t) => seen.push(t));
	editor.onSubmit = () => {};
	editor.onSubmit = undefined;
	editor.submit("dropped");
	assert.deepEqual(seen, []);
});
