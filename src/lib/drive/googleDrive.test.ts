import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ getSession: vi.fn(), invoke: vi.fn() }));
vi.mock("../auth/client", () => ({
	recordlyAuth: { auth: { getSession: state.getSession }, functions: { invoke: state.invoke } },
}));
import { driveApi, driveRequest } from "./googleDrive";
const fileInfo = vi.fn();
const transfer = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	state.getSession.mockResolvedValue({
		data: { session: { user: { id: "alice" }, access_token: "alice-session" } },
	});
	state.invoke.mockResolvedValue({
		data: {
			accessToken: "google-token",
			uploadUrl: "https://www.googleapis.com/upload/drive/v3/files?upload_id=1",
		},
		error: null,
	});
	fileInfo.mockResolvedValue({ name: "video.mp4", size: 50, mimeType: "video/mp4" });
	vi.stubGlobal("window", { electronAPI: { driveFileInfo: fileInfo, driveTransfer: transfer } });
});
it("binds each Drive request to the captured Recordly session token", async () => {
	await driveRequest("rename", { fileId: "video", name: "New title" }, "alice");
	expect(state.invoke).toHaveBeenCalledWith(
		"google-drive",
		expect.objectContaining({ headers: { Authorization: "Bearer alice-session" } }),
	);
});
it("refuses to upload a prepared video after the account changes", async () => {
	state.getSession.mockResolvedValue({
		data: { session: { user: { id: "bob" }, access_token: "bob-session" } },
	});
	await expect(
		driveApi.upload("video.mp4", { id: "one", accountId: "alice", canceled: false }),
	).rejects.toThrow("account changed");
	expect(state.invoke).not.toHaveBeenCalled();
	expect(transfer).not.toHaveBeenCalled();
});
it("does not start the native transfer when canceled while creating a Google upload session", async () => {
	const operation = { id: "one", accountId: "alice", canceled: false };
	state.invoke.mockImplementation(async () => {
		operation.canceled = true;
		return { data: { accessToken: "token", uploadUrl: "session" }, error: null };
	});
	expect(await driveApi.upload("video.mp4", operation)).toMatchObject({ canceled: true });
	expect(transfer).not.toHaveBeenCalled();
});
it("does not create a cloud session if canceled during local file preparation", async () => {
	const operation = { id: "one", accountId: "alice", canceled: false };
	fileInfo.mockImplementation(async () => {
		operation.canceled = true;
		return { size: 50 };
	});
	expect(await driveApi.upload("video.mp4", operation)).toMatchObject({ canceled: true });
	expect(state.invoke).not.toHaveBeenCalled();
});
it("surfaces revoked authorization as a reconnection error", async () => {
	state.invoke.mockResolvedValue({
		error: {
			context: new Response(
				JSON.stringify({ code: "RECONNECT_REQUIRED", error: "Reconnect Google Drive" }),
			),
		},
	});
	await expect(driveApi.status()).rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
});
