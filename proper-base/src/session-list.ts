/**
 * Fast session metadata for the `/resume` picker.
 *
 * Pi's `SessionManager.list` builds each `SessionInfo` by streaming every line
 * of every session file, `JSON.parse`-ing it, and concatenating every message's
 * text into `allMessagesText`. Only the picker's search reads that field, so a
 * project with hundreds of megabytes of transcripts waits seconds before the
 * first row is drawn.
 *
 * These readers replace that with two cheap passes. Session entries are one
 * JSON object per line, so a byte-prefix test classifies a line without
 * decoding it: the head is read until the first user message, then the file is
 * scanned as raw bytes to count messages and locate the newest rename.
 * `allMessagesText` starts empty and is refilled by a detached backfill, so
 * search recovers on its own instead of blocking the picker.
 */

import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { projectKey } from "./store.ts";

/** Structurally compatible with pi's `SessionInfo`. */
export type SessionInfo = {
	path: string;
	id: string;
	cwd: string;
	name?: string | undefined;
	parentSessionPath?: string | undefined;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
	allMessagesText: string;
};

export type ProgressCallback = (loaded: number, total: number) => void;

const SESSION_PREFIX = '{"type":"session"';
const MESSAGE_PREFIX = '{"type":"message"';
const NAME_PREFIX = '{"type":"session_info"';
const MESSAGE_BYTES = Buffer.from(`\n${MESSAGE_PREFIX}`);
const NAME_BYTES = Buffer.from(`\n${NAME_PREFIX}`);
const CHUNK_BYTES = 1 << 20;

/**
 * Bytes of an entry inspected for its role and write time.
 *
 * Both sit before the message body: `{"type":"message","id":…,"parentId":…,
 * "timestamp":…,"message":{"role":…`.
 */
const ENTRY_HEAD_BYTES = 256;

/** Matches pi's own concurrency, so disk access patterns do not change. */
const MAX_CONCURRENT_READS = 10;

/**
 * Bytes read while looking for the first user message.
 *
 * The first thing a user typed precedes every response it caused, so this only
 * bounds files that never received one.
 */
const MAX_HEAD_BYTES = 4 << 20;

/** Upper bound for re-reading one rename entry, which holds a short name. */
const NAME_ENTRY_BYTES = 8192;

type JsonRecord = Record<string, unknown>;

function parseLine(line: string): JsonRecord | undefined {
	try {
		const parsed: unknown = JSON.parse(line);
		return parsed && typeof parsed === "object"
			? (parsed as JsonRecord)
			: undefined;
	} catch {
		return undefined;
	}
}

function messageOf(entry: JsonRecord): JsonRecord | undefined {
	const message = entry.message;
	return message && typeof message === "object"
		? (message as JsonRecord)
		: undefined;
}

/** Pi joins text blocks with a space and passes string content through. */
export function extractText(message: JsonRecord): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const texts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const part = block as JsonRecord;
		if (part.type === "text" && typeof part.text === "string")
			texts.push(part.text);
	}
	return texts.join(" ");
}

type Head = { header: JsonRecord; firstMessage: string };

/**
 * Read the session header and the first user message.
 *
 * Stops as soon as both are known, so the cost is the head of the file rather
 * than its length.
 */
async function readHead(filePath: string): Promise<Head | undefined> {
	// Closing the interface leaves its input open, and this returns early for
	// almost every file, so the stream itself has to be destroyed.
	const input = createReadStream(filePath, { encoding: "utf8" });
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		let header: JsonRecord | undefined;
		let read = 0;
		for await (const line of lines) {
			if (!line) continue;
			if (!header) {
				// A first line that is not a session header means this is not a
				// session file, and pi drops those from the list.
				if (!line.startsWith(SESSION_PREFIX)) return undefined;
				header = parseLine(line);
				if (!header) return undefined;
				continue;
			}
			read += line.length;
			if (read > MAX_HEAD_BYTES) break;
			if (!line.startsWith(MESSAGE_PREFIX)) continue;
			const message = messageOf(parseLine(line) ?? {});
			if (message?.role !== "user") continue;
			const text = extractText(message);
			if (text) return { header, firstMessage: text };
		}
		return header ? { header, firstMessage: "" } : undefined;
	} finally {
		lines.close();
		input.destroy();
	}
}

