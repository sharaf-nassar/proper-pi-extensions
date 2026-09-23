import assert from "node:assert/strict";
import { test } from "node:test";
import { THINKING_LEVELS } from "../src/autocomplete-details.ts";
import properBase from "./base-only-fixture.ts";

type CommandHandler = (args: string, ctx: any) => Promise<void>;
const RESTORE = "__proper-restore-model";
const MODEL = { provider: "cliproxyapi", id: "gpt-6-astra" };
const NO_BRANCH = { getBranch: () => [] };
const encode = (value: unknown) => encodeURIComponent(JSON.stringify(value));

function session(acceptModel = true) {
	const commands = new Map<string, CommandHandler>();
	const notifications: string[] = [];
	const calls: unknown[] = [];
	let shutdown: (() => void) | undefined;
	let active = true;
	let thinkingLevel = "medium";
	let selectedModel: unknown;
	const pi = {
		on(event: string, handler: () => void) {
			if (event === "session_shutdown") shutdown = handler;
		},
		registerCommand(name: string, options: { handler: CommandHandler }) {
			commands.set(name, options.handler);
		},
		getThinkingLevel() {
			assert.ok(active, "outgoing API must not run after replacement");
			return thinkingLevel;
		},
		appendEntry(customType: string, data: unknown) {
			assert.ok(active);
			calls.push({ customType, data });
		},
		setThinkingLevel(level: string) {
			assert.ok(active);
			calls.push(level);
			thinkingLevel = level;
		},
		async setModel(model: unknown) {
			assert.ok(active);
			calls.push(model);
			if (!acceptModel) return false;
			selectedModel = model;
			// Pi reapplies model/global defaults even when reselecting a model.
			thinkingLevel = "medium";
			return true;
		},
	};
	properBase(pi as unknown as Parameters<typeof properBase>[0]);
	const clear = commands.get("clear");
	const restore = commands.get(RESTORE);
	assert.ok(clear);
	assert.ok(restore);
	return {
		pi,
		calls,
		notifications,
		get model() {
			return selectedModel;
		},
		clear,
		restore,
		ctx: {
			modelRegistry: {
				find(provider: string, id: string) {
					assert.deepEqual([provider, id], [MODEL.provider, MODEL.id]);
					return MODEL;
				},
			},
			ui: { notify: (message: string) => notifications.push(message) },
		},
		shutdown() {
			active = false;
			shutdown?.();
		},
	};
}

// @lat: [[lat.md/proper-base/tests#Verification#Model-preserving clear fixture]]
test("clear restores model, every thinking level, and session Fast on the replacement instance", async () => {
	for (const thinkingLevel of THINKING_LEVELS) {
		for (const sessionFast of [false, true]) {
			const settings = { ...MODEL, thinkingLevel, sessionFast };
			const outgoing = session();
			let replacement: ReturnType<typeof session> | undefined;
			try {
				// Seed the outgoing session, including its real in-memory Fast flag.
				await outgoing.restore(encode(settings), outgoing.ctx);
				await outgoing.clear("", {
					model: MODEL,
					sessionManager: NO_BRANCH,
					async newSession(options: any) {
						assert.deepEqual(Object.keys(options), ["withSession"]);
						outgoing.shutdown();
						replacement = session();
						await options.withSession({
							async sendUserMessage(text: string, sendOptions: unknown) {
								assert.deepEqual(sendOptions, { expandPromptTemplates: true });
								assert.equal(text, `/${RESTORE} ${encode(settings)}`);
								assert.ok(replacement);
								await replacement.restore(
									text.slice(text.indexOf(" ") + 1),
									replacement.ctx,
								);
							},
						});
						return { cancelled: false };
					},
				});
				assert.ok(replacement);
				assert.equal(replacement.model, MODEL);
				assert.equal(replacement.pi.getThinkingLevel(), thinkingLevel);
				assert.deepEqual(replacement.calls, [MODEL, thinkingLevel]);
				assert.deepEqual(replacement.notifications, []);

				// Repeating restore is idempotent, not a blind Fast toggle.
				await replacement.restore(encode(settings), replacement.ctx);
				await replacement.clear("", {
					model: MODEL,
					sessionManager: NO_BRANCH,
					async newSession(options: any) {
						await options.withSession({
							async sendUserMessage(text: string) {
								assert.equal(text, `/${RESTORE} ${encode(settings)}`);
							},
						});
						return { cancelled: false };
					},
				});
			} finally {
				replacement?.shutdown();
				outgoing.shutdown();
			}
		}
	}
});

test("clear leaves cancelled, model-less, and failed restores alone", async () => {
	const current = session();
	const settings = { ...MODEL, thinkingLevel: "off", sessionFast: true };
	try {
		await current.restore(encode(settings), current.ctx);
		current.calls.length = 0;
		await current.clear("", {
			model: MODEL,
			sessionManager: NO_BRANCH,
			async newSession() {
				return { cancelled: true };
			},
		});
		assert.deepEqual(current.calls, []);
		assert.equal(current.pi.getThinkingLevel(), "off");
		await current.clear("", {
			model: undefined,
			sessionManager: NO_BRANCH,
			async newSession(options: unknown) {
				assert.equal(options, undefined);
				return { cancelled: false };
			},
		});
		for (const value of [
			"%",
			"%7B",
			encode(null),
			encode({ ...settings, provider: "" }),
			encode({ ...settings, id: "" }),
			encode({ ...settings, thinkingLevel: "invalid" }),
			encode({ ...settings, sessionFast: "true" }),
		]) {
			await current.restore(value, current.ctx);
			assert.equal(
				current.notifications.pop(),
				"Could not restore model after /clear",
			);
		}
		await current.restore(encode(settings), {
			...current.ctx,
			modelRegistry: { find: () => undefined },
		});
		assert.equal(
			current.notifications.pop(),
			`Could not restore model ${MODEL.provider}/${MODEL.id}`,
		);
		assert.deepEqual(current.calls, []);
	} finally {
		current.shutdown();
	}
	const rejected = session(false);
	try {
		await rejected.restore(encode(settings), rejected.ctx);
		assert.deepEqual(rejected.calls, [MODEL]);
		assert.equal(rejected.pi.getThinkingLevel(), "medium");
		assert.equal(
			rejected.notifications.pop(),
			`Could not restore model ${MODEL.provider}/${MODEL.id}`,
		);
	} finally {
		rejected.shutdown();
	}
});

test("clear carries the session context window choice", async () => {
	const outgoing = session();
	const replacement = session();
	const entry = {
		type: "custom",
		customType: "proper-base-context-tokens",
		data: { mode: "max" },
	};
	const settings = {
		...MODEL,
		thinkingLevel: "medium",
		sessionFast: false,
		contextTokens: "max",
	};
	try {
		await outgoing.clear("", {
			model: MODEL,
			sessionManager: { getBranch: () => [entry] },
			async newSession(options: any) {
				await options.withSession({
					async sendUserMessage(text: string) {
						assert.equal(text, `/${RESTORE} ${encode(settings)}`);
						await replacement.restore(
							text.slice(text.indexOf(" ") + 1),
							replacement.ctx,
						);
					},
				});
				return { cancelled: false };
			},
		});
		assert.deepEqual(replacement.calls, [
			MODEL,
			"medium",
			{ customType: entry.customType, data: entry.data },
		]);
		await replacement.restore(
			encode({ ...settings, contextTokens: "huge" }),
			replacement.ctx,
		);
		assert.equal(
			replacement.notifications.pop(),
			"Could not restore model after /clear",
		);
	} finally {
		replacement.shutdown();
		outgoing.shutdown();
	}
});
