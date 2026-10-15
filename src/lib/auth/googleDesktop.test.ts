import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GoogleAuthState, GoogleResult } from "@/types/googleDrive";
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
it("does not restore a signed-out user from a delayed initial native response", async () => {
	let resolveState!: (result: GoogleResult<GoogleAuthState>) => void;
	let changed!: (state: GoogleAuthState) => void;
	vi.stubGlobal("window", {
		electronAPI: {
			googleAuthState: () =>
				new Promise<GoogleResult<GoogleAuthState>>((resolve) => {
					resolveState = resolve;
				}),
			onGoogleAuthChanged: (callback: typeof changed) => {
				changed = callback;
				return () => {};
			},
		},
	});
	const store = await import("./googleDesktop");
	store.subscribeGoogleAuth(() => {});
	changed({ configured: true, user: null, authorizing: false, revision: 2 });
	resolveState({
		success: true,
		data: {
			configured: true,
			user: { id: "google:alice", email: "alice@example.test" },
			authorizing: false,
			revision: 1,
		},
	});
	await Promise.resolve();
	await Promise.resolve();
	expect(store.getGoogleSnapshot().user).toBeNull();
});
it("exposes a profile for account UI without a Supabase access token", async () => {
	const { googleAccountUser } = await import("./googleDesktop");
	const user = googleAccountUser({
		configured: true,
		user: { id: "google:alice", email: "alice@example.test", name: "Alice" },
		authorizing: false,
	});
	expect(user).toMatchObject({
		id: "google:alice",
		aud: "google-desktop",
		user_metadata: { full_name: "Alice" },
	});
	expect(user).not.toHaveProperty("access_token");
});
