import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { SKILL_CONTEXT_TOOL, selectedSkills } from "../src/skill-context.ts";
import { registerSkillContext } from "../src/skills.ts";
import { installStickyDefaultsAdapter } from "../src/sticky-defaults.ts";

// @lat: [[lat.md/proper-base/tests#Verification#Skill host fixture]]
test("real Pi session discovers skills, validates the tool schema, and restores snapshots before provider dispatch", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "proper-skill-host-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const skills = ["one", "two"].map((name) => {
		const baseDir = join(dir, name);
		mkdirSync(baseDir);
		const filePath = join(baseDir, "SKILL.md");
		writeFileSync(
			filePath,
			`---\nname: ${name}\ndescription: test\n---\n${name.toUpperCase()}_INSTRUCTIONS`,
		);
		return {
			name,
			description: "test",
			filePath,
			baseDir,
			source: "test",
			disableModelInvocation: false,
			sourceInfo: {
				path: filePath,
				source: "test",
				scope: "temporary" as const,
				origin: "top-level" as const,
			},
		};
	});
	const settings = SettingsManager.inMemory({ compaction: { enabled: false } });
	const runtime = await ModelRuntime.create({
		refreshOnCreate: false,
		modelsPath: null,
	});
	await runtime.setRuntimeApiKey("openai", "test-key");
	const model = runtime.getModel("openai", "gpt-5");
	assert.ok(model);
	const manager = SessionManager.inMemory(dir);
	const loader = new DefaultResourceLoader({
		cwd: dir,
		agentDir: dir,
		settingsManager: settings,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		skillsOverride: () => ({ skills, diagnostics: [] }),
		extensionFactories: [
			(pi) => {
				const host = installStickyDefaultsAdapter(() => false);
				const control = registerSkillContext(pi, dir, (ctx) =>
					host.session(ctx.sessionManager),
				);
				pi.on("session_start", (_event, ctx) => {
					host.activate(ctx.sessionManager);
					control.start(ctx);
				});
				pi.on("before_agent_start", (event) => control.prepare(event));
				pi.on("input", (event, ctx) => control.input(event, ctx));
				pi.on("context", (event, ctx) => ({
					messages: control.transform(event.messages, ctx),
				}));
				pi.on("session_shutdown", () => {
					control.stop();
					host.restore();
				});
			},
		],
	});
	await loader.reload();
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: dir,
		model,
		modelRuntime: runtime,
		settingsManager: settings,
		sessionManager: manager,
		resourceLoader: loader,
	});
	t.after(async () => {
		await session.extensionRunner.emit({
			type: "session_shutdown",
			reason: "quit",
		});
		session.dispose();
	});
	await session.extensionRunner.emit({
		type: "session_start",
		reason: "startup",
	});
	const contexts: any[] = [];
	let activate = true;
	session.agent.streamFunction = (_model, context, options) => {
		assert.equal(options?.signal?.aborted, false);
		contexts.push(structuredClone(context));
		const content = activate
			? [
					{
						type: "toolCall",
						id: "load-two",
						name: SKILL_CONTEXT_TOOL,
						arguments: { action: "load", names: ["two"] },
					},
				]
			: [{ type: "text", text: "Completed task." }];
		activate = false;
		const message = {
			role: "assistant",
			api: model.api,
			provider: model.provider,
			model: model.id,
			content,
			stopReason: content[0]?.type === "toolCall" ? "toolUse" : "stop",
			timestamp: Date.now(),
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		};
		return {
			async *[Symbol.asyncIterator]() {
				yield { type: "done", reason: message.stopReason, message };
			},
			result: async () => message,
		} as any;
	};
	await session.prompt("/skill:one perform a task", { source: "rpc" });
	assert.equal(contexts.length, 2);
	assert.match(JSON.stringify(contexts[0]), /ONE_INSTRUCTIONS/);
	assert.match(JSON.stringify(contexts[1]), /TWO_INSTRUCTIONS/);
	assert.deepEqual(
		selectedSkills(manager.getBranch()).map((skill) => skill.source),
		["user", "model"],
	);
	assert.ok(session.getActiveToolNames().includes(SKILL_CONTEXT_TOOL));

	manager.appendCompaction("Previous task completed.", null, 1000);
	// Rebuild like native compaction while retaining Pi's real agent loop.
	session.agent.state.messages = manager.buildSessionProjection().messages;
	await session.prompt("continue with another task", { source: "rpc" });
	const restored = JSON.stringify(contexts.at(-1));
	assert.equal(restored.split("ONE_INSTRUCTIONS").length - 1, 1);
	assert.equal(restored.split("TWO_INSTRUCTIONS").length - 1, 1);
	assert.match(restored, /Do not repeat completed actions/);

	await session.prompt("/skill-context off");
	await session.prompt("ordinary request");
	assert.ok(!session.getActiveToolNames().includes(SKILL_CONTEXT_TOOL));
	await session.prompt("/skill-context on");
	await session.prompt("continue");
	assert.ok(session.getActiveToolNames().includes(SKILL_CONTEXT_TOOL));
	await session.prompt("/skill-context clear");
	await session.prompt("unrelated request");
	const cleared = JSON.stringify(contexts.at(-1));
	assert.doesNotMatch(cleared, /ONE_INSTRUCTIONS|TWO_INSTRUCTIONS/);
	assert.match(cleared, /Currently selected skills: none/);
});
