/**
 * Commit-command guard: validates `git commit` invocations before the bash
 * tool executes them. Port of the Claude Code PreToolUse hook
 * `commit_message_validator.py` (command mode; the amend guard is
 * intentionally not ported).
 *
 * The command must be one direct `git … commit …` — no wrappers, env
 * prefixes, compound shell, or dynamic tokens — with literal `-m`/`--message`
 * text only. Message text must keep the subject and non-trailer body lines
 * within 72 characters, a blank second line, and no attribution lines.
 */

const MAX_LINE_LENGTH = 72;

const TRAILER_RE = /^[A-Za-z0-9][A-Za-z0-9-]*:\s+\S/;
const CONTINUATION_RE = /^[ \t]/;
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const FORBIDDEN_PATTERNS: readonly (readonly [RegExp, string])[] = [
	[/\bco[-_ ]*authored[-_ ]*by\b/i, "co-authored-by"],
	[/\bco[-_ ]*author\b/i, "co-author"],
	[/\bauthored[-_ ]*by\b.*\bclaude\b/i, "authored-by Claude"],
	[/\bnoreply@anthropic\b/i, "noreply@anthropic"],
	[/\bclaude\b.*<[^>]+@[^>]+>/i, "Claude email"],
	[/^\s*generated with claude(?: code)?\s*$/i, "Claude attribution"],
];

interface ShellToken {
	text: string;
	dynamic: boolean;
}

const CONTROL_OPERATORS = new Set(["&&", "||", ";", "|", "&", "\n"]);
const COMMAND_START_KEYWORDS = new Set([
	"(",
	"{",
	"then",
	"do",
	"else",
	"elif",
	"if",
	"while",
	"until",
	"!",
]);
const WRAPPER_COMMANDS = new Set([
	"env",
	"command",
	"sudo",
	"time",
	"builtin",
	"nohup",
	"sh",
	"bash",
	"zsh",
	"fish",
	"timeout",
	"nice",
	"setsid",
	"stdbuf",
	"ionice",
]);
const SHELL_WRAPPER_COMMANDS = new Set(["sh", "bash", "zsh", "fish"]);

const GIT_GLOBAL_OPTS_WITH_VALUES = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--super-prefix",
	"--config-env",
]);
const GIT_GLOBAL_OPTS_WITH_EQUALS = [
	"--git-dir=",
	"--work-tree=",
	"--namespace=",
	"--super-prefix=",
	"--config-env=",
];

const UNSUPPORTED_MESSAGE_FLAGS: Record<string, string> = {
	"-F": "Use literal -m/--message text instead of -F/--file.",
	"--file": "Use literal -m/--message text instead of -F/--file.",
	"-c": "Do not reuse commit messages with -c/--reedit-message.",
	"-C": "Do not reuse commit messages with -C/--reuse-message.",
	"--reuse-message": "Do not reuse commit messages with -C/--reuse-message.",
	"--reedit-message": "Do not reuse commit messages with -c/--reedit-message.",
	"-t": "Do not use commit templates with -t/--template.",
	"--template": "Do not use commit templates with -t/--template.",
	"-e": "Do not open the editor with -e/--edit; use literal -m/--message text.",
	"--edit":
		"Do not open the editor with -e/--edit; use literal -m/--message text.",
	"-s": "Do not use -s/--signoff because it mutates the final commit message.",
	"--fixup": "Do not use --fixup because it rewrites the commit message.",
	"--squash": "Do not use --squash because it rewrites the commit message.",
	"--signoff":
		"Do not use --signoff because it mutates the final commit message.",
	"--trailer":
		"Do not use --trailer because it mutates the final commit message.",
	"--cleanup":
		"Do not use --cleanup because it can mutate the final commit message.",
	"--allow-empty-message": "Do not use --allow-empty-message.",
	"--no-verify": "Do not use --no-verify because it bypasses commit hooks.",
};

function basename(token: string): string {
	return token.slice(token.lastIndexOf("/") + 1);
}