type Scan = {
	messageCount: number;
	lastNameOffset: number;
	lastActivity: number | undefined;
};

/**
 * Read one entry's write time, if it is a message pi counts as activity.
 *
 * `head` is the start of an entry; the body beyond it is not needed. Pi prefers
 * the message's own start time, which sits after the content and would cost a
 * full-line read, so this uses the entry's write time instead — later by the
 * duration of the response, which is seconds.
 */
function entryActivityTime(head: string): number | undefined {
	const roleAt = head.indexOf('"role":"');
	if (roleAt < 0) return undefined;
	const role = head.slice(roleAt + 8, head.indexOf('"', roleAt + 8));
	if (role !== "user" && role !== "assistant") return undefined;
	const timeAt = head.indexOf('"timestamp":"');
	if (timeAt < 0 || timeAt > roleAt) return undefined;
	const parsed = new Date(
		head.slice(timeAt + 13, head.indexOf('"', timeAt + 13)),
	).getTime();
	return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Count message entries, locate the newest rename, and track last activity.
 *
 * Nothing is decoded and no line is assembled: single entries reach tens of
 * megabytes, so buffering one would cost more than the scan it serves. Every
 * needle includes the preceding newline, which anchors it to a line start and
 * keeps it from matching text inside a JSON string.
 */
async function scanFile(filePath: string): Promise<Scan> {
	let messageCount = 0;
	let lastNameOffset = -1;
	let lastActivity: number | undefined;
	let offset = 0;
	let carry = Buffer.alloc(0);

	// Consecutive buffers overlap by one entry head, so an entry whose head is
	// cut short here is left for the next buffer, where it is whole. Because
	// `limit` stops one byte before the overlap begins, no entry is taken twice.
	const take = (buffer: Buffer, base: number, limit: number): void => {
		for (let at = 0; at <= limit; ) {
			const found = buffer.indexOf(MESSAGE_BYTES, at);
			if (found < 0 || found > limit) break;
			at = found + MESSAGE_BYTES.length;
			messageCount++;
			const time = entryActivityTime(
				buffer.toString("utf8", found, found + ENTRY_HEAD_BYTES),
			);
			if (time !== undefined && time > (lastActivity ?? 0)) lastActivity = time;
		}
		// Renames are re-read from the file by offset, so a short head is fine.
		for (let at = 0; ; ) {
			const found = buffer.indexOf(NAME_BYTES, at);
			if (found < 0) break;
			lastNameOffset = base + found + 1;
			at = found + NAME_BYTES.length;
		}
	};

	for await (const chunk of createReadStream(filePath, {
		highWaterMark: CHUNK_BYTES,
	}) as AsyncIterable<Buffer>) {
		const buffer = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
		const base = offset - carry.length;
		take(buffer, base, buffer.length - ENTRY_HEAD_BYTES - 1);
		offset += chunk.length;
		// Only the overlap carries, so a single huge entry never accumulates.
		carry = Buffer.from(
			buffer.subarray(Math.max(0, buffer.length - ENTRY_HEAD_BYTES)),
		);
	}
	// At end of file a short head is all there is.
	take(carry, offset - carry.length, carry.length);
	return { messageCount, lastNameOffset, lastActivity };
}

/** Re-read one rename entry. Renames are rare, so this costs one small read. */
async function readName(
	filePath: string,
	offset: number,
): Promise<string | undefined> {
	const handle = await open(filePath, "r");
	try {
		const buffer = Buffer.alloc(NAME_ENTRY_BYTES);
		const { bytesRead } = await handle.read(
			buffer,
			0,
			NAME_ENTRY_BYTES,
			offset,
		);
		const text = buffer.subarray(0, bytesRead).toString("utf8");
		const end = text.indexOf("\n");
		const entry = parseLine(end < 0 ? text : text.slice(0, end));
		if (typeof entry?.name !== "string") return undefined;
		return entry.name.trim() || undefined;
	} finally {
		await handle.close();
	}
}

/**
 * Read one session file's picker metadata.
 *
 * Returns `null` for anything without a session header, matching how pi drops
 * those files from the list.
 */
export async function readSessionInfo(
	filePath: string,
): Promise<SessionInfo | null> {
	try {
		const [stats, head] = await Promise.all([
			stat(filePath),
			readHead(filePath),
		]);
		if (!head) return null;
		const { header } = head;
		const scan = await scanFile(filePath);
		const name =
			scan.lastNameOffset >= 0
				? await readName(filePath, scan.lastNameOffset)
				: undefined;

		const created =
			typeof header.timestamp === "string"
				? new Date(header.timestamp)
				: stats.mtime;
		// The file's own mtime is not a substitute: branching from a session
		// appends to it hours after its last message.
		const modified =
			scan.lastActivity !== undefined && scan.lastActivity > 0
				? new Date(scan.lastActivity)
				: Number.isNaN(created.getTime())
					? stats.mtime
					: created;

		return {
			path: filePath,
			id: typeof header.id === "string" ? header.id : "",
			cwd: typeof header.cwd === "string" ? header.cwd : "",
			name,
			parentSessionPath:
				typeof header.parentSession === "string"
					? header.parentSession
					: undefined,
			created,
			modified,
			messageCount: scan.messageCount,
			firstMessage: head.firstMessage || "(no messages)",
			allMessagesText: "",
		};
	} catch {
		return null;
	}
}

/** Concatenated message text, matching what pi's picker search expects. */
export async function readSearchText(filePath: string): Promise<string> {
	const parts: string[] = [];
	const input = createReadStream(filePath, { encoding: "utf8" });
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (!line.startsWith(MESSAGE_PREFIX)) continue;
			const message = messageOf(parseLine(line) ?? {});
			if (!message) continue;
			if (message.role !== "user" && message.role !== "assistant") continue;
			const text = extractText(message);
			if (text) parts.push(text);
		}
	} catch {
		// A partial read still beats the empty placeholder for search.
	} finally {
		lines.close();
		input.destroy();
	}
	return parts.join(" ");
}

