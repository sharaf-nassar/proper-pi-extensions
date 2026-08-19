/**
 * Append-only prompt store.
 *
 * pi does not write a session file until the session receives its first
 * assistant message (`session-manager.js:_persist`), so a session spent on
 * slash commands leaves nothing on disk. This store records every submitted
 * prompt immediately, independent of whether pi keeps the session.
 *
 * One file per project, append-only JSONL. Concurrent pi sessions in the same
 * project append to the same file, so entries are written as a single small
 * line each and never rewritten in place.
 */

import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { Prompt } from "./history.ts";

/**
 * Prompts longer than this are not recorded.
 *
 * Keeps each append small enough to land as one write, and recalling a huge
 * paste through the arrow keys is not useful. Long prompts are skipped rather
 * than truncated: a truncated command that looks complete is dangerous to
 * submit again.
 */
export const MAX_PROMPT_CHARS = 4096;

/** Bytes read from the tail of the store. Older entries stay on disk, unread. */
export const READ_TAIL_BYTES = 512 * 1024;

/** Compaction threshold. Below this the file is only ever appended to. */
export const COMPACT_ABOVE_BYTES = 2 * 1024 * 1024;

/** Entries kept when the store is compacted. */
export const COMPACT_KEEP = 2000;

/** pi's session-directory encoding, reused so store files match `sessions/`. */
export function projectKey(cwd: string): string {
	return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export function storePath(agentDir: string, cwd: string): string {
	return join(agentDir, "proper-history", `${projectKey(cwd)}.jsonl`);
}

/** Serialize one entry. Exported so tests do not restate the wire format. */
export function encodeEntry(prompt: Prompt): string {
	return `${JSON.stringify({ t: prompt.text, ts: prompt.ts })}\n`;
}

function decodeEntry(line: string): Prompt | undefined {
	try {
		const parsed = JSON.parse(line) as { t?: unknown; ts?: unknown };
		if (typeof parsed.t !== "string" || !parsed.t) return undefined;
		const ts =
			typeof parsed.ts === "number" && Number.isFinite(parsed.ts)
				? parsed.ts
				: 0;
		return { text: parsed.t, ts };
	} catch {
		return undefined;
	}
}

/**
 * Record one prompt.
 *
 * Never throws. Losing a history entry must not break the editor, and this
 * runs on the submit path of every keystroke-driven send.
 */
export function appendPrompt(
	file: string,
	text: string,
	ts: number = Date.now(),
): boolean {
	const trimmed = text.trim();
	if (!trimmed || trimmed.length > MAX_PROMPT_CHARS) return false;
	try {
		mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
		if (!existsSync(file)) writeFileSync(file, "", { mode: 0o600 });
		appendFileSync(file, encodeEntry({ text: trimmed, ts }));
		return true;
	} catch {
		return false;
	}
}

/**
 * Read recent prompts, oldest first.
 *
 * Only the tail of the file is read, so a store that has grown for months does
 * not slow down startup. A partial line at the read boundary and any damaged
 * line are skipped.
 */
export function readPrompts(
	file: string,
	maxBytes: number = READ_TAIL_BYTES,
): Prompt[] {
	let fd: number | undefined;
	try {
		const size = statSync(file).size;
		if (size === 0) return [];
		const start = Math.max(0, size - maxBytes);
		const length = size - start;
		const buffer = Buffer.allocUnsafe(length);
		fd = openSync(file, "r");
		readSync(fd, buffer, 0, length, start);
		const lines = buffer.toString("utf8").split("\n");
		if (start > 0) lines.shift();
		const prompts: Prompt[] = [];
		for (const line of lines) {
			if (!line) continue;
			const entry = decodeEntry(line);
			if (entry) prompts.push(entry);
		}
		return prompts;
	} catch {
		return [];
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				// A close failure must not turn history loading into a startup failure.
			}
		}
	}
}

/**
 * Trim the store when it has grown past the threshold.
 *
 * Writes a temporary file and renames it, so readers see either the old file or
 * the new one. A prompt appended by another pi session during the rename can be
 * lost; that window is small and the cost is one forgotten history entry.
 */
export function compactIfNeeded(
	file: string,
	aboveBytes: number = COMPACT_ABOVE_BYTES,
	keep: number = COMPACT_KEEP,
): boolean {
	try {
		if (!existsSync(file) || statSync(file).size <= aboveBytes) return false;
		const prompts = readPrompts(file, Number.MAX_SAFE_INTEGER).slice(-keep);
		const temp = `${file}.${process.pid}.tmp`;
		writeFileSync(temp, prompts.map(encodeEntry).join(""), { mode: 0o600 });
		renameSync(temp, file);
		return true;
	} catch {
		return false;
	}
}