function isGitBinary(token: string): boolean {
	return basename(token) === "git";
}

const DYNAMIC_FOLLOWERS =
	"({0123456789@*#?$!-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";

function startsDynamicValue(command: string, index: number): boolean {
	const char = command[index];
	if (char === "`") return true;
	if (char !== "$" || index + 1 >= command.length) return false;
	return DYNAMIC_FOLLOWERS.includes(command[index + 1] as string);
}

function tokenizeShellCommand(command: string): ShellToken[] {
	const tokens: ShellToken[] = [];
	let chars: string[] = [];
	let tokenStarted = false;
	let dynamic = false;
	let state: "plain" | "single" | "double" = "plain";
	let index = 0;

	const flush = () => {
		if (tokenStarted) tokens.push({ text: chars.join(""), dynamic });
		chars = [];
		tokenStarted = false;
		dynamic = false;
	};

	while (index < command.length) {
		const char = command[index] as string;

		if (state === "plain") {
			if (char === "\n") {
				flush();
				tokens.push({ text: "\n", dynamic: false });
				index += 1;
				continue;
			}
			if (/\s/.test(char)) {
				flush();
				index += 1;
				continue;
			}
			if (";|&(){}!".includes(char)) {
				flush();
				if (
					index + 1 < command.length &&
					command[index + 1] === char &&
					(char === "|" || char === "&")
				) {
					tokens.push({ text: char + char, dynamic: false });
					index += 2;
					continue;
				}
				tokens.push({ text: char, dynamic: false });
				index += 1;
				continue;
			}
			if (char === "'") {
				tokenStarted = true;
				state = "single";
				index += 1;
				continue;
			}
			if (char === '"') {
				tokenStarted = true;
				state = "double";
				index += 1;
				continue;
			}
			if (char === "\\") {
				tokenStarted = true;
				index += 1;
				if (index >= command.length)
					throw new Error("unterminated escape sequence");
				chars.push(command[index] as string);
				index += 1;
				continue;
			}

			tokenStarted = true;
			if (startsDynamicValue(command, index)) dynamic = true;
			chars.push(char);
			index += 1;
			continue;
		}

		if (state === "single") {
			if (char === "'") {
				state = "plain";
				index += 1;
				continue;
			}
			chars.push(char);
			index += 1;
			continue;
		}

		// state === "double"
		if (char === '"') {
			state = "plain";
			index += 1;
			continue;
		}
		if (char === "\\") {
			index += 1;
			if (index >= command.length)
				throw new Error("unterminated escape sequence");
			const escaped = command[index] as string;
			if ('"\\$`\n'.includes(escaped)) {
				chars.push(escaped);
			} else {
				chars.push("\\", escaped);
			}
			index += 1;
			continue;
		}
		if (startsDynamicValue(command, index)) dynamic = true;
		chars.push(char);
		index += 1;
	}

	if (state !== "plain") throw new Error("unterminated quote");

	flush();
	return tokens;
}

function isTrailerLine(line: string): boolean {
	return TRAILER_RE.test(line);
}

function isContinuationLine(line: string): boolean {
	return CONTINUATION_RE.test(line);
}

function finalTrailerBlock(lines: string[]): Set<number> {
	let end = lines.length - 1;
	while (end >= 0 && (lines[end] as string).trim() === "") end -= 1;

	if (end < 0) return new Set();

	let start = end;
	while (
		start >= 0 &&
		(isTrailerLine(lines[start] as string) ||
			isContinuationLine(lines[start] as string))
	) {
		start -= 1;
	}

	if (start >= 0 && (lines[start] as string).trim() !== "") return new Set();

	const block = lines.slice(start + 1, end + 1);
	if (!block.length || !block.some((line) => isTrailerLine(line)))
		return new Set();

	let sawTrailer = false;
	for (const line of block) {
		if (isTrailerLine(line)) {
			sawTrailer = true;
			continue;
		}
		if (isContinuationLine(line) && sawTrailer) continue;
		return new Set();
	}

	const indexes = new Set<number>();
	for (let i = start + 1; i <= end; i += 1) indexes.add(i);
	return indexes;
}

