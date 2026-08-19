#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PACKAGES = ["proper-base", "proper-flow", "proper-llm-router"];
const LOCKED_PACKAGES = ["proper-base", "proper-llm-router"];

function run(command, args, cwd = ".") {
	console.log(
		`\n> ${cwd === "." ? "" : `${cwd}/ `}${command} ${args.join(" ")}`,
	);
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function hasScript(cwd, name) {
	const pkg = JSON.parse(readFileSync(`${cwd}/package.json`, "utf8"));
	return typeof pkg.scripts?.[name] === "string";
}

function checkJsonl(path) {
	for (const [index, line] of readFileSync(path, "utf8")
		.split("\n")
		.entries()) {
		if (!line.trim()) continue;
		try {
			JSON.parse(line);
		} catch (error) {
			throw new SyntaxError(`${path}:${index + 1}: ${error.message}`);
		}
	}
}

function fast() {
	run("node", ["--test", "test/*.test.mjs"]);
	run("npm", ["test"], "proper-base");
	run("npm", ["test"], "proper-flow");
	if (hasScript("proper-llm-router", "test:unit")) {
		run("npm", ["run", "test:unit"], "proper-llm-router");
	} else {
		run(
			"node",
			["--experimental-strip-types", "--test", "test/*.test.ts"],
			"proper-llm-router",
		);
	}
	for (const cwd of LOCKED_PACKAGES) {
		if (hasScript(cwd, "typecheck")) run("npm", ["run", "typecheck"], cwd);
		else run("npx", ["--no-install", "tsc"], cwd);
	}
	for (const cwd of LOCKED_PACKAGES) {
		run("npm", ["ci", "--ignore-scripts", "--dry-run", "--offline"], cwd);
	}
	for (const cwd of PACKAGES) {
		run("npm", ["pack", "--dry-run", "--ignore-scripts"], cwd);
	}
	checkJsonl("proper-llm-router/exemplars.jsonl");
	run("lat", ["check"]);
}

function full() {
	fast();
	run("npm", ["run", "test:coverage"], "proper-base");
	run("npm", ["run", "test:coverage"], "proper-llm-router");
	run("npm", ["run", "test:smoke"], "proper-llm-router");
	for (const cwd of LOCKED_PACKAGES) {
		run("npm", ["audit", "--audit-level=low"], cwd);
		run("npm", ["audit", "signatures"], cwd);
	}
}

const mode = process.argv[2] ?? "fast";
if (mode === "fast") fast();
else if (mode === "full") full();
else throw new Error(`unknown check mode: ${mode}`);
