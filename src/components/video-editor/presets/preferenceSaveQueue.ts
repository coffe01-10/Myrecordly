import type { EditorPreferences } from "../editorPreferences";

/** Coalesce slider updates before the synchronous settings IPC blocks the renderer. */
export function createPreferenceSaveQueue(
	save: (preferences: Partial<EditorPreferences>) => void,
	delayMs = 150,
) {
	let pending: Partial<EditorPreferences> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const flush = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		if (pending === null) return;
		const preferences = pending;
		pending = null;
		save(preferences);
	};
	return {
		flush,
		schedule(preferences: Partial<EditorPreferences>) {
			pending = preferences;
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(flush, delayMs);
		},
	};
}
