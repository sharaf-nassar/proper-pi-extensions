import { parseSkillBlock } from "@earendil-works/pi-coding-agent";

/**
 * Characters kept from a single skill body when it is carried across a
 * compaction. Roughly four characters per token, matching the estimate Pi's
 * own compaction uses.
 */
const MAX_SKILL_CHARS = 16000;
/** Combined character budget for every skill carried across one compaction. */
const MAX_CARRY_CHARS = 24000;
const TRUNCATED = "\n\n[skill content truncated to fit the context budget]";

type ContextMessage = {
	role: string;
	content?: unknown;
};
type TextPart = { type: "text"; text: string };
type SessionEntry = {
	type: string;
	message?: { role?: string; content?: unknown };
};
type Invocation = { name: string; block: string };

function isTextPart(value: unknown): value is TextPart {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "text" &&
		typeof (value as { text?: unknown }).text === "string"
	);
}

/**
 * Pi renders a skill invocation as one text part holding the block followed by
 * the user's own request, so both live in a single message.
 */
function readInvocation(
	text: string,
): { name: string; block: string; request: string } | undefined {
	const parsed = parseSkillBlock(text);
	if (!parsed) return undefined;
	return {
		name: parsed.name,
		block: `<skill name="${parsed.name}" location="${parsed.location}">\n${parsed.content}\n</skill>`,
		request: parsed.userMessage ?? "",
	};
}

function messageInvocation(
	message: ContextMessage | SessionEntry["message"],
): ReturnType<typeof readInvocation> {
	const content = message?.content;
	if (typeof content === "string") return readInvocation(content);
	if (!Array.isArray(content)) return undefined;
	for (const part of content) {
		if (!isTextPart(part)) continue;
		const invocation = readInvocation(part.text);
		if (invocation) return invocation;
	}
	return undefined;
}

function replaceInvocationText(
	message: ContextMessage,
	replacement: string,
): ContextMessage {
	const content = message.content;
	if (typeof content === "string") {
		return { ...message, content: replacement };
	}
	if (!Array.isArray(content)) return message;
	let done = false;
	const next = content.map((part) => {
		if (done || !isTextPart(part) || !parseSkillBlock(part.text)) return part;
		done = true;
		return { ...part, text: replacement };
	});
	return done ? { ...message, content: next } : message;
}

function prependText(message: ContextMessage, prefix: string): ContextMessage {
	const content = message.content;
	if (typeof content === "string") {
		return { ...message, content: `${prefix}${content}` };
	}
	if (!Array.isArray(content)) return message;
	const index = content.findIndex(isTextPart);
	if (index < 0) {
		return {
			...message,
			content: [{ type: "text", text: prefix }, ...content],
		};
	}
	const part = content[index] as TextPart;
	const next = [...content];
	next[index] = { ...part, text: `${prefix}${part.text}` };
	return { ...message, content: next };
}

function truncate(block: string, limit: number): string {
	return block.length <= limit ? block : block.slice(0, limit) + TRUNCATED;
}

/**
 * Keep every invoked skill present exactly once in the outgoing context.
 *
 * Pi inlines the whole `SKILL.md` body into a user message and then treats that
 * message like any other: re-invoking a skill appends a second full copy, and
 * compaction summarizes the copy away while the model keeps working under
 * instructions it can no longer read. This collapses repeats to a short note
 * and carries the most recent body across a compaction boundary, bounded by a
 * character budget so the restored text cannot re-trigger the compaction that
 * just ran.
 *
 * The first copy is never rewritten, so the cached request prefix stays byte
 * stable across turns.
 */
export function pinSkillContext<T extends ContextMessage>(
	messages: T[],
	branch: SessionEntry[],
): T[] {
	const seen = new Set<string>();
	let changed = false;

	let next = messages.map((message) => {
		if (message.role !== "user") return message;
		const invocation = messageInvocation(message);
		if (!invocation) return message;
		if (!seen.has(invocation.block)) {
			seen.add(invocation.block);
			return message;
		}
		changed = true;
		const note = `[skill "${invocation.name}" is already loaded earlier in this conversation]`;
		return replaceInvocationText(
			message,
			invocation.request ? `${note}\n\n${invocation.request}` : note,
		) as T;
	});

	const carried = carryAcrossCompaction(next, branch, seen);
	if (!carried) return changed ? next : messages;

	const anchor = restoreAnchor(next);
	if (anchor < 0) return changed ? next : messages;
	next = [...next];
	next[anchor] = prependText(next[anchor] as ContextMessage, carried) as T;
	return next;
}

/**
 * Collect the newest body of each skill that the branch invoked but the
 * compacted context no longer carries, newest first until the budget runs out.
 */
function carryAcrossCompaction(
	messages: ContextMessage[],
	branch: SessionEntry[],
	present: Set<string>,
): string | undefined {
	if (!messages.some((message) => message.role === "compactionSummary")) {
		return undefined;
	}
	const missing = new Map<string, Invocation>();
	for (const entry of branch) {
		if (entry.type !== "message" || entry.message?.role !== "user") continue;
		const invocation = messageInvocation(entry.message);
		if (!invocation) continue;
		// A skill file edited mid-session yields a new body, so the newest state
		// of each name decides: a present body cancels an earlier missing one.
		if (present.has(invocation.block)) missing.delete(invocation.name);
		else missing.set(invocation.name, invocation);
	}
	if (!missing.size) return undefined;

	const blocks: string[] = [];
	let used = 0;
	for (const invocation of [...missing.values()].reverse()) {
		const block = truncate(invocation.block, MAX_SKILL_CHARS);
		if (used + block.length > MAX_CARRY_CHARS) continue;
		used += block.length;
		blocks.unshift(block);
	}
	return blocks.length ? `${blocks.join("\n\n")}\n\n` : undefined;
}

/** The first user turn after the newest compaction summary. */
function restoreAnchor(messages: ContextMessage[]): number {
	let summary = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "compactionSummary") {
			summary = index;
			break;
		}
	}
	if (summary < 0) return -1;
	for (let index = summary + 1; index < messages.length; index += 1) {
		if (messages[index]?.role === "user") return index;
	}
	return -1;
}
