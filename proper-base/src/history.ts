/**
 * Pure prompt-history logic.
 *
 * Kept free of pi imports so it can be unit tested on its own. `index.ts`
 * adapts pi's session types onto the structural types below.
 */

/** One recalled prompt and when it was sent. */
export interface Prompt {
	text: string;
	ts: number;
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

/**
 * True when a submission is worth recalling from history.
 *
 * A leading `/` is either a prompt template (`/file fix the bug`), which is a
 * real prompt, or a UI command (`/model …`, `/new`, `/reload`,
 * `/llm-router-config`), which is not. Recalling a UI command is noise, and
 * re-submitting a recalled `/model …` silently changes the session model.
 * pi's `getCommands()` lists prompt templates and skills but not built-ins or
 * extension commands, so membership there is the whole test.
 */
export function isRecallable(
	text: string,
	commands: readonly { name: string; source: string }[],
): boolean {
	const command = /^\/(\S+)/.exec(text.trimStart());
	if (!command) return true;
	return commands.some(
		(c) => c.source !== "extension" && c.name === command[1],
	);
}

/**
 * Normalize recorded prompts into editor history order.
 *
 * Duplicate text keeps its newest timestamp. Returns oldest first, the order
 * the trusted history append method expects, so Up yields the newest prompt.
 */
export function mergePrompts(
	prompts: readonly Prompt[],
	limit: number,
): string[] {
	if (limit <= 0) return [];

	const newest = new Map<string, number>();
	for (const prompt of prompts) {
		const known = newest.get(prompt.text);
		if (known === undefined || prompt.ts > known)
			newest.set(prompt.text, prompt.ts);
	}

	// Insertion order breaks timestamp ties, keeping same-millisecond prompts
	// in the order they were seen rather than reordering them arbitrarily.
	const ordered = [...newest].map(([text, ts], index) => ({ text, ts, index }));
	ordered.sort((a, b) => a.ts - b.ts || a.index - b.index);
	return ordered.slice(-limit).map((entry) => entry.text);
}
