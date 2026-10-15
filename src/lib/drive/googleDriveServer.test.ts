import { beforeEach, expect, it, vi } from "vitest";
import {
	googleDriveHandler,
	type Connection,
	type DriveBackend,
} from "../../../services/supabase/functions/google-drive/handler";

const connection = (userId = "alice"): Connection => ({
	user_id: userId,
	google_sub: userId,
	email: `${userId}@example.com`,
	refresh_token: `refresh-${userId}`,
	access_token: `google-${userId}`,
	expires_at: Date.now() + 3600000,
	folder_id: `folder-${userId}`,
});
let rows: Map<string, Connection>;
let google: ReturnType<typeof vi.fn<typeof fetch>>;
let backend: DriveBackend;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const invoke = (action: string, input = {}, token = "alice") =>
	googleDriveHandler(backend)(
		new Request("https://app.test/google-drive", {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify({ action, ...input }),
		}),
	);
beforeEach(() => {
	rows = new Map([["alice", connection()]]);
	google = vi.fn(async (url, options) => {
		const value = String(url);
		if (value.includes("oauth2/v3/userinfo"))
			return json({ sub: "alice", email: "alice@example.com" });
		if (value.includes("oauth2.googleapis.com/token"))
			return json({ access_token: "renewed", expires_in: 3600 });
		if (value.includes("?fields=trashed")) return json({ trashed: false });
		if (value.includes("permissions"))
			return options?.method === "DELETE"
				? new Response(null, { status: 204 })
				: json({ permissions: [] });
		return json({ files: [{ id: "video", name: "Demo.mp4" }] });
	});
	backend = {
		clientId: "client",
		clientSecret: "secret",
		fetch: google,
		authenticate: async (token) => (token === "invalid" ? null : token),
		read: async (userId) => rows.get(userId) ?? null,
		save: async (row) => {
			rows.set(row.user_id, { ...row });
		},
		remove: async (userId) => {
			rows.delete(userId);
		},
	};
});

