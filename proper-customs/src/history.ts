/**
 * Pure prompt-history logic.
 *
 * Kept free of pi imports so it can be unit tested on its own. `index.ts`
 * adapts pi's session types onto the structural types below.
 */

export interface TextPart {
	type: string;
	text?: string;
}

export type MessageContent = string | TextPart[];

export interface MessageLike {
	role?: string;
	content?: MessageContent;
}

export interface EntryLike {
	type: string;
	timestamp?: string;
	message?: MessageLike;
}

/** One recalled prompt and when it was sent. */
export interface Prompt {
	text: string;
	ts: number;
}

export interface SessionLike {
	path: string;
	modified: Date;
}

/**
 * Marks our editor wrapper and remembers the factory it wraps.
 *
 * `Symbol.for` keeps the tag stable when pi reloads the extension module on
 * session replacement, so a wrapper installed by a previous module instance is
 * still recognised.
 */
export const WRAPPED = Symbol.for("pi-proper-history.wrapped");

/**
 * Find the editor factory to wrap.
 *
 * `session_start` fires again on reload, resume, and fork. Wrapping our own
 * wrapper each time would stack them and seed every prompt once more per pass,
 * so unwrap back to the factory we originally wrapped.
 */
export function resolveBase<F extends object>(
	current: F | undefined,
): F | undefined {
	if (current && WRAPPED in current) {
		return (
			((current as Record<symbol, unknown>)[WRAPPED] as F | null | undefined) ??
			undefined
		);
	}
	return current;
}

/** Matches pi's skill wrapper: the typed prompt, when present, trails the block. */
const SKILL_BLOCK =
	/^<skill name="[^"]*" location="[^"]*">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/;

/**
 * Join a user message into the single string pi would show.
 *
 * Mirrors pi's `getUserMessageText`, which concatenates text blocks with an
 * empty separator, so entries recalled here match what pi puts in history for
 * the live session.
 */
function messageText(content: MessageContent): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	let text = "";
	for (const part of content) {
		if (part?.type === "text" && typeof part.text === "string") text += part.text;
	}
	return text;
}

/**
 * Reduce a message to the text the user actually typed.
 *
 * Skill invocations reach the session as a `<skill>` wrapper around the skill
 * body. Recalling that blob is useless, so unwrap it to the trailing prompt and
 * drop invocations that carried no prompt of their own.
 */
function typedPrompt(raw: string): string {
	const skill = raw.match(SKILL_BLOCK);
	if (skill) return (skill[1] ?? "").trim();
	return raw.trim();
}

/** User prompts from one session's entries, oldest first. */
export function extractPrompts(entries: readonly EntryLike[]): Prompt[] {
	const prompts: Prompt[] = [];
	for (const entry of entries) {
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "user" || message.content === undefined) continue;
		const text = typedPrompt(messageText(message.content));
		if (!text) continue;
		const parsed = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN;
		prompts.push({ text, ts: Number.isNaN(parsed) ? 0 : parsed });
	}
	return prompts;
}

/**
 * Sessions to read, newest first.
 *
 * The live session is excluded because pi seeds its prompts into the editor
 * itself; reading it here would duplicate every entry after `/resume`.
 */
export function selectSessions<T extends SessionLike>(
	sessions: readonly T[],
	liveSessionFile?: string,
): T[] {
	return sessions
		.filter((session) => session.path !== liveSessionFile)
		.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/**
 * Merge prompt sources into editor history order.
 *
 * Session files and the recorded store overlap, so entries are keyed by text
 * and collapse onto their most recent timestamp. Sorting by timestamp keeps
 * prompts from different sources correctly interleaved rather than grouped by
 * where they came from.
 *
 * Returns oldest first, the order `addToHistory` expects, so the first press of
 * Up yields the most recent prompt. `exclude` drops prompts pi seeds itself.
 */
export function mergePrompts(
	sources: readonly (readonly Prompt[])[],
	limit: number,
	exclude: ReadonlySet<string> = new Set(),
): string[] {
	if (limit <= 0) return [];

	const newest = new Map<string, number>();
	for (const source of sources) {
		for (const prompt of source) {
			if (exclude.has(prompt.text)) continue;
			const known = newest.get(prompt.text);
			if (known === undefined || prompt.ts > known)
				newest.set(prompt.text, prompt.ts);
		}
	}

	// Insertion order breaks timestamp ties, keeping same-millisecond prompts
	// in the order they were seen rather than reordering them arbitrarily.
	const ordered = [...newest].map(([text, ts], index) => ({ text, ts, index }));
	ordered.sort((a, b) => a.ts - b.ts || a.index - b.index);
	return ordered.slice(-limit).map((entry) => entry.text);
}

/** Prompt texts pi already seeds from the live session, so they are not added twice. */
export function livePromptTexts(entries: readonly EntryLike[]): Set<string> {
	return new Set(extractPrompts(entries).map((prompt) => prompt.text));
}
