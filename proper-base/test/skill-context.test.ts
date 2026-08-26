import assert from "node:assert/strict";
import { test } from "node:test";

import { pinSkillContext } from "../src/skill-context.ts";

type Message = { role: string; content?: unknown };

function skillText(name: string, body: string, request?: string): string {
	const block = `<skill name="${name}" location="/skills/${name}/SKILL.md">\nReferences are relative to /skills/${name}.\n\n${body}\n</skill>`;
	return request ? `${block}\n\n${request}` : block;
}

function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }] };
}

function entry(message: Message) {
	return { type: "message", message };
}

function textOf(message: Message | undefined): string {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" &&
				part !== null &&
				(part as { type?: unknown }).type === "text",
		)
		.map((part) => part.text)
		.join("");
}

test("repeat invocations collapse to a note without touching the first copy", () => {
	const first = user(skillText("audit", "Body one.", "check the parser"));
	const messages: Message[] = [
		first,
		{ role: "assistant", content: [{ type: "text", text: "done" }] },
		user(skillText("audit", "Body one.", "now check the lexer")),
	];

	const next = pinSkillContext(messages, messages.map(entry));

	assert.notEqual(next, messages);
	assert.equal(next[0], first, "first copy must stay identical for the cache");
	assert.match(textOf(next[0]), /Body one\./);
	const repeat = textOf(next[2]);
	assert.doesNotMatch(repeat, /Body one\./);
	assert.match(repeat, /skill "audit" is already loaded/);
	assert.match(repeat, /now check the lexer/);
});

test("a changed skill body is kept rather than deduplicated", () => {
	const messages: Message[] = [
		user(skillText("audit", "Body one.", "first")),
		user(skillText("audit", "Body two.", "second")),
	];

	const next = pinSkillContext(messages, messages.map(entry));

	assert.equal(next, messages);
	assert.match(textOf(next[1]), /Body two\./);
});

test("compaction carries the newest body back into context", () => {
	const dropped = [
		user(skillText("audit", "Body one.", "check the parser")),
		user(skillText("style", "Style rules.", "restyle it")),
	];
	const messages: Message[] = [
		{ role: "compactionSummary", content: [] },
		user("keep going"),
	];

	const next = pinSkillContext(messages, [...dropped, ...messages].map(entry));

	assert.equal(next.length, messages.length, "no message is inserted");
	assert.equal(next[0], messages[0]);
	const restored = textOf(next[1]);
	assert.match(restored, /<skill name="audit"/);
	assert.match(restored, /Body one\./);
	assert.match(restored, /<skill name="style"/);
	assert.match(restored, /Style rules\./);
	assert.match(restored, /keep going$/);
	assert.ok(
		restored.indexOf("audit") < restored.indexOf("style"),
		"restored blocks keep invocation order",
	);
});

test("a skill still present after compaction is not carried twice", () => {
	const messages: Message[] = [
		{ role: "compactionSummary", content: [] },
		user(skillText("audit", "Body one.", "check the parser")),
	];

	const next = pinSkillContext(messages, messages.map(entry));

	assert.equal(next, messages);
	assert.equal(textOf(next[1]).match(/<skill name="audit"/g)?.length, 1);
});

test("an edited skill file does not carry the stale body back", () => {
	const messages: Message[] = [
		{ role: "compactionSummary", content: [] },
		user(skillText("audit", "Body two.", "re-invoked after editing")),
	];
	const branch = [
		entry(user(skillText("audit", "Body one.", "first"))),
		...messages.map(entry),
	];

	const next = pinSkillContext(messages, branch);

	assert.equal(next, messages, "newest body is present, nothing to carry");
	assert.doesNotMatch(textOf(next[1]), /Body one\./);
});

test("carrying is skipped when no compaction dropped anything", () => {
	const dropped = [user(skillText("audit", "Body one.", "check the parser"))];
	const messages: Message[] = [user("unrelated follow up")];

	const next = pinSkillContext(messages, [...dropped, ...messages].map(entry));

	assert.equal(next, messages, "no summary means nothing was compacted away");
});

test("oversized bodies truncate and the combined budget drops the oldest", () => {
	const huge = "x".repeat(40000);
	const dropped = [
		user(skillText("first", huge, "a")),
		user(skillText("second", huge, "b")),
		user(skillText("third", huge, "c")),
	];
	const messages: Message[] = [
		{ role: "compactionSummary", content: [] },
		user("keep going"),
	];

	const restored = textOf(
		pinSkillContext(messages, [...dropped, ...messages].map(entry))[1],
	);

	assert.match(restored, /skill content truncated/);
	assert.ok(restored.length < 60000, "combined budget is enforced");
	assert.match(restored, /<skill name="third"/, "newest skill wins the budget");
	assert.doesNotMatch(restored, /<skill name="first"/);
});

test("string message content is handled like part arrays", () => {
	const repeat: Message[] = [
		{ role: "user", content: skillText("audit", "Body one.", "first") },
		{ role: "user", content: skillText("audit", "Body one.", "second") },
	];
	const deduped = pinSkillContext(repeat, repeat.map(entry));
	assert.equal(deduped[0], repeat[0]);
	assert.match(textOf(deduped[1]), /already loaded earlier[\s\S]*second/);

	const compacted: Message[] = [
		{ role: "compactionSummary", content: [] },
		{ role: "user", content: "keep going" },
	];
	const carried = pinSkillContext(compacted, [
		entry(repeat[0] as Message),
		...compacted.map(entry),
	]);
	assert.match(textOf(carried[1]), /<skill name="audit"[\s\S]*keep going$/);
});

test("plain transcripts are returned untouched", () => {
	const messages: Message[] = [
		user("hello"),
		{ role: "assistant", content: [{ type: "text", text: "hi" }] },
	];
	assert.equal(pinSkillContext(messages, messages.map(entry)), messages);
});

test("the transform is deterministic so the request prefix stays cacheable", () => {
	const messages: Message[] = [
		user(skillText("audit", "Body one.", "first")),
		user(skillText("audit", "Body one.", "second")),
	];
	const branch = messages.map(entry);

	assert.deepEqual(
		pinSkillContext(messages, branch),
		pinSkillContext(messages, branch),
	);
});
