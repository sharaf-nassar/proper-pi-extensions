import { createHash } from "node:crypto";
import {
	type ContextEditEntry,
	parseSkillBlock,
} from "@earendil-works/pi-coding-agent";

export const SKILL_CONTEXT_ENTRY = "proper-base-skill-context";
export const SKILL_CONTEXT_TOOL = "skill_context";
/** Full instruction bodies only. Overflow requires explicit deselection. */
export const SKILL_CONTEXT_CHARS = 64_000;
const RESTORE_START = "<proper_base_skill_context>\n";
const RESTORE_END = "\n</proper_base_skill_context>\n\n";

export type SkillSnapshot = {
	name: string;
	location: string;
	block: string;
	hash: string;
};
export type SkillSelection = SkillSnapshot & {
	selected: boolean;
	source: "user" | "model";
};
export type SkillChange =
	| { action: "load"; blocks: string[] }
	| { action: "remove"; locations: string[] }
	| { action: "clear" };
export type ContextMessage = {
	role: string;
	content?: unknown;
	summary?: string;
	toolName?: string;
	isError?: boolean;
};
export type SkillBranchEntry = {
	type: string;
	id?: string;
	targetId?: string;
	replacement?: ContextEditEntry["replacement"];
	message?: ContextMessage;
	customType?: string;
	data?: unknown;
};
type TextPart = { type: "text"; text: string };

export class SkillContextError extends Error {}

export function skillSnapshot(block: string): SkillSnapshot | undefined {
	const parsed = parseSkillBlock(block);
	if (!parsed || parsed.userMessage) return undefined;
	return {
		name: parsed.name,
		location: parsed.location,
		block,
		hash: createHash("sha256").update(block).digest("hex"),
	};
}

/** Only leading Pi skill blocks are instructions, never quoted inline examples. */
export function splitSkillText(text: string): {
	skills: SkillSnapshot[];
	request: string;
} {
	const skills: SkillSnapshot[] = [];
	let request = text;
	while (request.startsWith('<skill name="')) {
		const parsed = parseSkillBlock(request);
		if (!parsed) break;
		const block = `<skill name="${parsed.name}" location="${parsed.location}">\n${parsed.content}\n</skill>`;
		const snapshot = skillSnapshot(block);
		if (!snapshot) break;
		skills.push(snapshot);
		request = parsed.userMessage ?? "";
	}
	return { skills, request };
}

function isTextPart(value: unknown): value is TextPart {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "text" &&
		typeof (value as { text?: unknown }).text === "string"
	);
}

function texts(message: ContextMessage): string[] {
	if (typeof message.content === "string") return [message.content];
	return Array.isArray(message.content)
		? message.content.filter(isTextPart).map((part) => part.text)
		: [];
}

function skillMessage(message: ContextMessage): boolean {
	return (
		message.role === "user" ||
		(message.role === "toolResult" &&
			message.toolName === SKILL_CONTEXT_TOOL &&
			message.isError !== true)
	);
}

function mapText<T extends ContextMessage>(
	message: T,
	transform: (text: string) => string,
): T {
	if (typeof message.content === "string") {
		const content = transform(message.content);
		return content === message.content ? message : { ...message, content };
	}
	if (!Array.isArray(message.content)) return message;
	let changed = false;
	const content = message.content.map((part) => {
		if (!isTextPart(part)) return part;
		const text = transform(part.text);
		if (text === part.text) return part;
		changed = true;
		return { ...part, text };
	});
	return changed ? { ...message, content } : message;
}

/** Apply branch-local edits before interpreting invocation or control records. */
export function selectedSkills(branch: SkillBranchEntry[]): SkillSelection[] {
	const edits = new Map<string, ContextEditEntry["replacement"]>();
	for (const entry of branch) {
		if (entry.type === "context_edit" && entry.targetId)
			edits.set(entry.targetId, entry.replacement ?? null);
	}
	const state = new Map<string, SkillSelection>();
	const load = (block: string, source: SkillSelection["source"]) => {
		for (const skill of splitSkillText(block).skills) {
			const previous = state.get(skill.location);
			state.delete(skill.location);
			state.set(skill.location, {
				...skill,
				selected: true,
				source:
					previous?.selected && previous.source === "user" ? "user" : source,
			});
		}
	};
	for (const entry of branch) {
		if (entry.type === "message" && entry.message) {
			let message = entry.message;
			if (entry.id && edits.has(entry.id)) {
				const replacement = edits.get(entry.id);
				if (!replacement) continue;
				message = { ...message, content: replacement.content };
			}
			if (skillMessage(message))
				for (const text of texts(message))
					load(text, message.role === "user" ? "user" : "model");
		} else if (
			entry.type === "custom" &&
			entry.customType === SKILL_CONTEXT_ENTRY &&
			entry.data &&
			typeof entry.data === "object"
		) {
			const data = entry.data as Partial<SkillChange>;
			if (data.action === "load" && Array.isArray(data.blocks)) {
				for (const block of data.blocks)
					if (typeof block === "string") load(block, "user");
			} else if (data.action === "clear") {
				for (const skill of state.values()) skill.selected = false;
			} else if (data.action === "remove" && Array.isArray(data.locations)) {
				for (const location of data.locations) {
					const skill = state.get(location);
					if (skill) skill.selected = false;
				}
			}
		}
	}
	return [...state.values()];
}