/** Validate final commit message text against the house rules. */
export function validateMessageText(text: string): string[] {
	const lines = text.split(/\r\n|\r|\n/);
	if (text === "") lines.length = 0;
	const errors: string[] = [];
	const trailerBlock = finalTrailerBlock(lines);

	if (!lines.length || (lines[0] as string).trim() === "") {
		return ["line 1: subject line is missing or empty"];
	}

	if ((lines[0] as string).length > MAX_LINE_LENGTH) {
		errors.push(`line 1: line exceeds ${MAX_LINE_LENGTH} characters`);
	}

	if (lines.length > 1 && (lines[1] as string).trim() !== "") {
		errors.push("line 2: body must start with a blank line after the subject");
	}

	lines.forEach((line, index) => {
		const lineNumber = index + 1;
		if (!trailerBlock.has(index) && line.length > MAX_LINE_LENGTH) {
			errors.push(
				`line ${lineNumber}: line exceeds ${MAX_LINE_LENGTH} characters`,
			);
		}
		for (const [pattern, label] of FORBIDDEN_PATTERNS) {
			if (pattern.test(line)) {
				errors.push(
					`line ${lineNumber}: forbidden attribution line (${label})`,
				);
				break;
			}
		}
	});

	return errors;
}

function commandStartIndexes(tokens: ShellToken[]): number[] {
	const starts = tokens.length ? [0] : [];
	tokens.slice(0, -1).forEach((token, index) => {
		if (
			CONTROL_OPERATORS.has(token.text) ||
			COMMAND_START_KEYWORDS.has(token.text)
		) {
			starts.push(index + 1);
		}
	});
	return starts;
}

function findCommitArgs(tokens: ShellToken[]): ShellToken[] | null {
	if (!tokens.length || !isGitBinary((tokens[0] as ShellToken).text))
		return null;

	let idx = 1;
	while (idx < tokens.length) {
		const token = (tokens[idx] as ShellToken).text;
		if (token === "commit") return tokens.slice(idx + 1);
		if (token === "--") return null;
		if (GIT_GLOBAL_OPTS_WITH_VALUES.has(token)) {
			idx += 2;
			continue;
		}
		if (
			GIT_GLOBAL_OPTS_WITH_EQUALS.some((prefix) => token.startsWith(prefix))
		) {
			idx += 1;
			continue;
		}
		if (token.startsWith("-")) {
			idx += 1;
			continue;
		}
		return null;
	}

	return null;
}

function startsDirectGitCommit(tokens: ShellToken[], start: number): boolean {
	if (
		start >= tokens.length ||
		!isGitBinary((tokens[start] as ShellToken).text)
	)
		return false;
	return findCommitArgs(tokens.slice(start)) !== null;
}

