import assert from "node:assert/strict";
import { test } from "node:test";

import {
	installClipboardLeakGuard,
	readClipboardTextViaTools,
} from "../src/clipboard-guard.ts";

const nativeTrap = (name: string) => () => {
	throw new Error(`native ${name} must not run once the guard is installed`);
};

// @lat: [[lat.md/proper-base/tests#Verification#Clipboard leak guard fixture]]
test("linux guard replaces the leaking readers once and leaves writes alone", async () => {
	const setText = nativeTrap("setText");
	const getImageBinary = nativeTrap("getImageBinary");
	const native = {
		getText: nativeTrap("getText"),
		hasImage: nativeTrap("hasImage"),
		setText,
		getImageBinary,
	};
	let reads = 0;
	assert.equal(
		installClipboardLeakGuard({
			platform: "linux",
			loadModule: () => native,
			readText: () => {
				reads += 1;
				return "from platform tools";
			},
		}),
		true,
	);

	// The replaced readers never touch the native implementations.
	assert.equal(await native.getText(), "from platform tools");
	assert.equal(reads, 1);
	assert.equal(native.hasImage(), false);

	// pi never calls these on Linux; they stay native rather than silently
	// changing behavior for a caller that does not exist today.
	assert.equal(native.setText, setText);
	assert.equal(native.getImageBinary, getImageBinary);

	// A reload re-runs the installer against pi's same cached module object;
	// the first wrappers stay in place instead of stacking.
	const wrappedGetText = native.getText;
	assert.equal(
		installClipboardLeakGuard({
			platform: "linux",
			loadModule: () => native,
			readText: () => "second install",
		}),
		true,
	);
	assert.equal(native.getText, wrappedGetText);
	assert.equal(await native.getText(), "from platform tools");
});

// @lat: [[lat.md/proper-base/tests#Verification#Clipboard leak guard fixture]]
test("guard stays out of the way off Linux and fails open on bad modules", () => {
	// macOS and Windows need the addon (pi has no subprocess reads there), so
	// the module must not even be resolved.
	assert.equal(
		installClipboardLeakGuard({
			platform: "darwin",
			loadModule: () => {
				throw new Error("the addon must not be resolved off Linux");
			},
		}),
		false,
	);

	// A missing or unrecognizable module leaves pi exactly as it was.
	assert.equal(
		installClipboardLeakGuard({ platform: "linux", loadModule: () => null }),
		false,
	);
	assert.equal(
		installClipboardLeakGuard({
			platform: "linux",
			loadModule: () => ({ getText: "not a function", hasImage: () => true }),
		}),
		false,
	);

	// Resolution against a pi entry point that does not exist fails open too.
	assert.equal(
		installClipboardLeakGuard({
			platform: "linux",
			entryPoint: "/nonexistent/pi/cli.js",
		}),
		false,
	);
});

// @lat: [[lat.md/proper-base/tests#Verification#Clipboard leak guard fixture]]
test("subprocess text reader returns empty when no tool succeeds", async () => {
	// An empty PATH makes every candidate tool unresolvable, which is the
	// deterministic offline stand-in for a machine without xclip/xsel/wl-paste.
	assert.equal(await readClipboardTextViaTools({ PATH: "/nonexistent" }), "");
	assert.equal(
		await readClipboardTextViaTools({
			PATH: "/nonexistent",
			WAYLAND_DISPLAY: "wayland-1",
		}),
		"",
	);
});
