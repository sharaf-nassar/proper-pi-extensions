import assert from "node:assert/strict";
import { test } from "node:test";
import properBase from "../index.ts";

type CommandHandler = (args: string, ctx: any) => Promise<void>;

// @lat: [[lat.md/proper-base/tests#Verification#Model-preserving clear fixture]]
test("clear starts a new session and restores the exact current model", async () => {
	const commands = new Map<string, CommandHandler>();
	const notifications: string[] = [];
	let selectedModel: unknown;
	const pi = {
		on() {},
		registerCommand(name: string, options: { handler: CommandHandler }) {
			commands.set(name, options.handler);
		},
		async setModel(model: unknown) {
			selectedModel = model;
			return true;
		},
	} as unknown as Parameters<typeof properBase>[0];
	properBase(pi);

	const clear = commands.get("clear");
	const restore = commands.get("__proper-restore-model");
	assert.ok(clear);
	assert.ok(restore);

	const currentModel = {
		provider: "cliproxyapi",
		id: "claude-opus-5-20250929",
		api: "anthropic-messages",
	};
	let newSessionOptions: any;
	let sentCommand: { text: string; options: unknown } | undefined;
	await clear("", {
		model: currentModel,
		async newSession(options: any) {
			newSessionOptions = options;
			await options.withSession({
				async sendUserMessage(text: string, options: unknown) {
					sentCommand = { text, options };
				},
			});
			return { cancelled: false };
		},
	});

	assert.deepEqual(Object.keys(newSessionOptions), ["withSession"]);
	assert.ok(sentCommand);
	assert.match(sentCommand.text, /^\/__proper-restore-model /);
	assert.deepEqual(sentCommand.options, { expandPromptTemplates: true });

	const encodedReference = sentCommand.text.slice(
		sentCommand.text.indexOf(" ") + 1,
	);
	assert.deepEqual(JSON.parse(decodeURIComponent(encodedReference)), {
		provider: currentModel.provider,
		id: currentModel.id,
	});
	let lookup: [string, string] | undefined;
	const restoredModel = { ...currentModel, name: "Opus" };
	await restore(encodedReference, {
		modelRegistry: {
			find(provider: string, id: string) {
				lookup = [provider, id];
				return restoredModel;
			},
		},
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
		},
	});
	assert.deepEqual(lookup, [currentModel.provider, currentModel.id]);
	assert.equal(selectedModel, restoredModel);
	assert.equal(notifications.length, 0);

	await restore("%", {
		modelRegistry: { find: () => undefined },
		ui: { notify: (message: string) => notifications.push(message) },
	});
	assert.deepEqual(notifications, ["Could not restore model after /clear"]);

	let emptySessionOptions: unknown = "not called";
	await clear("", {
		model: undefined,
		async newSession(options: unknown) {
			emptySessionOptions = options;
			return { cancelled: false };
		},
	});
	assert.equal(emptySessionOptions, undefined);
});