function startsWrappedGitCommit(tokens: ShellToken[], start: number): boolean {
	if (start >= tokens.length) return false;

	let index = start;
	const first = tokens[index] as ShellToken;
	if (first.dynamic && first.text.toLowerCase().endsWith("git")) {
		return (
			index + 1 < tokens.length &&
			(tokens[index + 1] as ShellToken).text === "commit"
		);
	}

	const command = basename(first.text);
	if (WRAPPER_COMMANDS.has(command)) {
		if (SHELL_WRAPPER_COMMANDS.has(command)) {
			return tokens
				.slice(index + 1)
				.some(
					(token) =>
						token.text.includes("git") && token.text.includes("commit"),
				);
		}

		index += 1;
		while (
			index < tokens.length &&
			((tokens[index] as ShellToken).text.startsWith("-") ||
				ASSIGNMENT_RE.test((tokens[index] as ShellToken).text))
		) {
			if (
				(tokens[index] as ShellToken).text.startsWith("-") &&
				index + 1 < tokens.length &&
				!(tokens[index + 1] as ShellToken).text.startsWith("-") &&
				!ASSIGNMENT_RE.test((tokens[index + 1] as ShellToken).text)
			) {
				index += 2;
				continue;
			}
			index += 1;
		}
		if (
			startsDirectGitCommit(tokens, index) ||
			startsWrappedGitCommit(tokens, index)
		) {
			return true;
		}

		let scan = index + 1;
		while (scan < tokens.length) {
			const text = (tokens[scan] as ShellToken).text;
			if (CONTROL_OPERATORS.has(text) || COMMAND_START_KEYWORDS.has(text))
				break;
			if (
				startsDirectGitCommit(tokens, scan) ||
				startsWrappedGitCommit(tokens, scan)
			) {
				return true;
			}
			scan += 1;
		}
		return false;
	}

	if (ASSIGNMENT_RE.test(first.text)) {
		while (
			index < tokens.length &&
			ASSIGNMENT_RE.test((tokens[index] as ShellToken).text)
		) {
			index += 1;
		}
		return startsDirectGitCommit(tokens, index);
	}

	return false;
}

function unsupportedFlagMessage(flag: string): string | undefined {
	if (flag in UNSUPPORTED_MESSAGE_FLAGS) return UNSUPPORTED_MESSAGE_FLAGS[flag];
	const prefixed: readonly (readonly [string, string])[] = [
		["--file=", UNSUPPORTED_MESSAGE_FLAGS["--file"] as string],
		[
			"--reuse-message=",
			UNSUPPORTED_MESSAGE_FLAGS["--reuse-message"] as string,
		],
		[
			"--reedit-message=",
			UNSUPPORTED_MESSAGE_FLAGS["--reedit-message"] as string,
		],
		["--template=", UNSUPPORTED_MESSAGE_FLAGS["--template"] as string],
		["--fixup=", UNSUPPORTED_MESSAGE_FLAGS["--fixup"] as string],
		["--squash=", UNSUPPORTED_MESSAGE_FLAGS["--squash"] as string],
		["--trailer=", UNSUPPORTED_MESSAGE_FLAGS["--trailer"] as string],
		["--cleanup=", UNSUPPORTED_MESSAGE_FLAGS["--cleanup"] as string],
	];
	for (const [prefix, message] of prefixed) {
		if (flag.startsWith(prefix)) return message;
	}
	return undefined;
}

function parseShortOptions(
	token: ShellToken,
	args: ShellToken[],
	index: number,
): { messages: ShellToken[]; index: number; errors: string[] } {
	const messages: ShellToken[] = [];
	const errors: string[] = [];
	const shortFlags = token.text.slice(1);
	let cursor = 0;

	while (cursor < shortFlags.length) {
		const flag = shortFlags[cursor] as string;
		if (flag === "m") {
			const attachedValue = shortFlags.slice(cursor + 1);
			if (attachedValue) {
				messages.push({ text: attachedValue, dynamic: token.dynamic });
				return { messages, index, errors };
			}
			if (index + 1 >= args.length) {
				errors.push("Commit message is missing after -m.");
				return { messages, index, errors };
			}
			messages.push(args[index + 1] as ShellToken);
			return { messages, index: index + 1, errors };
		}

		if ("FcCtes".includes(flag)) {
			errors.push(
				unsupportedFlagMessage(`-${flag}`) ?? `Unsupported flag: -${flag}`,
			);
			if (
				cursor === shortFlags.length - 1 &&
				flag !== "e" &&
				index + 1 < args.length
			) {
				return { messages, index: index + 1, errors };
			}
			return { messages, index, errors };
		}

		cursor += 1;
	}

	return { messages, index, errors };
}

/**
 * Extract the literal commit message from a shell command. Returns the
 * joined message when the command is a valid direct commit, `null` with no
 * errors when the command contains no commit, and `null` with errors when
 * the commit invocation itself is not allowed.
 */
