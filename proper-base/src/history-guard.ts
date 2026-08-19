const INSTALLED = Symbol.for("pi-proper-base.history-guard");

type HistoryEditor = {
	addToHistory?(text: string): void;
	[INSTALLED]?: HistoryGuard;
};

export type HistoryGuard = {
	add(text: string): void;
};

export function installHistoryGuard(
	editor: HistoryEditor,
): HistoryGuard | undefined {
	if (editor[INSTALLED]) return editor[INSTALLED];
	if (!editor.addToHistory) return undefined;

	const addToHistory = editor.addToHistory.bind(editor);
	const controller: HistoryGuard = {
		add(text) {
			const prompt = text.trim();
			if (prompt) addToHistory(prompt);
		},
	};

	// Pi replays transformed session messages through this method on startup.
	// Block those calls; only editor submissions and the raw prompt store use
	// the captured method through controller.add().
	editor.addToHistory = () => {};
	editor[INSTALLED] = controller;
	return controller;
}
