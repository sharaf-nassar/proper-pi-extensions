import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { installRailSetting, readRailEnabled } from "../src/rail-setting.ts";

const ITEM_ID = "proper-base-session-rail";

type Item = {
	id: string;
	currentValue: string;
	values?: string[];
};

class FakeEditor {
	render() {
		return [];
	}
}

class SettingsSelectorComponent {
	settingsList: {
		items: Item[];
		onChange: (id: string, value: string) => void;
	};
	seen: Array<[string, string]> = [];
	constructor() {
		this.settingsList = {
			items: [{ id: "autocompact", currentValue: "true" }],
			onChange: (id, value) => {
				this.seen.push([id, value]);
			},
		};
	}
	render() {
		return [];
	}
}

function harness() {
	const dir = mkdtempSync(join(tmpdir(), "rail-setting-"));
	const editor = new FakeEditor();
	const container = {
		children: [editor] as unknown[],
		addChild(component: unknown) {
			this.children.push(component);
		},
	};
	const tui = { children: [container] };
	return { dir, editor, container, tui };
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

// @lat: [[lat.md/proper-base/tests#Verification#Rail setting fixture]]
test("the settings selector gains a persisted rail toggle", async () => {
	const { dir, editor, container, tui } = harness();
	const controller = installRailSetting(tui as never, editor as never, dir);
	await tick();
	assert.equal(controller.enabled(), true);

	// A mounted settings selector receives the toggle; other components and
	// Pi's own items are untouched.
	const selector = new SettingsSelectorComponent();
	container.addChild(selector);
	container.addChild(new FakeEditor());
	const item = selector.settingsList.items.find((i) => i.id === ITEM_ID);
	assert.ok(item);
	assert.equal(item.currentValue, "true");
	assert.deepEqual(item.values, ["true", "false"]);

	// Toggling through the list changes the live rail state, persists it,
	// and stays out of Pi's own change handler; native ids still reach it.
	selector.settingsList.onChange(ITEM_ID, "false");
	assert.equal(controller.enabled(), false);
	assert.equal(readRailEnabled(dir), false);
	selector.settingsList.onChange("autocompact", "false");
	assert.deepEqual(selector.seen, [["autocompact", "false"]]);

	// The next session reads the persisted choice; a fresh selector shows it.
	const replacement = installRailSetting(tui as never, editor as never, dir);
	await tick();
	assert.equal(replacement.enabled(), false);
	const second = new SettingsSelectorComponent();
	container.addChild(second);
	assert.equal(
		second.settingsList.items.find((i) => i.id === ITEM_ID)?.currentValue,
		"false",
	);

	// Unrelated config keys survive the toggle write.
	writeFileSync(
		join(dir, "proper-base.json"),
		'{\n\t"other": 1,\n\t"sessionRail": false\n}\n',
	);
	second.settingsList.onChange(ITEM_ID, "true");
	const stored = JSON.parse(
		readFileSync(join(dir, "proper-base.json"), "utf8"),
	) as Record<string, unknown>;
	assert.equal(stored.other, 1);
	assert.equal(stored.sessionRail, true);

	// Disposal restores the container's own addChild.
	replacement.dispose();
	const after = new SettingsSelectorComponent();
	container.addChild(after);
	assert.equal(
		after.settingsList.items.some((i) => i.id === ITEM_ID),
		false,
	);
});

test("a missing or damaged config enables the rail and installs nothing twice", async () => {
	const { dir, editor, container, tui } = harness();
	assert.equal(readRailEnabled(dir), true);
	writeFileSync(join(dir, "proper-base.json"), "not json");
	assert.equal(readRailEnabled(dir), true);

	// A reload's replacement wrapper takes over instead of stacking.
	const first = installRailSetting(tui as never, editor as never, dir);
	await tick();
	const second = installRailSetting(tui as never, editor as never, dir);
	await tick();
	const selector = new SettingsSelectorComponent();
	container.addChild(selector);
	assert.equal(
		selector.settingsList.items.filter((i) => i.id === ITEM_ID).length,
		1,
	);
	first.dispose();
	second.dispose();
});