export function extractMessageFromCommand(command: string): {
	message: string | null;
	errors: string[];
} {
	let tokens: ShellToken[];
	try {
		tokens = tokenizeShellCommand(command);
	} catch (error) {
		return {
			message: null,
			errors: [
				`Unable to parse git commit command: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}

	const starts = commandStartIndexes(tokens);
	const directStart = starts.find((start) =>
		startsDirectGitCommit(tokens, start),
	);

	if (directStart === undefined) {
		if (starts.some((start) => startsWrappedGitCommit(tokens, start))) {
			return {
				message: null,
				errors: [
					"Commit command must be a direct `git ... commit ...` invocation. Wrappers, env prefixes, and compound shell commands are not allowed.",
				],
			};
		}
		return { message: null, errors: [] };
	}

	if (directStart !== 0 || starts.length > 1) {
		return {
			message: null,
			errors: [
				"Commit command must be a direct `git ... commit ...` invocation. Wrappers, env prefixes, and compound shell commands are not allowed.",
			],
		};
	}

	const commitArgs = findCommitArgs(tokens);
	if (commitArgs === null) return { message: null, errors: [] };

	if (commitArgs.some((token) => token.dynamic)) {
		return {
			message: null,
			errors: [
				"Commit command must not contain shell expansion, command substitution, or variables in commit arguments. Use literal flags and literal message text only.",
			],
		};
	}

	const messages: ShellToken[] = [];
	const errors: string[] = [];
	let idx = 0;

	while (idx < commitArgs.length) {
		const token = commitArgs[idx] as ShellToken;
		const tokenText = token.text;

		const unsupported = unsupportedFlagMessage(tokenText);
		if (unsupported !== undefined) {
			errors.push(unsupported);
			idx += 1;
			continue;
		}

		if (tokenText === "--message") {
			if (idx + 1 >= commitArgs.length) {
				errors.push("Commit message is missing after --message.");
				break;
			}
			messages.push(commitArgs[idx + 1] as ShellToken);
			idx += 2;
			continue;
		}

		if (tokenText.startsWith("--message=")) {
			messages.push({
				text: tokenText.split(/=(.*)/s)[1] as string,
				dynamic: token.dynamic,
			});
			idx += 1;
			continue;
		}

		if (tokenText.startsWith("--")) {
			idx += 1;
			continue;
		}

		if (tokenText.startsWith("-") && tokenText !== "-") {
			const parsed = parseShortOptions(token, commitArgs, idx);
			messages.push(...parsed.messages);
			errors.push(...parsed.errors);
			idx = parsed.index + 1;
			continue;
		}

		idx += 1;
	}

	if (errors.length) return { message: null, errors };

	if (!messages.length) {
		return {
			message: null,
			errors: [
				"Commit has no literal -m/--message content. Use -m or --message with full commit text.",
			],
		};
	}

	if (messages.some((message) => message.dynamic)) {
		return {
			message: null,
			errors: [
				"Commit messages must be literal text. Shell expansion, command substitution, and variables are not allowed.",
			],
		};
	}

	return {
		message: messages.map((message) => message.text).join("\n\n"),
		errors: [],
	};
}

/**
 * Return a block reason for a shell command containing an invalid `git
 * commit`, or `undefined` when the command is fine (valid commit or no
 * commit at all). Commands that never mention `git` and `commit` are
 * skipped without tokenizing, so unrelated commands with heredocs or odd
 * quoting are never blocked.
 */
export function commitGuardReason(command: string): string | undefined {
	if (!/\bgit\b/.test(command) || !/\bcommit\b/.test(command)) return undefined;

	const { message, errors } = extractMessageFromCommand(command);
	const allErrors =
		errors.length || message === null ? errors : validateMessageText(message);
	if (!allErrors.length) return undefined;
	return [
		"Commit message validation failed:",
		...allErrors.map((e) => `- ${e}`),
	].join("\n");
}
