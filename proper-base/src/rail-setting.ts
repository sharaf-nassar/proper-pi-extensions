// Transitional re-export: the test file that imports this path is guarded
// against deletion and moves in a follow-up. Both go together.
export {
	installSettings as installRailSetting,
	readRailEnabled,
} from "./settings.ts";
