import { createHash } from "node:crypto";

export const PROMPT_DISPLAY_ENTRY = "proper-prompt-display";

type Command = { name: string; source: string };
type Message = { content: string | Array<{ type: string; text?: string }> };
type Entry = {
	type: string;
	customType?: string;
	data?: unknown;
};
export type PromptDisplayRecord = { hash: string; raw: string };

export type PromptDisplayController = {
	captureInput(text: string, commands: Command[]): void;
	captureUser(message: Message): void;
	transform(markdown: string): string;
	drain(): PromptDisplayRecord[];
	restore(entries: Entry[]): void;
	clear(): void;
};

export function createPromptDisplay(): PromptDisplayController {
	const display = new Map<string, string>();
	const pending = new Map<string, string>();
	const inputs: Array<string | undefined> = [];

	return {
		captureInput(text, commands) {
			const name = /^\/([^\s]+)/.exec(text)?.[1];
			const prompt = name
				? commands.some(
						(command) => command.name === name && command.source === "prompt",
					)
				: false;
			inputs.push(prompt ? text : undefined);
		},
		captureUser(message) {
			const raw = inputs.shift();
			if (!raw) return;
			const expanded = messageText(message);
			if (!expanded) return;
			const key = hash(expanded);
			display.set(key, raw);
			pending.set(key, raw);
		},
		transform(markdown) {
			return display.get(hash(markdown)) ?? markdown;
		},
		drain() {
			const records = [...pending].map(([hash, raw]) => ({ hash, raw }));
			pending.clear();
			return records;
		},
		restore(entries) {
			display.clear();
			pending.clear();
			inputs.length = 0;
			for (const entry of entries) {
				if (
					entry.type !== "custom" ||
					entry.customType !== PROMPT_DISPLAY_ENTRY
				) {
					continue;
				}
				const records = asRecords(entry.data);
				for (const record of records) display.set(record.hash, record.raw);
			}
		},
		clear() {
			display.clear();
			pending.clear();
			inputs.length = 0;
		},
	};
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text ?? "")
		.join("");
}

function hash(text: string): string {
	return createHash("sha256").update(text.trim()).digest("hex");
}

function asRecords(data: unknown): PromptDisplayRecord[] {
	if (typeof data !== "object" || data === null) return [];
	const prompts = (data as { prompts?: unknown }).prompts;
	if (!Array.isArray(prompts)) return [];
	return prompts.flatMap((record) => {
		if (typeof record !== "object" || record === null) return [];
		const { hash, raw } = record as { hash?: unknown; raw?: unknown };
		return typeof hash === "string" && typeof raw === "string"
			? [{ hash, raw }]
			: [];
	});
}
