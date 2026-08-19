import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import properBase from "../index.ts";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { appendPrompt, storePath } from "../src/store.ts";

test("session replay cannot add expanded prompts to editor history", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "proper-base-history-seeding-"));
	const store = storePath(getAgentDir(), cwd);
	appendPrompt(store, "/skill:unslop clean this up", 1);
	const history: string[] = [];
	let submitted: string | undefined;
	let onSessionStart: ((event: unknown, ctx: any) => Promise<void>) | undefined;
	let factory: ((tui: any, theme: any, keybindings: any) => any) | undefined;
	const editor = {
		onSubmit: undefined as ((text: string) => void) | undefined,
		addToHistory(text: string) {
			history.push(text);
		},
		getText: () => "",
		setText() {},
		render: () => [],
	};

	properBase({
		on(event: string, handler: typeof onSessionStart) {
			if (event === "session_start") onSessionStart = handler;
		},
		getCommands: () => [{ name: "skill:unslop", source: "skill" }],
	} as unknown as Parameters<typeof properBase>[0]);

	try {
		await onSessionStart?.(
			{},
			{
				cwd,
				sessionManager: {
					getBranch: () => [],
					getSessionFile: () => undefined,
				},
				ui: {
					getEditorComponent: () => () => editor,
					setEditorComponent(next: typeof factory) {
						factory = next;
					},
				},
			},
		);
		const wrapped = factory?.(
			{ children: [], terminal: { rows: 24 } },
			{
				borderColor: (text: string) => text,
				selectList: { description: (text: string) => text },
			},
			new KeybindingsManager(),
		);
		wrapped.onSubmit = (text: string) => {
			submitted = text;
		};

		wrapped.addToHistory(
			'<skill name="unslop" location="/skills/unslop/SKILL.md">\nexpanded body\n</skill>\n\nclean this up',
		);
		assert.deepEqual(history, ["/skill:unslop clean this up"]);

		wrapped.onSubmit("/skill:unslop next task");
		assert.equal(submitted, "/skill:unslop next task");
		assert.deepEqual(history, [
			"/skill:unslop clean this up",
			"/skill:unslop next task",
		]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
		await rm(store, { force: true });
	}
});
