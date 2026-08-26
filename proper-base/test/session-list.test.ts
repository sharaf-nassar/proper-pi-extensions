import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { SessionManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js";

import {
	backfillSearchText,
	createSessionListers,
	installFastSessionList,
	projectSessionDir,
	readSearchText,
	readSessionInfo,
	type SessionInfo,
} from "../src/session-list.ts";

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "proper-sessions-"));
}

type Line = Record<string, unknown>;

function header(cwd: string, extra: Line = {}): Line {
	return {
		type: "session",
		version: 3,
		id: "01a00000-0000-7000-8000-000000000000",
		timestamp: "2026-08-01T10:00:00.000Z",
		cwd,
		...extra,
	};
}

function message(
	role: string,
	text: string,
	timestamp = "2026-08-01T10:01:00.000Z",
): Line {
	return {
		type: "message",
		id: "aaaaaaaa",
		parentId: "bbbbbbbb",
		timestamp,
		message: { role, content: [{ type: "text", text }], timestamp: 1 },
	};
}

function writeSession(dir: string, name: string, lines: Line[]): string {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, name);
	writeFileSync(
		file,
		`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
	);
	return file;
}

test("readSessionInfo reports header fields, counts, and first user text", async () => {
	const dir = scratch();
	const file = writeSession(dir, "a.jsonl", [
		header("/work/app", { parentSession: "/work/app/parent.jsonl" }),
		{ type: "model_change", id: "m1" },
		message("user", "first prompt"),
		message("assistant", "an answer"),
		message("toolResult", "tool output"),
	]);

	const info = await readSessionInfo(file);
	assert.ok(info);
	assert.equal(info.id, "01a00000-0000-7000-8000-000000000000");
	assert.equal(info.cwd, "/work/app");
	assert.equal(info.parentSessionPath, "/work/app/parent.jsonl");
	assert.equal(info.messageCount, 3);
	assert.equal(info.firstMessage, "first prompt");
	assert.equal(info.created.toISOString(), "2026-08-01T10:00:00.000Z");
	assert.equal(info.allMessagesText, "");
});

test("readSessionInfo joins text blocks the way pi's picker does", async () => {
	const dir = scratch();
	const file = writeSession(dir, "a.jsonl", [
		header("/work/app"),
		{
			type: "message",
			id: "aaaaaaaa",
			parentId: null,
			timestamp: "2026-08-01T10:01:00.000Z",
			message: {
				role: "user",
				content: [
					{ type: "text", text: "one" },
					{ type: "image", data: "ignored" },
					{ type: "text", text: "two" },
				],
			},
		},
	]);

	assert.equal((await readSessionInfo(file))?.firstMessage, "one two");
});

test("readSessionInfo takes the last activity time, not the file mtime", async () => {
	const dir = scratch();
	const file = writeSession(dir, "a.jsonl", [
		header("/work/app"),
		message("user", "hello", "2026-08-01T10:01:00.000Z"),
		message("assistant", "hi", "2026-08-01T10:02:00.000Z"),
		// Branching appends to a finished session long after its last message.
		{ type: "label", id: "l1", timestamp: "2026-08-02T22:00:00.000Z" },
	]);

	assert.equal(
		(await readSessionInfo(file))?.modified.toISOString(),
		"2026-08-01T10:02:00.000Z",
	);
});

test("readSessionInfo tracks renames wherever they appear, latest wins", async () => {
	const dir = scratch();
	const named = writeSession(dir, "a.jsonl", [
		header("/work/app"),
		message("user", "hello"),
		{ type: "session_info", id: "s1", name: "first name" },
		message("assistant", "hi"),
		{ type: "session_info", id: "s2", name: "  renamed  " },
	]);
	assert.equal((await readSessionInfo(named))?.name, "renamed");

	const cleared = writeSession(dir, "b.jsonl", [
		header("/work/app"),
		message("user", "hello"),
		{ type: "session_info", id: "s1", name: "gone" },
		{ type: "session_info", id: "s2" },
	]);
	assert.equal((await readSessionInfo(cleared))?.name, undefined);
});

test("readSessionInfo counts a message that starts inside the chunk overlap", async () => {
	const dir = scratch();
	// The scanner overlaps reads so an entry near a chunk boundary still has its
	// role and time in view. An entry starting inside that overlap is seen by
	// two chunks and must be counted once, with its time still read.
	const chunk = 1 << 20;
	const head = `${JSON.stringify(header("/work/app"))}\n`;
	const empty = JSON.stringify(message("user", ""));
	// Land the newline that ends the first message 64 bytes before the boundary.
	const padding = chunk - 64 - head.length - empty.length;
	assert.ok(padding > 0);
	const first = JSON.stringify(message("user", "x".repeat(padding)));
	assert.equal(head.length + first.length, chunk - 64);

	const file = join(dir, "a.jsonl");
	writeFileSync(
		file,
		`${head + first}\n${[
			message("assistant", "straddling", "2026-08-05T11:00:00.000Z"),
			message("assistant", "x".repeat(2 * chunk), "2026-08-05T10:00:00.000Z"),
			{ type: "session_info", id: "s1", name: "big" },
		]
			.map((line) => JSON.stringify(line))
			.join("\n")}\n`,
	);

	const info = await readSessionInfo(file);
	assert.equal(info?.messageCount, 3);
	assert.equal(info?.modified.toISOString(), "2026-08-05T11:00:00.000Z");
	assert.equal(info?.name, "big");
	assert.equal(info?.firstMessage.length, padding);
});

// Linux exposes the process's descriptors directly; elsewhere this rule is
// covered only by the reads themselves succeeding.
const FD_DIR = "/proc/self/fd";

test("reading a head releases its file descriptor despite stopping early", {
	skip: !existsSync(FD_DIR),
}, async () => {
	const dir = scratch();
	const files = Array.from({ length: 40 }, (_, index) =>
		writeSession(dir, `s${index}.jsonl`, [
			header("/work/app"),
			message("user", "stop here"),
			// Entries after the first user message are never decoded, so the
			// head read abandons the stream instead of draining it.
			message("assistant", "x".repeat(64 * 1024)),
		]),
	);

	const before = readdirSync(FD_DIR).length;
	for (const file of files) await readSessionInfo(file);
	for (const file of files.slice(0, 10)) await readSearchText(file);
	assert.ok(
		readdirSync(FD_DIR).length <= before + 2,
		`descriptors grew from ${before} to ${readdirSync(FD_DIR).length}`,
	);
});

test("readSessionInfo rejects files that are not sessions", async () => {
	const dir = scratch();
	const stray = join(dir, "stray.jsonl");
	writeFileSync(stray, `${JSON.stringify(message("user", "orphan"))}\n`);
	assert.equal(await readSessionInfo(stray), null);
	assert.equal(await readSessionInfo(join(dir, "missing.jsonl")), null);
});

test("readSessionInfo survives a session with no messages", async () => {
	const dir = scratch();
	const file = writeSession(dir, "a.jsonl", [header("/work/app")]);
	const info = await readSessionInfo(file);
	assert.equal(info?.messageCount, 0);
	assert.equal(info?.firstMessage, "(no messages)");
	assert.equal(info?.modified.toISOString(), "2026-08-01T10:00:00.000Z");
});

test("readSearchText concatenates user and assistant text only", async () => {
	const dir = scratch();
	const file = writeSession(dir, "a.jsonl", [
		header("/work/app"),
		message("user", "question"),
		message("assistant", "answer"),
		message("toolResult", "noise"),
	]);
	assert.equal(await readSearchText(file), "question answer");
});

test("list sorts newest first and reads the project's own directory", async () => {
	const agentDir = scratch();
	const dir = projectSessionDir(agentDir, "/work/app");
	const { list } = createSessionListers(agentDir);
	assert.deepEqual(await list("/work/app"), []);

	writeSession(dir, "old.jsonl", [
		header("/work/app"),
		message("user", "older", "2026-08-01T10:00:00.000Z"),
	]);
	writeSession(dir, "new.jsonl", [
		header("/work/app"),
		message("user", "newer", "2026-08-03T10:00:00.000Z"),
	]);
	writeFileSync(join(dir, "notes.txt"), "ignored");

	assert.deepEqual(
		(await list("/work/app")).map((session) => session.firstMessage),
		["newer", "older"],
	);
});

test("list filters a shared custom directory down to the current cwd", async () => {
	const agentDir = scratch();
	const shared = scratch();
	writeSession(shared, "mine.jsonl", [
		header("/work/app"),
		message("user", "mine"),
	]);
	writeSession(shared, "other.jsonl", [
		header("/work/other"),
		message("user", "other"),
	]);

	const { list } = createSessionListers(agentDir);
	assert.deepEqual(
		(await list("/work/app", shared)).map((session) => session.firstMessage),
		["mine"],
	);
	// The project's own directory is never treated as a shared one.
	const own = projectSessionDir(agentDir, "/work/app");
	writeSession(own, "kept.jsonl", [header(""), message("user", "no cwd")]);
	assert.deepEqual(
		(await list("/work/app", own)).map((session) => session.firstMessage),
		["no cwd"],
	);
});

test("listAll spans every project directory and reports progress", async () => {
	const agentDir = scratch();
	writeSession(projectSessionDir(agentDir, "/work/app"), "a.jsonl", [
		header("/work/app"),
		message("user", "app", "2026-08-02T10:00:00.000Z"),
	]);
	writeSession(projectSessionDir(agentDir, "/work/other"), "b.jsonl", [
		header("/work/other"),
		message("user", "other", "2026-08-04T10:00:00.000Z"),
	]);

	const { listAll } = createSessionListers(agentDir);
	const progress: number[] = [];
	const sessions = await listAll((loaded) => progress.push(loaded));
	assert.deepEqual(
		sessions.map((session) => session.firstMessage),
		["other", "app"],
	);
	assert.deepEqual(progress, [1, 2]);
});

test("backfillSearchText refills the objects the picker already holds", async () => {
	const dir = scratch();
	const file = writeSession(dir, "a.jsonl", [
		header("/work/app"),
		message("user", "searchable"),
	]);
	const info = (await readSessionInfo(file)) as SessionInfo;
	assert.equal(info.allMessagesText, "");

	backfillSearchText([info]);
	for (let waited = 0; waited < 50 && !info.allMessagesText; waited++) {
		await delay(10);
	}
	assert.equal(info.allMessagesText, "searchable");
});

// This is the contract the whole module depends on. Pi renaming either method
// or reordering their arguments would otherwise leave the picker quietly slow.
test("the installed listers match pi's own SessionManager surface", async () => {
	const sessionDir = scratch();
	writeSession(sessionDir, "a.jsonl", [
		header("/work/app"),
		message("user", "through pi"),
	]);
	assert.equal(typeof SessionManager.list, "function");
	assert.equal(typeof SessionManager.listAll, "function");

	installFastSessionList(SessionManager, scratch());
	const sessions = await SessionManager.list("/work/app", sessionDir);
	assert.deepEqual(
		sessions.map((session) => session.firstMessage),
		["through pi"],
	);
});

test("installFastSessionList replaces both listers exactly once", async () => {
	const agentDir = scratch();
	writeSession(projectSessionDir(agentDir, "/work/app"), "a.jsonl", [
		header("/work/app"),
		message("user", "installed"),
	]);

	const original = {
		list: async () => [] as SessionInfo[],
		listAll: async () => [] as SessionInfo[],
	};
	const target: typeof original = { ...original };
	installFastSessionList(target, agentDir);
	const patched = target.list;
	assert.notEqual(patched, original.list);
	installFastSessionList(target, agentDir);
	assert.equal(target.list, patched);

	const sessions = await (
		target.list as unknown as (cwd: string) => Promise<SessionInfo[]>
	)("/work/app");
	assert.deepEqual(
		sessions.map((session) => session.firstMessage),
		["installed"],
	);
	// Search text arrives after the picker already has its rows.
	for (let waited = 0; waited < 50 && !sessions[0]?.allMessagesText; waited++) {
		await delay(10);
	}
	assert.equal(sessions[0]?.allMessagesText, "installed");
});
