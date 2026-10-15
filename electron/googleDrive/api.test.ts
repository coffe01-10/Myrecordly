import { beforeEach, expect, it, vi } from "vitest";
import { GoogleDesktopAuth, type GoogleSession } from "./auth";
import { DesktopDriveApi } from "./api";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let saved: GoogleSession;
let google: ReturnType<typeof vi.fn<typeof fetch>>;
let auth: GoogleDesktopAuth;
let api: DesktopDriveApi;
beforeEach(() => {
	saved = {
		user: { id: "google:alice", email: "alice@example.test" },
		accessToken: "native-access-token",
		refreshToken: "native-refresh-token",
		expiresAt: Date.now() + 3600000,
		folderId: "root",
	};
	google = vi.fn(async (url, init) => {
		if (String(url).includes("?fields=trashed")) return json({ trashed: false });
		if (String(url).includes("/upload/"))
			return new Response(null, {
				headers: {
					location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=one",
				},
			});
		if (String(url).includes("permissions"))
			return init?.method === "DELETE"
				? new Response(null, { status: 204 })
				: json({ permissions: [] });
		if (String(url).includes("files/video?fields="))
			return json({ id: "video", name: "demo.mp4", mimeType: "video/mp4" });
		return json({ files: [{ id: "video", name: "demo.mp4" }] });
	});
	auth = new GoogleDesktopAuth({
		readClient: async () => ({ clientId: "client" }),
		readSession: async () => saved,
		writeSession: async () => true,
		openBrowser: async () => {},
		onChange: () => {},
		fetch: google,
	});
	api = new DesktopDriveApi(auth);
});
it("lists paginated files in the requested folder using only the native Google token", async () => {
	await api.request("list", { parentId: "nested", pageToken: "next" }, "google:alice");
	const url = new URL(String(google.mock.calls[0][0]));
	expect(url.searchParams.get("q")).toBe("'nested' in parents and trashed = false");
	expect(url.searchParams.get("pageToken")).toBe("next");
	expect(google.mock.calls[0][1]?.headers).toMatchObject({
		authorization: "Bearer native-access-token",
	});
});
it("creates a private upload ticket without exposing Google credentials to the renderer", async () => {
	const response = await api.request("start-upload", {
		name: "demo.mp4",
		mimeType: "video/mp4",
		size: 100,
		transferId: "transfer-one",
	});
	expect(response).toEqual({ ticketId: "transfer-one" });
	expect(JSON.stringify(response)).not.toContain("native-access-token");
	const ticket = api.consumeTicket("transfer-one");
	expect(ticket.token).toBe("native-access-token");
	expect(() => api.consumeTicket("transfer-one")).toThrow();
	expect(google.mock.calls.some(([url]) => String(url).includes("permissions"))).toBe(false);
});
it("invalidates a prepared transfer when the Google account signs out", async () => {
	await api.request("download", { fileId: "video", transferId: "one" });
	await auth.signOut();
	expect(() => api.consumeTicket("one")).toThrow("account changed");
});
it("makes public links read-only and grants named recipients the chosen role", async () => {
	await api.request("grant", { fileId: "video", role: "writer", email: "friend@example.test" });
	expect(JSON.parse(String(google.mock.calls[0][1]?.body))).toMatchObject({
		type: "user",
		role: "writer",
	});
	await api.request("grant", { fileId: "video", role: "writer", type: "anyone" });
	expect(JSON.parse(String(google.mock.calls[1][1]?.body))).toEqual({
		type: "anyone",
		role: "reader",
		allowFileDiscovery: false,
	});
});
it("loads all permission pages and keeps deletions recoverable", async () => {
	google.mockResolvedValueOnce(
		json({ permissions: [{ id: "owner" }], nextPageToken: "page-two" }),
	);
	google.mockResolvedValueOnce(json({ permissions: [{ id: "reader" }] }));
	expect(await api.request("permissions", { fileId: "video" })).toMatchObject({
		permissions: [{ id: "owner" }, { id: "reader" }],
	});
	await api.request("trash", { fileId: "video" });
	expect(google.mock.calls[2][1]).toMatchObject({ method: "PATCH", body: '{"trashed":true}' });
});
it("deduplicates creation of the Recordly folder for simultaneous windows", async () => {
	saved.folderId = undefined;
	google.mockImplementation(async (_url, init) =>
		init?.method === "POST" ? json({ id: "new-root" }) : json({ files: [] }),
	);
	await Promise.all([api.request("status"), api.request("status")]);
	expect(google.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});
