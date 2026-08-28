/**
 * pi's bundled `@mariozechner/clipboard` addon constructs a fresh clipboard-rs
 * `ClipboardContext` on every exported call. On X11 each context opens two X
 * connections and a detached service thread, and the crate defines no `Drop`
 * for the context, so every clipboard read leaks both connections for the life
 * of the pi process. Days of pasting across long-lived sessions exhaust Xorg's
 * ~256 client slots, after which every X client on the machine — including the
 * `xclip` calls behind image paste — fails with "Maximum number of clients
 * reached".
 *
 * pi already distrusts the crate for Linux clipboard writes and shells out to
 * platform tools there. This guard extends that policy to the two Linux read
 * paths that still call the addon: `readClipboardText()` (which has no
 * subprocess fallback of its own) and the `hasImage()` probe that runs ahead
 * of pi's complete `xclip`/`wl-paste` image path. macOS and Windows keep the
 * addon: pi has no subprocess clipboard implementation on either.
 */

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";

/** Installed once per process; the flag lives on pi's cached module object. */
const PATCHED = Symbol.for("proper-base.clipboard-leak-guard");

// Mirrors pi's own READ_CLIPBOARD_OPTIONS in dist/utils/clipboard.js.
const READ_TIMEOUT_MS = 5000;
const READ_MAX_BUFFER = 50 * 1024 * 1024;

interface NativeClipboardModule {
	getText: unknown;
	hasImage: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Resolve the exact module instance pi loaded. pi's `clipboard-native.js`
 * requires the addon from inside the pi package, and Node's CJS cache is keyed
 * by resolved filename, so a `createRequire` rooted anywhere in that package
 * returns the same exports object. `process.argv[1]` is pi's entry script; its
 * realpath lands inside the package in both the plain and bundled layouts.
 */
function resolveNativeClipboard(
	entryPoint: string | undefined,
): NativeClipboardModule | null {
	if (!entryPoint) return null;
	const bases = [entryPoint];
	try {
		bases.unshift(realpathSync(entryPoint));
	} catch {
		// Keep the raw entry point as the only candidate.
	}
	for (const base of bases) {
		try {
			const loaded: unknown = createRequire(base)("@mariozechner/clipboard");
			if (isRecord(loaded)) return loaded as unknown as NativeClipboardModule;
		} catch {
			// Not resolvable from this base; try the next one.
		}
	}
	return null;
}

/** One bounded asynchronous tool run; null means this tool cannot serve. */
function runTool(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
): Promise<string | null> {
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, {
				env,
				stdio: ["ignore", "pipe", "ignore"],
			});
		} catch {
			resolve(null);
			return;
		}
		let timer: NodeJS.Timeout | undefined;
		let settled = false;
		const finish = (value: string | null): void => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			resolve(value);
		};
		// The timeout bounds a stuck clipboard owner; the size cap mirrors pi's
		// own read bounds and stops a pathological selection from accumulating.
		timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(null);
		}, READ_TIMEOUT_MS);
		timer.unref?.();
		const chunks: Buffer[] = [];
		let size = 0;
		child.on("error", () => finish(null));
		child.stdout?.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > READ_MAX_BUFFER) {
				child.kill("SIGKILL");
				finish(null);
				return;
			}
			chunks.push(chunk);
		});
		child.on("close", (code) => {
			finish(code === 0 ? Buffer.concat(chunks).toString("utf8") : null);
		});
	});
}

/**
 * Read clipboard text through the platform tools pi already trusts for
 * writes. Fully asynchronous: runtime extensions never synchronously wait on
 * child processes, and pi awaits `getText()` anyway.
 */
export async function readClipboardTextViaTools(
	env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
	const attempts: Array<[string, string[]]> = env.WAYLAND_DISPLAY
		? [
				["wl-paste", ["--no-newline", "--type", "text"]],
				["xclip", ["-selection", "clipboard", "-o"]],
			]
		: [
				["xclip", ["-selection", "clipboard", "-o"]],
				["xsel", ["--clipboard", "--output"]],
			];
	for (const [command, args] of attempts) {
		const text = await runTool(command, args, env);
		if (text !== null) return text;
	}
	return "";
}

export interface ClipboardGuardOptions {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	entryPoint?: string;
	/** Test seam; defaults to resolving pi's cached addon instance. */
	loadModule?: () => NativeClipboardModule | null;
	/** Test seam; defaults to the subprocess reader above. */
	readText?: () => string | Promise<string>;
}

// @lat: [[lat.md/proper-base/proper-base#proper-base#Clipboard leak guard]]
export function installClipboardLeakGuard(
	options: ClipboardGuardOptions = {},
): boolean {
	const platform = options.platform ?? process.platform;
	if (platform !== "linux") return false;
	const native = options.loadModule
		? options.loadModule()
		: resolveNativeClipboard(options.entryPoint ?? process.argv[1]);
	if (
		!native ||
		typeof native.getText !== "function" ||
		typeof native.hasImage !== "function"
	) {
		return false;
	}
	const flags = native as unknown as Record<PropertyKey, unknown>;
	if (flags[PATCHED]) return true;
	const readText =
		options.readText ?? (() => readClipboardTextViaTools(options.env));
	// pi awaits getText(); an async wrapper keeps that contract, and an empty
	// read becomes `null` through pi's own `text || null`.
	native.getText = async () => readText();
	// hasImage() gates pi's only getImageBinary() call, and on Linux pi's own
	// xclip/wl-paste image path runs immediately after a false, so image paste
	// loses nothing. setText and getImageBinary stay native: pi never calls
	// either on Linux (writes already use the platform tools).
	native.hasImage = () => false;
	flags[PATCHED] = true;
	return true;
}
