import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { GoogleDesktopAuth, parseDesktopClient, type GoogleSession } from "./auth";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let saved: GoogleSession | null;
let googleFetch: ReturnType<typeof vi.fn<typeof fetch>>;
let openBrowser: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>;
let write: ReturnType<typeof vi.fn<(session: GoogleSession | null) => Promise<boolean>>>;
let auth: GoogleDesktopAuth;
const activeSession = (): GoogleSession => ({
	user: { id: "google:alice", email: "alice@example.test" },
	accessToken: "old-access",
	refreshToken: "saved-refresh",
	expiresAt: Date.now() + 3600000,
	folderId: "root",
});
beforeEach(() => {
	saved = null;
	googleFetch = vi.fn(async (url) =>
		String(url).includes("userinfo")
			? json({ sub: "alice", email: "alice@example.test", name: "Alice" })
			: json({
					access_token: "google-access",
					refresh_token: "google-refresh",
					expires_in: 3600,
					scope: "openid email https://www.googleapis.com/auth/drive.file",
				}),
	);
	openBrowser = vi.fn(async (raw) => {
		const url = new URL(raw);
		const callback = new URL(url.searchParams.get("redirect_uri")!);
		callback.search = new URLSearchParams({
			state: url.searchParams.get("state")!,
			code: "authorization-code",
		}).toString();
		const response = await fetch(callback);
		await response.text();
		expect(response.status).toBe(200);
	});
	write = vi.fn(async (session) => {
		saved = session ? structuredClone(session) : null;
		return true;
	});
	auth = new GoogleDesktopAuth({
		readClient: async () => ({ clientId: "desktop-client", clientSecret: "desktop-secret" }),
		readSession: async () => saved,
		writeSession: write,
		openBrowser,
		onChange: () => {},
		fetch: googleFetch,
	});
});
it("accepts a Desktop OAuth JSON and rejects a Web OAuth client", () => {
	expect(
		parseDesktopClient({ installed: { client_id: "desktop-client", client_secret: "secret" } }),
	).toEqual({ clientId: "desktop-client", clientSecret: "secret" });
	expect(() => parseDesktopClient({ web: { client_id: "web-client" } })).toThrow("Desktop");
});
it("completes browser OAuth through a real loopback callback with a bound PKCE verifier", async () => {
	const state = await auth.signIn();
	expect(state).toMatchObject({
		user: { id: "google:alice", email: "alice@example.test" },
		authorizing: false,
	});
	const url = new URL(openBrowser.mock.calls[0][0]);
	expect(url.origin).toBe("https://accounts.google.com");
	expect(url.searchParams.get("scope")).toContain("drive.file");
	const params = googleFetch.mock.calls[0][1]!.body as URLSearchParams;
	expect(params.get("code")).toBe("authorization-code");
	expect(createHash("sha256").update(params.get("code_verifier")!).digest("base64url")).toBe(
		url.searchParams.get("code_challenge"),
	);
	expect(saved?.refreshToken).toBe("google-refresh");
	expect(JSON.stringify(state)).not.toContain("google-refresh");
	expect(JSON.stringify(state)).not.toContain("google-access");
});
it("rejects a forged state while keeping the legitimate browser callback usable", async () => {
	openBrowser.mockImplementationOnce(async (raw) => {
		const url = new URL(raw);
		const callback = new URL(url.searchParams.get("redirect_uri")!);
		callback.search = "state=forged&code=wrong";
		const forged = await fetch(callback);
		await forged.text();
		expect(forged.status).toBe(400);
		expect(googleFetch).not.toHaveBeenCalled();
		callback.search = new URLSearchParams({
			state: url.searchParams.get("state")!,
			code: "real-code",
		}).toString();
		const valid = await fetch(callback);
		await valid.text();
	});
	await auth.signIn();
	expect((googleFetch.mock.calls[0][1]!.body as URLSearchParams).get("code")).toBe("real-code");
});
it("does not open duplicate browser flows for concurrent sign-in calls", async () => {
	await Promise.all([auth.signIn(), auth.signIn()]);
	expect(openBrowser).toHaveBeenCalledTimes(1);
	expect(write).toHaveBeenCalledTimes(1);
});
it("allows cancellation and releases the callback listener", async () => {
	let browserOpened!: () => void;
	const opened = new Promise<void>((resolve) => {
		browserOpened = resolve;
	});
	openBrowser.mockImplementationOnce(async () => {
		browserOpened();
	});
	const pending = auth.signIn();
	const rejection = expect(pending).rejects.toMatchObject({ code: "AUTH_CANCELED" });
	await opened;
	auth.cancelSignIn();
	await rejection;
	expect((await auth.state()).authorizing).toBe(false);
	expect(saved).toBeNull();
	const redirect = new URL(openBrowser.mock.calls[0][0]).searchParams.get("redirect_uri")!;
	await expect(fetch(redirect)).rejects.toThrow();
});
it("keeps Google login usable in memory when OS credential encryption is unavailable", async () => {
	write.mockResolvedValue(false);
	expect(await auth.signIn()).toMatchObject({ sessionOnly: true, user: { id: "google:alice" } });
});
it("refreshes a restored session once for parallel Drive requests", async () => {
	saved = activeSession();
	saved.expiresAt = 0;
	const [one, two] = await Promise.all([auth.access(), auth.access()]);
	expect(one.token).toBe("google-access");
	expect(two.token).toBe("google-access");
	expect(googleFetch).toHaveBeenCalledTimes(1);
	expect((googleFetch.mock.calls[0][1]!.body as URLSearchParams).get("refresh_token")).toBe(
		"saved-refresh",
	);
});
it("marks revoked authorization for reconnection", async () => {
	saved = activeSession();
	saved.expiresAt = 0;
	googleFetch.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
	await expect(auth.access()).rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
	expect((await auth.state()).reconnect).toBe(true);
});
it("cannot resurrect credentials when an in-flight refresh completes after sign-out", async () => {
	saved = activeSession();
	saved.expiresAt = 0;
	let resolveToken!: (response: Response) => void;
	let started!: () => void;
	const refreshing = new Promise<void>((resolve) => {
		started = resolve;
	});
	googleFetch.mockImplementationOnce(async () => {
		started();
		return new Promise<Response>((resolve) => {
			resolveToken = resolve;
		});
	});
	const pending = auth.access();
	const rejection = expect(pending).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
	await refreshing;
	await auth.signOut();
	resolveToken(json({ access_token: "late-token", expires_in: 3600 }));
	await rejection;
	expect(saved).toBeNull();
	expect((await auth.state()).user).toBeNull();
});
it("rejects transfers prepared for another Google account", async () => {
	saved = activeSession();
	await expect(auth.access("google:bob")).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
	expect(googleFetch).not.toHaveBeenCalled();
});
