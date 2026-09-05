import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Component, TUI } from "@earendil-works/pi-tui";

// Keyed by its original name: a /reload of a build that still runs the
// rail-only module must find and hand over the wrapper it installed.
const INSTALLED = Symbol.for("pi-proper-base.rail-setting");

/** Each toggle proper-base splices into Pi's `/settings` menu. */
const TOGGLES = [
	{
		id: "proper-base-session-rail",
		key: "sessionRail",
		label: "Session action rail",
		description:
			"proper-base: colored per-action jump symbols along the transcript's right edge",
	},
	{
		id: "proper-base-editor-mouse",
		key: "editorMouse",
		label: "Prompt mouse clicks",
		description:
			"proper-base: clicking the prompt moves the cursor; off leaves the cursor where typing put it",
	},
] as const;
type ToggleKey = (typeof TOGGLES)[number]["key"];

type SettingItem = {
	id: string;
	label: string;
	description?: string;
	currentValue: string;
	values?: string[];
};
/** Pi's settings selector, by shape: a component holding a SettingsList. */
type SettingsHost = Component & {
	settingsList?: {
		items?: SettingItem[];
		onChange?: (id: string, value: string) => void;
	};
};
type ComponentContainer = Component & {
	children: Component[];
	addChild(component: Component): void;
};
type InstalledContainer = ComponentContainer & { [INSTALLED]?: () => void };

export type SettingsController = {
	/** Whether the session action rail is enabled. Cached per session. */
	enabled(): boolean;
	/** Whether prompt clicks may move the editor cursor. Cached per session. */
	editorMouse(): boolean;
	dispose(): void;
};

function configPath(agentDir: string): string {
	return join(agentDir, "proper-base.json");
}

function readToggle(agentDir: string, key: ToggleKey): boolean {
	try {
		const parsed = JSON.parse(
			readFileSync(configPath(agentDir), "utf8"),
		) as unknown;
		return (parsed as Record<string, unknown> | null)?.[key] !== false;
	} catch {
		return true;
	}
}

export function readRailEnabled(agentDir: string): boolean {
	return readToggle(agentDir, "sessionRail");
}

export function readEditorMouseEnabled(agentDir: string): boolean {
	return readToggle(agentDir, "editorMouse");
}

/** Fail-open like the history store: a read-only agent dir only costs
 * persistence, never the session. Other keys in the file are preserved. */
function writeToggle(agentDir: string, key: ToggleKey, enabled: boolean): void {
	try {
		let parsed: Record<string, unknown> = {};
		try {
			const existing = JSON.parse(
				readFileSync(configPath(agentDir), "utf8"),
			) as unknown;
			if (existing && typeof existing === "object") {
				parsed = existing as Record<string, unknown>;
			}
		} catch {
			// Damaged or absent config starts fresh.
		}
		parsed[key] = enabled;
		writeFileSync(
			configPath(agentDir),
			`${JSON.stringify(parsed, null, "\t")}\n`,
		);
	} catch {
		// Persistence is best-effort.
	}
}

function componentName(component: Component): string | undefined {
	return (component as { constructor?: { name?: string } }).constructor?.name;
}

function childrenOf(component: Component): Component[] {
	return (component as Partial<ComponentContainer>).children ?? [];
}

function findEditorContainer(
	tui: TUI,
	editor: Component,
): ComponentContainer | undefined {
	const roots = (tui as TUI & { layoutRoot?: Component }).layoutRoot
		? [(tui as TUI & { layoutRoot?: Component }).layoutRoot as Component]
		: tui.children;
	const visit = (component: Component): ComponentContainer | undefined => {
		const children = childrenOf(component);
		if (
			children.includes(editor) &&
			typeof (component as Partial<ComponentContainer>).addChild === "function"
		) {
			return component as ComponentContainer;
		}
		for (const child of children) {
			const found = visit(child);
			if (found) return found;
		}
		return undefined;
	};
	for (const root of roots) {
		const found = visit(root);
		if (found) return found;
	}
	return undefined;
}

/**
 * Add proper-base's toggles to Pi's native `/settings` menu: the session
 * action rail and prompt mouse clicks.
 *
 * Pi has no extension hook into that menu, so this is a guarded
 * compatibility layer in the house style: the container Pi mounts selectors
 * into is the editor's own parent, its `addChild` is wrapped once, and every
 * settings selector that mounts receives the extra items spliced into its
 * `SettingsList`, whose instance-held `onChange` is wrapped to keep the
 * toggles out of Pi's own switch. A renamed component or list shape installs
 * or injects nothing and both features simply stay enabled.
 *
 * Choices persist as `sessionRail` and `editorMouse` in the agent
 * directory's `proper-base.json`; other sessions pick a change up at their
 * next start.
 *
 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Session action rail]]
 * @lat: [[lat.md/proper-base/lifecycle#Prompt history lifecycle#Prompt mouse clicks]]
 */
export function installSettings(
	tui: TUI,
	editor: Component,
	agentDir: string,
): SettingsController {
	const state: Record<ToggleKey, boolean> = {
		sessionRail: readToggle(agentDir, "sessionRail"),
		editorMouse: readToggle(agentDir, "editorMouse"),
	};
	let disposed = false;
	let uninstall: (() => void) | undefined;

	const inject = (selector: SettingsHost): void => {
		const list = selector.settingsList;
		const items = list?.items;
		if (!list || !Array.isArray(items) || typeof list.onChange !== "function")
			return;
		if (items.some((item) => item?.id === TOGGLES[0].id)) return;
		for (const toggle of TOGGLES) {
			items.push({
				id: toggle.id,
				label: toggle.label,
				description: toggle.description,
				currentValue: state[toggle.key] ? "true" : "false",
				values: ["true", "false"],
			});
		}
		const native = list.onChange;
		list.onChange = (id, value) => {
			const toggle = TOGGLES.find((entry) => entry.id === id);
			if (toggle) {
				state[toggle.key] = value === "true";
				writeToggle(agentDir, toggle.key, state[toggle.key]);
				return;
			}
			native(id, value);
		};
	};

	const wrap = () => {
		if (disposed) return;
		const container = findEditorContainer(tui, editor) as
			| InstalledContainer
			| undefined;
		if (!container) return;
		// A reload runs the new factory before the outgoing instance shuts
		// down; take over any wrapper it left.
		container[INSTALLED]?.();
		const native = container.addChild.bind(container);
		const wrapped = (component: Component) => {
			native(component);
			if (componentName(component) === "SettingsSelectorComponent") {
				inject(component as SettingsHost);
			}
		};
		container.addChild = wrapped;
		const restore = () => {
			if (container.addChild === wrapped) {
				container.addChild = native;
			}
			delete container[INSTALLED];
		};
		container[INSTALLED] = restore;
		uninstall = restore;
	};

	// The editor mounts into its container right after the factory returns,
	// so the parent walk has to wait a tick.
	queueMicrotask(wrap);

	return {
		enabled: () => state.sessionRail,
		editorMouse: () => state.editorMouse,
		dispose() {
			disposed = true;
			uninstall?.();
			uninstall = undefined;
		},
	};
}
