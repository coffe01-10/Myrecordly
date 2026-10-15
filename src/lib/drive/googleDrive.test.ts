import { beforeEach, expect, it, vi } from "vitest";
import { driveApi, driveRequest } from "./googleDrive";
const request = vi.fn();
const fileInfo = vi.fn();
const transfer = vi.fn();
const cancel = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	request.mockResolvedValue({ success: true, data: { ticketId: "one" } });
	fileInfo.mockResolvedValue({ name: "video.mp4", size: 50, mimeType: "video/mp4" });
	vi.stubGlobal("window", {
		electronAPI: {
			driveRequest: request,
			driveFileInfo: fileInfo,
			driveTransfer: transfer,
			driveCancel: cancel,
		},
	});
});
it("passes the expected Google identity to the native boundary without a Supabase session", async () => {
	await driveRequest("rename", { fileId: "video", name: "New title" }, "google:alice");
	expect(request).toHaveBeenCalledWith(
		"rename",
		{ fileId: "video", name: "New title" },
		"google:alice",
	);
});
it("rejects an upload after the native service detects an account change", async () => {
	request.mockResolvedValue({
		success: false,
		error: "Your account changed",
		code: "ACCOUNT_CHANGED",
	});
	await expect(
		driveApi.upload("video.mp4", { id: "one", accountId: "google:alice", canceled: false }),
	).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
	expect(transfer).not.toHaveBeenCalled();
});
it("cleans up an unused transfer ticket when canceled during upload preparation", async () => {
	const operation = { id: "one", accountId: "google:alice", canceled: false };
	request.mockImplementation(async () => {
		operation.canceled = true;
		return { success: true, data: { ticketId: "one" } };
	});
	expect(await driveApi.upload("video.mp4", operation)).toMatchObject({ canceled: true });
	expect(cancel).toHaveBeenCalledWith("one");
	expect(transfer).not.toHaveBeenCalled();
});
it("never sends Google access or refresh tokens to the renderer transfer API", async () => {
	await driveApi.upload("video.mp4", { id: "one", accountId: "google:alice", canceled: false });
	expect(transfer).toHaveBeenCalledWith({
		id: "one",
		direction: "upload",
		filePath: "video.mp4",
		ticketId: "one",
	});
});
it("does not create a Drive upload session if canceled during local file preparation", async () => {
	const operation = { id: "one", accountId: "google:alice", canceled: false };
	fileInfo.mockImplementation(async () => {
		operation.canceled = true;
		return { size: 50 };
	});
	expect(await driveApi.upload("video.mp4", operation)).toMatchObject({ canceled: true });
	expect(request).not.toHaveBeenCalled();
});