it("rejects an unauthenticated caller before reading Drive credentials", async () => {
	const read = vi.spyOn(backend, "read");
	expect((await invoke("list", {}, "invalid")).status).toBe(401);
	expect(read).not.toHaveBeenCalled();
	expect(google).not.toHaveBeenCalled();
});
it("isolates connections by the authenticated Recordly account", async () => {
	rows.set("bob", connection("bob"));
	await invoke("list", { userId: "bob" });
	const list = google.mock.calls.find(([url]) => String(url).includes("in+parents"));
	expect(String(list?.[0])).toContain("folder-alice");
	expect(list?.[1]?.headers).toMatchObject({ authorization: "Bearer google-alice" });
});
it("refreshes expired Google tokens and persists the renewed expiry", async () => {
	rows.get("alice")!.expires_at = 0;
	expect((await invoke("list")).status).toBe(200);
	expect(rows.get("alice")!.access_token).toBe("renewed");
	expect(
		google.mock.calls.some(
			([url, init]) =>
				String(url).includes("/token") && String(init?.body).includes("refresh-alice"),
		),
	).toBe(true);
});
it("asks for reconnection when Google revokes the refresh token", async () => {
	rows.get("alice")!.expires_at = 0;
	google.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
	const response = await invoke("status");
	expect(await response.json()).toMatchObject({ code: "RECONNECT_REQUIRED" });
});
it("never returns refresh or access tokens with status and file listings", async () => {
	const status = await (await invoke("status")).text();
	expect(status).toContain("alice@example.com");
	expect(status).not.toContain("google-alice");
	expect(status).not.toContain("refresh-alice");
	expect(await (await invoke("list")).json()).toMatchObject({ files: [{ name: "Demo.mp4" }] });
});
it("does not create any public permission while starting a private upload", async () => {
	google.mockImplementation(async (url) =>
		String(url).includes("/upload/")
			? new Response(null, {
					headers: {
						location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=1",
					},
				})
			: json({ trashed: false }),
	);
	const response = await invoke("start-upload", {
		name: "Demo.mp4",
		mimeType: "video/mp4",
		size: 100,
	});
	expect(await response.json()).toMatchObject({
		uploadUrl: expect.stringContaining("upload_id=1"),
	});
	const upload = google.mock.calls.find(([url]) => String(url).includes("/upload/"));
	expect(JSON.parse(String(upload?.[1]?.body))).toEqual({
		name: "Demo.mp4",
		parents: ["folder-alice"],
	});
	expect(google.mock.calls.some(([url]) => String(url).includes("permissions"))).toBe(false);
});
it("forwards pagination and a selected folder to Drive", async () => {
	await invoke("list", { parentId: "nested", pageToken: "page-two" });
	const url = new URL(String(google.mock.calls[1][0]));
	expect(url.searchParams.get("q")).toBe("'nested' in parents and trashed = false");
	expect(url.searchParams.get("pageToken")).toBe("page-two");
});
it("grants named recipients the selected role, while public links remain read-only", async () => {
	await invoke("grant", { fileId: "video", email: "friend@example.com", role: "writer" });
	expect(JSON.parse(String(google.mock.calls[1][1]?.body))).toMatchObject({
		type: "user",
		role: "writer",
		emailAddress: "friend@example.com",
	});
	google.mockClear();
	await invoke("grant", { fileId: "video", type: "anyone", role: "writer" });
	expect(JSON.parse(String(google.mock.calls[1][1]?.body))).toEqual({
		type: "anyone",
		role: "reader",
		allowFileDiscovery: false,
	});
});
it("trashes files instead of permanently deleting them", async () => {
	await invoke("trash", { fileId: "video" });
	expect(google.mock.calls[1][1]).toMatchObject({ method: "PATCH", body: '{"trashed":true}' });
});
it("disconnects only the current account without touching its files", async () => {
	rows.set("bob", connection("bob"));
	await invoke("disconnect");
	expect(rows.has("alice")).toBe(false);
	expect(rows.has("bob")).toBe(true);
	expect(google).not.toHaveBeenCalled();
});
it("refuses mismatched access and refresh identities before storing credentials", async () => {
	google.mockResolvedValueOnce(json({ sub: "bob", email: "bob@example.com" }));
	const response = await invoke("connect", {
		accessToken: "bob-access",
		refreshToken: "alice-refresh",
	});
	expect(response.status).toBe(401);
	expect(rows.get("alice")?.google_sub).toBe("alice");
});

it("persists a verified Google connection and creates its private Recordly root before exposing it", async () => {
	rows.clear();
	google.mockImplementation(async (url, init) => {
		const value = String(url);
		if (value.includes("oauth2/v3/userinfo"))
			return json({ sub: "google-alice", email: "alice@example.com" });
		if (value.includes("oauth2.googleapis.com/token"))
			return json({ access_token: "verified-access", expires_in: 3600 });
		if (init?.method === "POST") return json({ id: "new-root" });
		return json({ files: [], trashed: false });
	});
	const response = await invoke("connect", {
		accessToken: "google-access",
		refreshToken: "google-refresh",
	});
	expect(await response.json()).toEqual({
		connected: true,
		email: "alice@example.com",
		folderId: "new-root",
	});
	expect(rows.get("alice")).toMatchObject({
		user_id: "alice",
		google_sub: "google-alice",
		refresh_token: "google-refresh",
		folder_id: "new-root",
	});
	const creation = google.mock.calls.find(
		([, init]) => init?.method === "POST" && String(init.body).includes("recordlyRoot"),
	);
	expect(JSON.parse(String(creation?.[1]?.body))).not.toHaveProperty("permissions");
});
it("restores the Recordly folder when its old folder was trashed", async () => {
	google.mockResolvedValueOnce(json({ trashed: true }));
	google.mockResolvedValueOnce(json({ files: [] }));
	google.mockResolvedValueOnce(json({ id: "replacement" }));
	expect(await (await invoke("status")).json()).toMatchObject({ folderId: "replacement" });
	expect(rows.get("alice")!.folder_id).toBe("replacement");
});
