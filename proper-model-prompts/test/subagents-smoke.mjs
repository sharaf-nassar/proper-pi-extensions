// @lat: [[proper-model-prompts/tests#Subagent smoke]]
// Opt-in end-to-end check against the installed `pi` and pi-subagents.
// A fake provider records every request, so no model or network is used.
// The child model is named like a Claude model, so the built-in prompts and
// the print-mode unattended block must reach it too.
// Run: npm run test:subagents  (PI_SUBAGENTS_DIR overrides the package path)

import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(new URL("..", import.meta.url));
const subagents =
	process.env.PI_SUBAGENTS_DIR ??
	join(
		process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
		"npm",
		"node_modules",
		"pi-subagents",
	);
const root = mkdtempSync(join(tmpdir(), "proper-model-prompts-smoke-"));
const agent = join(root, "agent");
const work = join(root, "work");
const fake = join(root, "fake");
for (const dir of [agent, work, fake]) mkdirSync(dir);

writeFileSync(
	join(fake, "index.ts"),
	`import { appendFileSync } from "node:fs";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
export default function (pi: any) {
	const faux = createFauxCore({ provider: "fake", models: [{ id: "parent-model" }, { id: "claude-child" }] });
	const call = (name: string, args: unknown) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
	const respond = (context: any, _options: any, _state: any, model: any) => {
		appendFileSync(process.env.CAPTURE!, JSON.stringify({ model: model.id, prompt: getCurrentSystemPrompt(context.messages) }) + "\\n");
		if (model.id !== "parent-model") return fauxAssistantMessage("child done");
		const called = context.messages.filter((message: any) => message.role === "toolResult").map((message: any) => message.toolName);
		if (called.includes("subagent")) return fauxAssistantMessage("parent done");
		// pi-subagents 0.71 and later start a parent with only its subagents_enable loader active.
		if (!getCurrentTools(context.messages).some((tool: any) => tool.name === "subagent"))
			return called.includes("subagents_enable") ? fauxAssistantMessage("subagent unavailable") : call("subagents_enable", {});
		return call("subagent", JSON.parse(process.env.SUBAGENT_ARGS!));
	};
	faux.setResponses(Array.from({ length: 20 }, () => respond));
	pi.registerProvider("fake", {
		api: faux.api, baseUrl: "http://127.0.0.1:1", apiKey: "fake", streamSimple: faux.streamSimple,
		models: faux.models.map((m: any) => ({ id: m.id, name: m.name, reasoning: false, input: ["text"], cost: m.cost, contextWindow: m.contextWindow, maxTokens: m.maxTokens })),
	});
}
`,
);
writeFileSync(
	join(agent, "proper-model-prompts.json"),
	JSON.stringify({
		prompts: [
			{ models: ["fake/parent-model"], text: "PARENT-APPEND" },
			{ models: ["claude-child"], position: "prepend", text: "CHILD-PREPEND" },
			{ models: ["fake/claude-*"], text: "CHILD-APPEND" },
		],
	}),
);

const count = (text, part) => text.split(part).length - 1;
const failures = [];
try {
	for (const [name, async, childOnly, childSees] of [
		["background", true, false, true],
		["background + child-only default", true, true, true],
		["foreground", false, false, false],
		["foreground + child-only default", false, true, true],
	]) {
		writeFileSync(
			join(agent, "settings.json"),
			JSON.stringify({
				packages: [subagents, fake, self],
				retry: { enabled: false },
				quietStartup: true,
				...(childOnly
					? { subagents: { defaultSubagentOnlyExtensions: [self] } }
					: {}),
			}),
		);
		const capture = join(root, `${name.replaceAll(/\W+/g, "-")}.jsonl`);
		const env = {
			...process.env,
			PI_CODING_AGENT_DIR: agent,
			CAPTURE: capture,
		};
		for (const key of ["PI_SUBAGENT_CHILD", "PI_SESSION_FILE", "PI_SESSION_ID"])
			delete env[key];
		env.SUBAGENT_ARGS = JSON.stringify({
			agent: "delegate",
			task: "Say hi",
			model: "fake/claude-child",
			async,
			context: "fresh",
		});
		const run = spawnSync(
			"pi",
			["-p", "--model", "fake/parent-model", "Delegate the greeting."],
			{ cwd: work, env, encoding: "utf8", timeout: 240_000 },
		);
		const requests =
			run.status === 0
				? readFileSync(capture, "utf8")
						.trim()
						.split("\n")
						.map((line) => JSON.parse(line))
				: [];
		const parents = requests.filter(
			(request) => request.model === "parent-model",
		);
		const children = requests.filter(
			(request) => request.model === "claude-child",
		);
		const problems = [];
		if (run.status !== 0)
			problems.push(`pi exited ${run.status}: ${run.stderr || run.stdout}`);
		if (children.length !== 1)
			problems.push(`expected 1 child request, saw ${children.length}`);
		for (const { prompt } of parents)
			if (
				count(prompt, "PARENT-APPEND") !== 1 ||
				prompt.includes("CHILD-") ||
				prompt.includes("<grounding>")
			)
				problems.push("parent prompt has the wrong model prompts");
		for (const { prompt } of children) {
			const prepended = prompt.startsWith("CHILD-PREPEND\n\n");
			const once =
				count(prompt, "CHILD-PREPEND") === 1 &&
				count(prompt, "CHILD-APPEND") === 1;
			const builtIn =
				count(prompt, "<grounding>") === 1 &&
				count(prompt, "<autonomous_run>") === 1;
			if (childSees && !(prepended && once && !prompt.includes("PARENT-")))
				problems.push(
					"child prompt lacks exactly one prepended and appended prompt",
				);
			if (childSees && !builtIn)
				problems.push(
					"child prompt lacks exactly one built-in core and unattended block",
				);
			if (
				!childSees &&
				(prompt.includes("CHILD-") || prompt.includes("<grounding>"))
			)
				problems.push(
					"foreground child unexpectedly loaded ambient extensions",
				);
		}
		console.log(
			`${problems.length ? "FAIL" : "ok  "} ${name}${childSees ? "" : " (expected: no prompts without the setting)"}`,
		);
		for (const problem of problems) console.log(`     ${problem}`);
		failures.push(...problems);
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}
process.exit(failures.length ? 1 : 0);
