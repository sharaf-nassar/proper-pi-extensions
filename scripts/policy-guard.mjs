#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const PROTECTED_PATHS = [
	/(?:^|\/)(?:AGENTS|CLAUDE)\.md$/,
	/^\.beads\/hooks\/(?:commit-msg|pre-commit|pre-push|prepare-commit-msg)$/,
	/^\.claude\/settings\.json$/,
	/^\.codex\/(?:config\.toml|hooks\.json)$/,
	/^\.cursor\/hooks\.json$/,
	/^\.markdownlint-cli2\.jsonc$/,
	/^\.pre-commit-config\.yaml$/,
	/^_typos\.toml$/,
	/^biome\.json$/,
	/^scripts\/(?:check-[^/]+|policy-guard)\.mjs$/,
	/^test\/policy-guard\.test\.mjs$/,
	/(?:^|\/)package(?:-lock)?\.json$/,
	/(?:^|\/)tsconfig\.json$/,
];

const SOURCE_PATH = /\.(?:[cm]?[jt]s|jsonc?|sh|toml|ya?ml)$/;
const FORBIDDEN_ADDITIONS = [
	/@ts-(?:expect-error|ignore|nocheck)\b/i,
	/\bas\s+any\b/i,
	/biome-ignore/i,
	/eslint-disable/i,
	/prettier-ignore/i,
	/(?:c8|istanbul)\s+ignore/i,
	/\b(?:describe|it|test)\.(?:only|skip|todo)\s*\(/,
	/\b(?:describe|it|test)\s*\([^\n]*\{[^\n]*(?:only|skip|todo)\s*:\s*true/,
];

export function isProtectedPolicyPath(path) {
	return PROTECTED_PATHS.some((pattern) => pattern.test(path));
}

export function findPolicyViolations({ changed, deleted, addedLines }) {
	const violations = changed
		.filter(isProtectedPolicyPath)
		.map((path) => `${path}: validation policy changes require human approval`);

	violations.push(
		...deleted
			.filter((path) => /(?:^|\/)test\/.*\.test\.[cm]?[jt]s$/.test(path))
			.map((path) => `${path}: deleting tests requires policy approval`),
	);

	for (const { path, line } of addedLines) {
		if (!SOURCE_PATH.test(path)) continue;
		if (FORBIDDEN_ADDITIONS.some((pattern) => pattern.test(line))) {
			violations.push(`${path}: forbidden suppression: ${line.trim()}`);
		}
	}

	return [...new Set(violations)];
}

function git(...args) {
	return execFileSync("git", args, { encoding: "utf8" });
}

function stagedChanges() {
	const changed = git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
		.split("\n")
		.filter(Boolean);
	const deleted = git("diff", "--cached", "--name-only", "--diff-filter=D")
		.split("\n")
		.filter(Boolean);
	const addedLines = [];
	let path;
	for (const line of git(
		"diff",
		"--cached",
		"--unified=0",
		"--no-color",
		"--no-ext-diff",
	).split("\n")) {
		if (line.startsWith("+++ b/")) path = line.slice(6);
		else if (path && line.startsWith("+") && !line.startsWith("+++")) {
			addedLines.push({ path, line: line.slice(1) });
		}
	}
	return { changed, deleted, addedLines };
}

function main() {
	if (process.env.ALLOW_POLICY_CHANGES === "1") return;
	const violations = findPolicyViolations(stagedChanges());
	if (!violations.length) return;
	console.error("Repository policy guard failed:\n");
	for (const violation of violations) console.error(`- ${violation}`);
	console.error(
		"\nA human may rerun with ALLOW_POLICY_CHANGES=1 after reviewing the diff.",
	);
	process.exitCode = 1;
}

if (
	process.argv.includes("--staged") ||
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main();
}
