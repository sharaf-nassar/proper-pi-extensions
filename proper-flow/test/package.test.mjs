import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const expected = [
	"file.md",
	"implement-ready.md",
	"refine.md",
	"spec.md",
	"triage.md",
];

test("package exposes the five workflow prompts", async () => {
	const manifest = JSON.parse(
		await readFile(new URL("package.json", root), "utf8"),
	);
	assert.deepEqual(manifest.pi.prompts, ["./prompts"]);

	const prompts = (await readdir(new URL("prompts/", root)))
		.filter((name) => name.endsWith(".md"))
		.sort();
	assert.deepEqual(prompts, expected);

	for (const name of prompts) {
		const source = await readFile(new URL(`prompts/${name}`, root), "utf8");
		assert.match(source, /^---\n[\s\S]*?^description: .+$/m, name);
		assert.match(source, /^argument-hint: .+$/m, name);
	}
});

test("all user questions use the questionnaire tool", async () => {
	for (const name of expected) {
		const source = await readFile(new URL(`prompts/${name}`, root), "utf8");
		assert.match(
			source,
			/Whenever this workflow needs input from the user,[\s\S]*?`ask_user_question` tool instead of asking in plain text\./,
			name,
		);
		assert.match(
			source,
			/Fall back to plain text only if the tool is unavailable[\s\S]*?fails before displaying its UI\./,
			name,
		);
	}
});

test("file stores acceptance criteria in the structured field", async () => {
	const source = await readFile(new URL("prompts/file.md", root), "utf8");
	assert.match(source, /--acceptance="<criteria>"/);
	assert.match(source, /never only in the description/);
});

test("refine handles selected cards and defaults to the P4 backlog", async () => {
	const source = await readFile(new URL("prompts/refine.md", root), "utf8");
	assert.match(
		source,
		/^argument-hint: "\[card id\/name\[, \.\.\.\]\] \[workers 1-12, default 12\]"/m,
	);
	assert.match(
		source,
		/With no card selector, refine every open or deferred P4/,
	);
	assert.match(source, /bd list --status=open,deferred --priority=4/);
	assert.match(source, /bd search <selector> --json --limit 20/);
	assert.match(source, /INITIAL_SOURCE_IDS/);
	assert.match(source, /ADOPTED_SOURCE_IDS/);
	assert.match(source, /REFINE_RUN_ID/);
	assert.match(source, /refinement\.lock/);
	assert.match(source, /source_scope=closure/);
	assert.match(source, /source_scope=explicit/);
	assert.match(source, /reconnaissance/i);
	assert.match(source, /conflict cluster/i);
	assert.match(source, /distinct target\s+epics/i);
	assert.match(
		source,
		/ACTIVE\.size \+ LAUNCHING_CLUSTERS\.size <= POOL_LIMIT <= 12/,
	);
	assert.match(source, /child `async: true`/);
	assert.match(source, /subagent_wait\(\{ stopOnAttention: false \}\)/);
	assert.match(source, /--var depth=quick/);
	assert.match(source, /`promote-epic`\s+disposition/);
	assert.match(source, /ask_user_question/);
	assert.match(source, /bd gate list/);
	assert.match(source, /bd gate show/);
	assert.match(source, /bd gate resolve <gate-id>/);
	assert.match(source, /already-retired-covered/);
	assert.match(source, /absorb --repo <repo>/);

	const triage = await readFile(new URL("prompts/triage.md", root), "utf8");
	assert.match(triage, /Card refinement/);
	assert.match(triage, /invoke `\/refine`/);
});

test("implement-ready accepts epic, task, or all scopes", async () => {
	const source = await readFile(
		new URL("prompts/implement-ready.md", root),
		"utf8",
	);
	assert.match(source, /^argument-hint: "\[epic id \| task id\/name \| all\]/m);
	assert.match(
		source,
		/Resolve a non-`all` scope before initializing the rail:/,
	);
	assert.match(source, /single-task mode/);
});

test("P4 debt stays out of ready work and routes to refine", async () => {
	const implementReady = await readFile(
		new URL("prompts/implement-ready.md", root),
		"utf8",
	);
	assert.match(
		implementReady,
		/bd create[\s\S]*?--type=chore -p 4[\s\S]*?--status=deferred/,
	);
	assert.doesNotMatch(implementReady, /bd defer/);
	assert.match(implementReady, /refine with `\/refine`/);
	assert.doesNotMatch(implementReady, /\/spec\s+debt/);

	const spec = await readFile(new URL("prompts/spec.md", root), "utf8");
	assert.doesNotMatch(spec, /literal argument `debt`/);
	assert.doesNotMatch(spec, /ponytail-debt/);
});

test("implement-ready caps and refills a rolling worker pool", async () => {
	const source = await readFile(
		new URL("prompts/implement-ready.md", root),
		"utf8",
	);
	assert.match(source, /\[workers 1-12, default 12\]/);
	assert.match(source, /default 12, hard maximum 12/);
	assert.match(
		source,
		/ACTIVE\.size \+ LAUNCHING_TASKS\.size <= POOL_LIMIT <= 12/,
	);
	assert.match(source, /child `async: true`/);
	assert.match(source, /subagent_wait\(\{ stopOnAttention: false \}\)/);
	assert.match(source, /Do not wait for still-running siblings\./);
	assert.doesNotMatch(source, /default: no\s+cap/);
});

test("integration and retry sequencing stay explicit", async () => {
	const source = await readFile(
		new URL("prompts/implement-ready.md", root),
		"utf8",
	);
	assert.match(
		source,
		/verify-integration --gates → bd close → cleanup → unlock/,
	);
	assert.match(source, /recover with `unlock --abort`/);
	assert.match(source, /--attempt <N\+1> --prior-attempts M/);
	assert.doesNotMatch(source, /--attempt N --prior-attempts M/);
});

test("file points inline fixes at run-level absorb", async () => {
	const source = await readFile(new URL("prompts/file.md", root), "utf8");
	assert.match(source, /\/implement-ready's run-level absorb step/);
	assert.doesNotMatch(source, /worker absorb step/);
});