/** Run `task` over `items` with pi's bounded concurrency. */
async function mapConcurrent<T>(
	items: string[],
	task: (item: string) => Promise<T>,
	onDone?: () => void,
): Promise<T[]> {
	const results = new Array<T>(items.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		for (;;) {
			const index = next++;
			const item = items[index];
			if (item === undefined) return;
			results[index] = await task(item);
			onDone?.();
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(MAX_CONCURRENT_READS, items.length) },
			worker,
		),
	);
	return results;
}

async function sessionFiles(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir))
			.filter((file) => file.endsWith(".jsonl"))
			.map((file) => join(dir, file));
	} catch {
		return [];
	}
}

function byNewest(a: SessionInfo, b: SessionInfo): number {
	return b.modified.getTime() - a.modified.getTime();
}

async function collect(
	files: string[],
	onProgress?: ProgressCallback,
): Promise<SessionInfo[]> {
	let loaded = 0;
	const results = await mapConcurrent(files, readSessionInfo, () => {
		loaded++;
		onProgress?.(loaded, files.length);
	});
	return results.filter((info): info is SessionInfo => info !== null);
}

/** Pi's session directory for a working directory. Pi resolves the cwd first. */
export function projectSessionDir(agentDir: string, cwd: string): string {
	return join(resolve(agentDir), "sessions", projectKey(resolve(cwd)));
}

