import assert from "node:assert/strict";
import { test } from "node:test";

import type { TUI } from "@earendil-works/pi-tui";

import {
	installOsc8LinkIds,
	tagAnonymousOsc8Links,
} from "../src/osc8-link-ids.ts";

const ST = "\x1b\\";
const ID_PREFIX = "\x1b]8;id=";
const open = (uri: string) => `\x1b]8;;${uri}${ST}`;
const CLOSE = `\x1b]8;;${ST}`;

function idOf(data: string): string | undefined {
	if (!data.startsWith(ID_PREFIX)) return undefined;
	const end = data.indexOf(";", ID_PREFIX.length);
	return end === -1 ? undefined : data.slice(ID_PREFIX.length, end);
}

test("anonymous opens gain a stable URI-derived id across rows", () => {
	const row1 = tagAnonymousOsc8Links(
		`${open("https://x.test/a")}https://x.te${CLOSE}   `,
	);
	const row2 = tagAnonymousOsc8Links(`${open("https://x.test/a")}st/a${CLOSE}`);
	const id = idOf(row1);
	assert.ok(id);
	assert.ok(row1.startsWith(`${ID_PREFIX}${id};https://x.test/a${ST}`));
	assert.ok(row1.endsWith(`${CLOSE}   `));
	assert.ok(row2.startsWith(`${ID_PREFIX}${id};https://x.test/a${ST}`));
	assert.notEqual(idOf(tagAnonymousOsc8Links(open("https://x.test/b"))), id);
});

test("closes, explicit params, BEL terminators, and plain text pass through", () => {
	assert.equal(tagAnonymousOsc8Links(CLOSE), CLOSE);
	const explicit = `\x1b]8;id=app;https://x.test/a${ST}text${CLOSE}`;
	assert.equal(tagAnonymousOsc8Links(explicit), explicit);
	const malformed = "\x1b]8;;https://x.test/a\x1b[31munterminated";
	assert.equal(tagAnonymousOsc8Links(malformed), malformed);
	const bel = "\x1b]8;;https://x.test/a\x07text\x1b]8;;\x07";
	const taggedBel = tagAnonymousOsc8Links(bel);
	assert.ok(taggedBel.startsWith(ID_PREFIX));
	assert.ok(taggedBel.endsWith("\x07text\x1b]8;;\x07"));
	const plain = "no links here";
	assert.equal(tagAnonymousOsc8Links(plain), plain);
});

test("install wraps terminal writes and dispose restores them", () => {
	const writes: string[] = [];
	class FakeTerminal {
		write(data: string) {
			writes.push(data);
		}
	}
	const terminal = new FakeTerminal();
	const tui = { terminal } as unknown as TUI;
	const dispose = installOsc8LinkIds(tui);
	assert.ok(dispose);
	assert.equal(installOsc8LinkIds(tui), dispose);
	terminal.write(`${open("https://x.test/a")}text${CLOSE}`);
	assert.ok(writes[0]?.startsWith(ID_PREFIX));
	dispose?.();
	assert.equal(Object.hasOwn(terminal, "write"), false);
	terminal.write(`${open("https://x.test/a")}text${CLOSE}`);
	assert.ok(writes[1]?.startsWith("\x1b]8;;https"));
	assert.equal(installOsc8LinkIds({} as TUI), undefined);
});
