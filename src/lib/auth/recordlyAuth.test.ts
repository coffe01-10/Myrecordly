import { afterEach, beforeEach, expect, it, vi } from "vitest";

const emailOtp = vi.hoisted(() => vi.fn(async (_options: unknown) => ({ error: null })));
const connectDrive = vi.hoisted(() => vi.fn(async (_session: unknown) => {}));
vi.mock("../drive/googleDrive", () => ({ connectDriveSession: connectDrive }));
const exchange = vi.hoisted(() => vi.fn(async (_code: string) => ({ error: null })));
const oauth = vi.hoisted(() =>
	vi.fn(async (_options: unknown) => ({
		data: { url: "https://auth.example.test/oauth" },
		error: null,
	})),
);
vi.mock("@supabase/supabase-js", () => ({
	createClient: () => ({
		auth: { exchangeCodeForSession: exchange, signInWithOAuth: oauth, signInWithOtp: emailOtp },
	}),
}));
beforeEach(() => {
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
	});
	vi.stubGlobal("sessionStorage", { getItem: () => null, removeItem: () => {} });
	vi.stubGlobal("window", { dispatchEvent: vi.fn() });
	vi.resetModules();
	exchange.mockClear();
	oauth.mockClear();
	emailOtp.mockClear();
	connectDrive.mockClear();
	vi.stubEnv("VITE_SUPABASE_URL", "https://auth.example.test");
	vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-key");
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

it("exchanges a callback once when live and pending delivery overlap", async () => {
	const { completeAuthCallback } = await import("./recordlyAuth");
	const url = "recordly://auth/callback?code=one-time-code";
	await Promise.all([completeAuthCallback(url), completeAuthCallback(url)]);
	await completeAuthCallback(url);
	expect(exchange).toHaveBeenCalledExactlyOnceWith("one-time-code");
});

it("shows provider errors without attempting a code exchange", async () => {
	const { completeAuthCallback } = await import("./recordlyAuth");
	await expect(
		completeAuthCallback(
			"recordly://auth/callback?error=denied&error_description=Sign-in+cancelled",
		),
	).rejects.toThrow("Sign-in cancelled");
	expect(exchange).not.toHaveBeenCalled();
});

it("connects Drive once after completing a Google login callback", async () => {
	const session = {
		provider_token: "google-access",
		provider_refresh_token: "google-refresh",
		user: { id: "owner" },
	};
	localStorage.setItem("recordly.oauth-provider", "google");
	exchange.mockImplementationOnce(async () => ({ error: null, data: { session } }));
	const { completeAuthCallback } = await import("./recordlyAuth");
	await Promise.all([
		completeAuthCallback("recordly://auth/callback?code=google"),
		completeAuthCallback("recordly://auth/callback?code=google"),
	]);
	expect(connectDrive).toHaveBeenCalledExactlyOnceWith(session);
	expect(localStorage.getItem("recordly.oauth-provider")).toBeNull();
});

it("does not mistake a linked account's GitHub token for a Google Drive token", async () => {
	localStorage.setItem("recordly.oauth-provider", "github");
	exchange.mockImplementationOnce(async () => ({
		error: null,
		data: {
			session: {
				provider_token: "github-token",
				user: { app_metadata: { provider: "google" } },
			},
		},
	}));
	const { completeAuthCallback } = await import("./recordlyAuth");
	await completeAuthCallback("recordly://auth/callback?code=github");
	expect(connectDrive).not.toHaveBeenCalled();
});

it("requests Microsoft's email scope and opens its OAuth URL externally", async () => {
	const openExternalUrl = vi.fn(async () => ({ success: true }));
	vi.stubGlobal("window", { electronAPI: { openExternalUrl } });
	const { signInWithSocial } = await import("./recordlyAuth");
	await signInWithSocial("azure");
	expect(oauth).toHaveBeenCalledWith(
		expect.objectContaining({
			provider: "azure",
			options: expect.objectContaining({ scopes: "email", skipBrowserRedirect: true }),
		}),
	);
	expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith("https://auth.example.test/oauth");
});

it("requests offline Drive file access when signing in with Google", async () => {
	vi.stubGlobal("window", { electronAPI: { openExternalUrl: async () => ({ success: true }) } });
	const { signInWithSocial } = await import("./recordlyAuth");
	await signInWithSocial("google");
	expect(oauth).toHaveBeenCalledWith(
		expect.objectContaining({
			provider: "google",
			options: expect.objectContaining({
				scopes: "https://www.googleapis.com/auth/drive.file",
				queryParams: { access_type: "offline", prompt: "consent" },
			}),
		}),
	);
	expect(localStorage.getItem("recordly.oauth-provider")).toBe("google");
});

for (const dev of [true, false]) {
	it(`requests an app-initiated email link with the ${dev ? "development" : "installed"} callback`, async () => {
		vi.stubEnv("DEV", dev);
		const { sendSignInLink } = await import("./recordlyAuth");
		await sendSignInLink("owner@example.test");
		expect(emailOtp).toHaveBeenCalledExactlyOnceWith({
			email: "owner@example.test",
			options: {
				emailRedirectTo: dev
					? "http://127.0.0.1:43821/auth/callback"
					: "recordly://auth/callback",
				shouldCreateUser: true,
			},
		});
	});
}

it("does not accept dashboard implicit session tokens as a PKCE callback", async () => {
	const { completeAuthCallback } = await import("./recordlyAuth");
	await expect(
		completeAuthCallback("recordly://auth/callback#access_token=test&refresh_token=test"),
	).rejects.toThrow("Request a new sign-in link from Recordly");
	expect(exchange).not.toHaveBeenCalled();
});