/** Drop-in replacements for `SessionManager.list` and `SessionManager.listAll`. */
export function createSessionListers(agentDir: string) {
	const list = async (
		cwd: string,
		sessionDir?: string,
		onProgress?: ProgressCallback,
	): Promise<SessionInfo[]> => {
		const defaultDir = projectSessionDir(agentDir, cwd);
		const dir = sessionDir ? resolve(sessionDir) : defaultDir;
		// A custom session directory can hold sessions from other projects.
		const filterCwd = sessionDir !== undefined && dir !== defaultDir;
		const resolvedCwd = resolve(cwd);
		const sessions = await collect(await sessionFiles(dir), onProgress);
		return sessions
			.filter(
				(session) =>
					!filterCwd || (!!session.cwd && resolve(session.cwd) === resolvedCwd),
			)
			.sort(byNewest);
	};

	const listAll = async (
		sessionDirOrProgress?: string | ProgressCallback,
		maybeProgress?: ProgressCallback,
	): Promise<SessionInfo[]> => {
		const customDir =
			typeof sessionDirOrProgress === "string"
				? sessionDirOrProgress
				: undefined;
		const onProgress =
			typeof sessionDirOrProgress === "function"
				? sessionDirOrProgress
				: maybeProgress;
		if (customDir) {
			const sessions = await collect(
				await sessionFiles(resolve(customDir)),
				onProgress,
			);
			return sessions.sort(byNewest);
		}
		const root = join(resolve(agentDir), "sessions");
		let projects: string[];
		try {
			projects = (await readdir(root, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
				.map((entry) => join(root, entry.name));
		} catch {
			return [];
		}
		const files = (await Promise.all(projects.map(sessionFiles))).flat();
		const sessions = await collect(files, onProgress);
		return sessions.sort(byNewest);
	};

	return { list, listAll };
}

/**
 * Refill `allMessagesText` on sessions the picker already holds.
 *
 * The picker reads that field on every keystroke, so mutating the objects it
 * was handed restores full-text search without the loader ever waiting for it.
 * Sessions arrive newest-first, which is the order the picker shows them in.
 */
export function backfillSearchText(sessions: SessionInfo[]): () => void {
	let cancelled = false;
	void (async () => {
		for (const session of sessions) {
			if (cancelled) return;
			session.allMessagesText = await readSearchText(session.path);
		}
	})();
	return () => {
		cancelled = true;
	};
}

type Listers = { list: unknown; listAll: unknown };

const FAST_SESSION_LIST = Symbol.for("pi-proper-base.fast-session-list");

/**
 * Point pi's session listing at the fast readers.
 *
 * Pi's `SessionManager` is a module singleton reached through static property
 * lookups, so replacing the two listing methods covers `/resume` without
 * touching the picker. Installation is idempotent: the class outlives every
 * session, so a reload must not stack wrappers.
 */
export function installFastSessionList(target: object, agentDir: string): void {
	const tagged = target as Listers & { [FAST_SESSION_LIST]?: true };
	if (tagged[FAST_SESSION_LIST]) return;
	const fast = createSessionListers(agentDir);
	let cancelBackfill: (() => void) | undefined;
	const served = (sessions: SessionInfo[]): SessionInfo[] => {
		// Only the newest listing is worth completing; a rescan replaces it.
		cancelBackfill?.();
		cancelBackfill = backfillSearchText(sessions);
		return sessions;
	};
	tagged.list = (
		cwd: string,
		sessionDir?: string,
		onProgress?: ProgressCallback,
	) => fast.list(cwd, sessionDir, onProgress).then(served);
	tagged.listAll = (
		sessionDirOrProgress?: string | ProgressCallback,
		onProgress?: ProgressCallback,
	) => fast.listAll(sessionDirOrProgress, onProgress).then(served);
	tagged[FAST_SESSION_LIST] = true;
}