export function assertSkillBudget(
	skills: SkillSnapshot[],
	maxChars = SKILL_CONTEXT_CHARS,
): void {
	const total = skills.reduce((sum, skill) => sum + skill.block.length + 2, 0);
	if (total > maxChars)
		throw new SkillContextError(
			`Selected skill instructions need ${total} characters; limit is ${maxChars}. No instructions were truncated. Use /skill-context remove <name> or /skill-context clear before continuing.`,
		);
}

function stripRestore(text: string): string {
	const start = text.indexOf(RESTORE_START);
	if (start < 0) return text;
	const end = text.indexOf(RESTORE_END, start);
	return end < 0
		? text
		: text.slice(0, start) + text.slice(end + RESTORE_END.length);
}

/**
 * Project full selected snapshots without changing stored messages. Restoring
 * reference instructions is not a new workflow invocation. The branch is the
 * registry, so resume, forks, context edits and /clear need no second store.
 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Skill context]]
 */
export function pinSkillContext<T extends ContextMessage>(
	messages: T[],
	branch: SkillBranchEntry[],
	maxChars = SKILL_CONTEXT_CHARS,
): T[] {
	const selections = selectedSkills(branch);
	const active = selections.filter((skill) => skill.selected);
	assertSkillBudget(active, maxChars);
	const state = new Map(selections.map((skill) => [skill.location, skill]));
	const present = new Set<string>();
	const next = messages.map((original) => {
		let message = original;
		if (message.role === "compactionSummary" && message.summary) {
			const summary = stripRestore(message.summary);
			if (summary !== message.summary) message = { ...message, summary };
		}
		if (!skillMessage(message)) return message;
		return mapText(message, (raw) => {
			const text = stripRestore(raw);
			const { skills, request } = splitSkillText(text);
			if (!skills.length) return text;
			let changed = false;
			const blocks: string[] = [];
			const notes: string[] = [];
			for (const skill of skills) {
				const selection = state.get(skill.location);
				let reason: string | undefined;
				if (selection && !selection.selected) reason = "inactive";
				else if (selection && selection.hash !== skill.hash)
					reason = "superseded";
				else if (present.has(skill.hash))
					reason = "already loaded earlier in this conversation";
				else present.add(skill.hash);
				if (!reason) blocks.push(skill.block);
				else {
					changed = true;
					notes.push(
						`[skill ${JSON.stringify(skill.name)} is ${reason}; this request remains a separate request]`,
					);
				}
			}
			return changed
				? [...blocks, ...notes, ...(request ? [request] : [])].join("\n\n")
				: text;
		});
	});
	const missing = active.filter((skill) => !present.has(skill.hash));
	if (missing.length || selections.some((skill) => !skill.selected)) {
		const selected =
			active
				.map((skill) => `${skill.name} [${skill.hash.slice(0, 12)}]`)
				.join(", ") || "none";
		const restored = `${RESTORE_START}Currently selected skills: ${selected}. Only these selected versions apply; other historical skill guidance is inactive even when mentioned in a summary. Retained reference instructions follow. Apply only where relevant to the current request. Do not repeat completed actions or treat restoration as a new invocation. Explicit user priorities and higher-priority instructions still apply; report material conflicts rather than assuming skill order decides them.\n\n${missing.map((skill) => skill.block).join("\n\n")}${RESTORE_END}`;
		// Anchor after the latest summary; a split tool loop may have no user
		// message left. Append to that summary instead of breaking tool pairs.
		let summary = -1;
		for (let i = 0; i < next.length; i++)
			if (next[i]?.role === "compactionSummary") summary = i;
		const anchor = next.findIndex(
			(message, i) => i > summary && message.role === "user",
		);
		if (anchor >= 0) {
			let added = false;
			const message = next[anchor] as T;
			next[anchor] = mapText(message, (text) => {
				if (added) return text;
				added = true;
				return restored + text;
			});
			if (!added && Array.isArray(message.content))
				next[anchor] = {
					...message,
					content: [{ type: "text", text: restored }, ...message.content],
				};
		} else if (summary >= 0) {
			const message = next[summary] as T;
			next[summary] = {
				...message,
				summary: `${restored}${message.summary ?? ""}`,
			};
		}
	}
	if (next.every((message, index) => message === messages[index]))
		return messages;
	return next;
}
