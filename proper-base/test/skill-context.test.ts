import assert from "node:assert/strict";
import { test } from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import {
	pinSkillContext,
	SKILL_CONTEXT_ENTRY,
	SKILL_CONTEXT_TOOL,
	SkillContextError,
	selectedSkills,
} from "../src/skill-context.ts";

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

function pinnedNativeBranch(manager: SessionManager): Message[] {
	return pinSkillContext(
		manager.buildSessionProjection().messages as Message[],
		manager.getBranch(),
	);
}

function nativeUserMessage(content: string) {
	return { role: "user" as const, content, timestamp: Date.now() };
}

// @lat: [[lat.md/proper-base/tests#Verification#Skill context fixture]]
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

test("a changed skill body supersedes old instructions while preserving both requests", () => {
	const messages: Message[] = [
		user(skillText("audit", "Body one.", "first")),
		user(skillText("audit", "Body two.", "second")),
	];

	const next = pinSkillContext(messages, messages.map(entry));

	assert.notEqual(next, messages);
	assert.match(textOf(next[0]), /superseded[\s\S]*first/);
	assert.doesNotMatch(textOf(next[0]), /Body one/);
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

test("native context edit omission is not restored after compaction", () => {
	const manager = SessionManager.inMemory("/tmp/proper-base-skill-context");
	const id = manager.appendMessage(
		nativeUserMessage(skillText("audit", "OMITTED_SKILL_SENTINEL", "first")),
	);
	manager.appendContextEdit(id, null);
	manager.appendCompaction("Checkpoint without skills.", null, 1000);
	manager.appendMessage(nativeUserMessage("Continue."));

	const pinned = pinnedNativeBranch(manager);

	assert.match(JSON.stringify(manager.getBranch()), /OMITTED_SKILL_SENTINEL/);
	assert.doesNotMatch(
		JSON.stringify(manager.buildSessionProjection().messages),
		/OMITTED_SKILL_SENTINEL/,
	);
	assert.doesNotMatch(JSON.stringify(pinned), /OMITTED_SKILL_SENTINEL/);
});

test("native context edit plain replacement is not restored as the old skill", () => {
	const manager = SessionManager.inMemory("/tmp/proper-base-skill-context");
	const id = manager.appendMessage(
		nativeUserMessage(skillText("audit", "REPLACED_SKILL_SENTINEL", "first")),
	);
	manager.appendContextEdit(id, {
		content: "Replaced with ordinary user text.",
	});
	manager.appendCompaction("Checkpoint without skills.", null, 1000);
	manager.appendMessage(nativeUserMessage("Continue."));

	const pinned = pinnedNativeBranch(manager);

	assert.doesNotMatch(JSON.stringify(pinned), /REPLACED_SKILL_SENTINEL/);
	assert.doesNotMatch(textOf(pinned[1]), /<skill name="audit"/);
	assert.match(textOf(pinned[1]), /Continue\.$/);
});

test("native context edit skill replacement survives compaction", () => {
	const manager = SessionManager.inMemory("/tmp/proper-base-skill-context");
	const id = manager.appendMessage(
		nativeUserMessage(skillText("audit", "OLD_SKILL_SENTINEL", "first")),
	);
	manager.appendContextEdit(id, {
		content: skillText("audit", "UPDATED_SKILL_SENTINEL", "updated"),
	});
	manager.appendCompaction("Checkpoint without skills.", null, 1000);
	manager.appendMessage(nativeUserMessage("Continue."));

	const restored = textOf(pinnedNativeBranch(manager)[1]);

	assert.match(restored, /UPDATED_SKILL_SENTINEL/);
	assert.doesNotMatch(restored, /OLD_SKILL_SENTINEL/);
	assert.match(restored, /Continue\.$/);
});

test("native context edit latest replacement wins skill carry", () => {
	const manager = SessionManager.inMemory("/tmp/proper-base-skill-context");
	const id = manager.appendMessage(
		nativeUserMessage(skillText("audit", "OLD_SKILL_SENTINEL", "first")),
	);
	manager.appendContextEdit(id, {
		content: skillText("audit", "FIRST_EDIT_SENTINEL", "first edit"),
	});
	manager.appendContextEdit(id, {
		content: skillText("audit", "SECOND_EDIT_SENTINEL", "second edit"),
	});
	manager.appendCompaction("Checkpoint without skills.", null, 1000);
	manager.appendMessage(nativeUserMessage("Continue."));

	const restored = textOf(pinnedNativeBranch(manager)[1]);

	assert.match(restored, /SECOND_EDIT_SENTINEL/);
	assert.doesNotMatch(restored, /FIRST_EDIT_SENTINEL/);
	assert.doesNotMatch(restored, /OLD_SKILL_SENTINEL/);
});

test("native context edits stay branch-local across navigation and repeated compaction", () => {
	const manager = SessionManager.inMemory("/tmp/proper-base-skill-context");
	const id = manager.appendMessage(
		nativeUserMessage(skillText("audit", "ORIGINAL_BRANCH_SKILL")),
	);
	manager.appendContextEdit(id, {
		content: skillText("audit", "EDITED_BRANCH_SKILL"),
	});
	manager.appendCompaction("First branch checkpoint.", null, 1000);
	const editedLeaf = manager.appendMessage(
		nativeUserMessage("Continue edited."),
	);
	assert.match(
		JSON.stringify(pinnedNativeBranch(manager)),
		/EDITED_BRANCH_SKILL/,
	);

	manager.branch(id);
	manager.appendCompaction("Sibling branch checkpoint.", null, 1000);
	manager.appendMessage(nativeUserMessage("Continue sibling."));
	const sibling = JSON.stringify(pinnedNativeBranch(manager));
	assert.match(sibling, /ORIGINAL_BRANCH_SKILL/);
	assert.doesNotMatch(sibling, /EDITED_BRANCH_SKILL/);
	manager.appendContextEdit(id, null);
	assert.doesNotMatch(
		JSON.stringify(pinnedNativeBranch(manager)),
		/BRANCH_SKILL/,
	);

	manager.branch(editedLeaf);
	manager.appendContextEdit(id, null);
	manager.appendContextEdit(id, {
		content: [
			{ type: "text", text: skillText("audit", "LATEST_BRANCH_SKILL") },
		],
	});
	manager.appendCompaction("Second edited checkpoint.", null, 1000);
	manager.appendMessage(nativeUserMessage("Continue latest."));
	const originalEntries = structuredClone(manager.getEntries());
	const restored = JSON.stringify(pinnedNativeBranch(manager));
	assert.match(restored, /LATEST_BRANCH_SKILL/);
	assert.doesNotMatch(restored, /ORIGINAL_BRANCH_SKILL|EDITED_BRANCH_SKILL/);
	assert.deepEqual(manager.getEntries(), originalEntries);
});

test("missing selected snapshots are restored without replaying their requests", () => {
	const dropped = [user(skillText("audit", "Body one.", "check the parser"))];
	const messages: Message[] = [user("unrelated follow up")];
	const next = pinSkillContext(messages, [...dropped, ...messages].map(entry));
	assert.match(textOf(next[0]), /Apply only where relevant/);
	assert.doesNotMatch(textOf(next[0]), /check the parser/);
	assert.match(textOf(next[0]), /unrelated follow up$/);
});

test("oversized selected context fails visibly without truncating or dropping instructions", () => {
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

	assert.throws(
		() => pinSkillContext(messages, [...dropped, ...messages].map(entry)),
		(error) =>
			error instanceof SkillContextError &&
			/No instructions were truncated/.test(error.message),
	);
	assert.equal(textOf(messages[1]), "keep going");
});

test("restoration retains complete latest versions and enforces the aggregate budget", () => {
	const messages: Message[] = [
		{ role: "compactionSummary", content: [] },
		user("keep going"),
	];
	const branch = [
		user(skillText("a", "old a")),
		user(skillText("b", "b".repeat(20000))),
		user(skillText("a", "new a ".repeat(4000))),
	].map(entry);
	const restored = textOf(pinSkillContext(messages, branch)[1]);
	assert.match(restored, /<skill name="a"/);
	assert.match(restored, /<skill name="b"/);
	assert.doesNotMatch(restored, /old a|truncated/);
	assert.match(restored, /new a/);
	assert.match(restored, /keep going$/);
	assert.throws(
		() => pinSkillContext(messages, branch, 24_000),
		SkillContextError,
	);

	const exact = textOf(
		pinSkillContext(messages, [
			entry(user(skillText("one", "x".repeat(11900)))),
			entry(user(skillText("two", "y".repeat(11900)))),
		])[1],
	);
	assert.doesNotMatch(exact, /truncated/);
	assert.equal(
		exact.match(/<skill /g)?.length,
		exact.match(/<\/skill>/g)?.length,
	);
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

test("multiple blocks, repeat requests and image parts survive idempotent projection", () => {
	const first = user(
		`${skillText("audit", "AUDIT_BODY")}\n\n${skillText("tests", "TEST_BODY")}\n\nfirst request`,
	);
	const second = {
		role: "user",
		content: [
			{
				type: "text",
				text: `${skillText("audit", "AUDIT_BODY")}\n\n${skillText("style", "STYLE_BODY")}\n\nsecond request`,
			},
			{ type: "image", data: "IMAGE_SENTINEL" },
		],
	};
	const messages = [first, second];
	const branch = messages.map(entry);
	const projected = pinSkillContext(messages, branch);
	assert.equal(JSON.stringify(projected).split("AUDIT_BODY").length - 1, 1);
	assert.match(textOf(projected[1]), /STYLE_BODY[\s\S]*second request/);
	assert.match(JSON.stringify(projected[1]), /IMAGE_SENTINEL/);
	assert.deepEqual(pinSkillContext(projected, branch), projected);
	assert.equal(selectedSkills(branch).length, 3);
});

test("split-turn compaction restores to the summary without inserting messages between tool calls", () => {
	const branch = [
		entry(user(skillText("audit", "BODY_SENTINEL", "completed request"))),
	];
	const messages = [
		{ role: "compactionSummary", summary: "Task progress retained." },
		{ role: "assistant", content: [{ type: "toolCall", id: "call" }] },
		{ role: "toolResult", content: [{ type: "text", text: "result" }] },
	];
	const next = pinSkillContext(messages, branch);
	assert.match(next[0]?.summary ?? "", /BODY_SENTINEL/);
	assert.equal(next[1], messages[1]);
	assert.equal(next[2], messages[2]);
	assert.deepEqual(pinSkillContext(next, branch), next);
	assert.doesNotMatch(JSON.stringify(next), /completed request/);
});

test("control records and native tool-result edits govern the selected set", () => {
	const block = skillText("audit", "TOOL_BODY");
	const branch = [
		{
			type: "message",
			id: "tool",
			message: {
				role: "toolResult",
				toolName: SKILL_CONTEXT_TOOL,
				content: block,
			},
		},
		{
			type: "custom",
			customType: SKILL_CONTEXT_ENTRY,
			data: { action: "remove", locations: ["/skills/audit/SKILL.md"] },
		},
	];
	assert.equal(selectedSkills(branch)[0]?.selected, false);
	const restored = [
		...branch,
		{
			type: "custom",
			customType: SKILL_CONTEXT_ENTRY,
			data: { action: "load", blocks: [block] },
		},
	];
	assert.equal(selectedSkills(restored)[0]?.source, "user");
	assert.equal(selectedSkills(restored)[0]?.selected, true);
	const toolEntry = branch[0];
	assert.ok(toolEntry);
	assert.equal(
		selectedSkills([
			toolEntry,
			{ type: "context_edit", targetId: "tool", replacement: null },
		]).length,
		0,
	);
	assert.equal(
		selectedSkills([
			{
				type: "message",
				message: { role: "toolResult", toolName: "read", content: block },
			},
		]).length,
		0,
	);
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
