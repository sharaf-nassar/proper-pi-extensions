import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	installSettings,
	readEditorMouseEnabled,
	readRailEnabled,
} from "../src/settings.ts";

const RAIL_ID = "proper-base-session-rail";
const MOUSE_ID = "proper-base-editor-mouse";

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
	const dir = mkdtempSync(join(tmpdir(), "proper-base-settings-"));
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

// @lat: [[lat.md/proper-base/tests#Verification#Settings fixture]]
test("the settings selector gains persisted rail and mouse toggles", async () => {
	const { dir, editor, container, tui } = harness();
	const controller = installSettings(tui as never, editor as never, dir);
	await tick();
	assert.equal(controller.enabled(), true);
	assert.equal(controller.editorMouse(), true);

	// A mounted settings selector receives both toggles; other components and
	// Pi's own items are untouched.
	const selector = new SettingsSelectorComponent();
	container.addChild(selector);
	container.addChild(new FakeEditor());
	const rail = selector.settingsList.items.find((i) => i.id === RAIL_ID);
	const mouse = selector.settingsList.items.find((i) => i.id === MOUSE_ID);
	assert.ok(rail);
	assert.ok(mouse);
	assert.equal(rail.currentValue, "true");
	assert.equal(mouse.currentValue, "true");
	assert.deepEqual(rail.values, ["true", "false"]);
	assert.deepEqual(mouse.values, ["true", "false"]);

	// Toggling through the list changes the live state, persists it under
	// its own key, and stays out of Pi's own change handler; native ids
	// still reach it.
	selector.settingsList.onChange(RAIL_ID, "false");
	assert.equal(controller.enabled(), false);
	assert.equal(controller.editorMouse(), true);
	assert.equal(readRailEnabled(dir), false);
	assert.equal(readEditorMouseEnabled(dir), true);
	selector.settingsList.onChange(MOUSE_ID, "false");
	assert.equal(controller.editorMouse(), false);
	assert.equal(readEditorMouseEnabled(dir), false);
	selector.settingsList.onChange("autocompact", "false");
	assert.deepEqual(selector.seen, [["autocompact", "false"]]);

	// The next session reads the persisted choices; a fresh selector shows
	// them.
	const replacement = installSettings(tui as never, editor as never, dir);
	await tick();
	assert.equal(replacement.enabled(), false);
	assert.equal(replacement.editorMouse(), false);
	const second = new SettingsSelectorComponent();
	container.addChild(second);
	assert.equal(
		second.settingsList.items.find((i) => i.id === RAIL_ID)?.currentValue,
		"false",
	);
	assert.equal(
		second.settingsList.items.find((i) => i.id === MOUSE_ID)?.currentValue,
		"false",
	);

	// Unrelated config keys and the sibling toggle survive a write.
	writeFileSync(
		join(dir, "proper-base.json"),
		'{\n\t"other": 1,\n\t"sessionRail": false,\n\t"editorMouse": false\n}\n',
	);
	second.settingsList.onChange(RAIL_ID, "true");
	const stored = JSON.parse(
		readFileSync(join(dir, "proper-base.json"), "utf8"),
	) as Record<string, unknown>;
	assert.equal(stored.other, 1);
	assert.equal(stored.sessionRail, true);
	assert.equal(stored.editorMouse, false);

	// Disposal restores the container's own addChild.
	replacement.dispose();
	const after = new SettingsSelectorComponent();
	container.addChild(after);
	assert.equal(
		after.settingsList.items.some((i) => i.id === RAIL_ID),
		false,
	);
});

test("a missing or damaged config enables both and installs nothing twice", async () => {
	const { dir, editor, container, tui } = harness();
	assert.equal(readRailEnabled(dir), true);
	assert.equal(readEditorMouseEnabled(dir), true);
	writeFileSync(join(dir, "proper-base.json"), "not json");
	assert.equal(readRailEnabled(dir), true);
	assert.equal(readEditorMouseEnabled(dir), true);

	// A reload's replacement wrapper takes over instead of stacking.
	const first = installSettings(tui as never, editor as never, dir);
	await tick();
	const second = installSettings(tui as never, editor as never, dir);
	await tick();
	const selector = new SettingsSelectorComponent();
	container.addChild(selector);
	assert.equal(
		selector.settingsList.items.filter((i) => i.id === RAIL_ID).length,
		1,
	);
	assert.equal(
		selector.settingsList.items.filter((i) => i.id === MOUSE_ID).length,
		1,
	);
	first.dispose();
	second.dispose();
});
