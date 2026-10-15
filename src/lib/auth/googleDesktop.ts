import type { User } from "@supabase/supabase-js";
import type { GoogleAuthState, GoogleResult } from "@/types/googleDrive";

export class GoogleDesktopError extends Error {
	constructor(
		message: string,
		public code: string,
	) {
		super(message);
	}
}
export function unwrapGoogle<T>(result: GoogleResult<T>) {
	if (!result.success) throw new GoogleDesktopError(result.error, result.code);
	return result.data;
}
type Snapshot = GoogleAuthState & { loading: boolean; error?: string };
let snapshot: Snapshot = { configured: false, user: null, authorizing: false, loading: true };
const listeners = new Set<() => void>();
let started = false;
const publish = (state: GoogleAuthState) => {
	if ((state.revision ?? 0) < (snapshot.revision ?? 0)) return;
	snapshot = { ...state, loading: false };
	for (const listener of listeners) listener();
};
export const getGoogleSnapshot = () => snapshot;
export function subscribeGoogleAuth(listener: () => void) {
	listeners.add(listener);
	if (!started) {
		started = true;
		if (typeof window.electronAPI?.googleAuthState !== "function")
			publish({ configured: false, user: null, authorizing: false });
		else {
			window.electronAPI.onGoogleAuthChanged(publish);
			void window.electronAPI
				.googleAuthState()
				.then((result) => publish(unwrapGoogle(result)))
				.catch((error) => {
					snapshot = {
						...snapshot,
						loading: false,
						error: error instanceof Error ? error.message : String(error),
					};
					for (const callback of listeners) callback();
				});
		}
	}
	return () => {
		listeners.delete(listener);
	};
}
export async function signInGoogleDesktop() {
	if (!window.electronAPI?.googleAuthSignIn)
		throw new GoogleDesktopError(
			"Open the latest Recordly desktop app to sign in with Google.",
			"DESKTOP_REQUIRED",
		);
	const state = unwrapGoogle(await window.electronAPI.googleAuthSignIn());
	publish(state);
	return state;
}
export async function importGoogleClient() {
	if (!window.electronAPI?.googleAuthImportClient)
		throw new GoogleDesktopError(
			"Open the latest Recordly desktop app to import a Google client.",
			"DESKTOP_REQUIRED",
		);
	const state = unwrapGoogle(await window.electronAPI.googleAuthImportClient());
	publish(state);
	return state;
}
export async function signOutGoogleDesktop() {
	if (window.electronAPI?.googleAuthSignOut)
		publish(unwrapGoogle(await window.electronAPI.googleAuthSignOut()));
}
export function googleAccountUser(state: GoogleAuthState): User | null {
	if (!state.user) return null;
	return {
		id: state.user.id,
		email: state.user.email,
		aud: "google-desktop",
		app_metadata: { provider: "google" },
		user_metadata: { full_name: state.user.name, avatar_url: state.user.picture },
		created_at: "1970-01-01T00:00:00.000Z",
	};
}
