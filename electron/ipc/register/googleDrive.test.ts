import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DriveTransferResult } from "../../../src/types/googleDrive";
import type { DriveTicket } from "../../googleDrive/api";
type Handler = (...args: unknown[]) => Promise<DriveTransferResult>;
const state = vi.hoisted(() => ({
	handlers: new Map<string, Handler>(),
	save: vi.fn(),
	allowed: true,
	library: "",
	broadcast: vi.fn(),
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (name: string, callback: Handler) => state.handlers.set(name, callback),
	},
	dialog: { showSaveDialog: state.save },
	BrowserWindow: {
		getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: state.broadcast } }],
	},
	shell: { trashItem: vi.fn() },
}));
vi.mock("../project/manager", () => ({
	isAllowedLocalReadPath: () => state.allowed,
	rememberApprovedLocalReadPath: async () => {},
}));
vi.mock("../utils", () => ({
	getRecordingsDir: async () => {
		await fs.mkdir(state.library, { recursive: true });
		return state.library;
	},
}));
vi.mock("../../mediaServer", () => ({
	getMediaServerBaseUrl: () => "http://127.0.0.1:9999",
	buildMediaUrl: (server: string, file: string) =>
		`${server}/video?path=${encodeURIComponent(file)}`,
}));
vi.mock("../export/exportStream", () => ({ isOwnedExportPath: () => false }));
import { registerGoogleDriveHandlers, validateDriveUploadUrl } from "./googleDrive";
import { listRecordings } from "../recording/library";
let directory: string;
const event = { sender: { isDestroyed: () => false, send: vi.fn() } };
beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-drive-test-"));
	state.library = path.join(directory, "library");
	state.broadcast.mockClear();
	state.handlers.clear();
	state.allowed = true;
	state.save.mockReset();
	registerGoogleDriveHandlers({
		consumeTicket: () =>
			({
				token: "token",
				accountId: "google:alice",
				version: 0,
				uploadUrl: "https://www.googleapis.com/upload/drive/v3/files?upload_id=1",
				file: { id: "video", name: "demo.mp4", mimeType: "video/mp4" },
			}) satisfies DriveTicket,
		assertTicket: () => {},
		cancelTicket: () => {},
	});
});
afterEach(async () => {
	vi.unstubAllGlobals();
	await fs.rm(directory, { recursive: true, force: true });
});
it("refuses resumable URLs that could leak the Google token to another host", () => {
	expect(() => validateDriveUploadUrl("https://attacker.test/upload/drive/v3/files")).toThrow();
	expect(() =>
		validateDriveUploadUrl("https://www.googleapis.com.evil.test/upload/drive/v3/files"),
	).toThrow();
	expect(
		validateDriveUploadUrl("https://www.googleapis.com/upload/drive/v3/files?upload_id=1"),
	).toContain("upload_id=1");
});
it("streams an approved export without loading the entire video into memory", async () => {
	const filePath = path.join(directory, "demo.mp4");
	await fs.writeFile(filePath, "video-content");
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url, init) => {
			let text = "";
			for await (const chunk of init.body) text += chunk.toString();
			expect(text).toBe("video-content");
			expect(init.headers["content-length"]).toBe("13");
			return new Response(JSON.stringify({ id: "drive-file", name: "demo.mp4" }));
		}),
	);
	const result = await state.handlers.get("google-drive-transfer")!(event, {
		id: "one",
		direction: "upload",
		filePath,
		ticketId: "ticket",
		uploadUrl: "https://www.googleapis.com/upload/drive/v3/files?upload_id=1",
	});
	expect(result).toMatchObject({ success: true, file: { id: "drive-file" } });
});
it("rejects an arbitrary local file that the user did not approve", async () => {
	state.allowed = false;
	const filePath = path.join(directory, "private.txt");
	await fs.writeFile(filePath, "private");
	const fetch = vi.fn();
	vi.stubGlobal("fetch", fetch);
	const result = await state.handlers.get("google-drive-transfer")!(event, {
		id: "two",
		direction: "upload",
		filePath,
		ticketId: "ticket",
	});
	expect(result.success).toBe(false);
	expect(fetch).not.toHaveBeenCalled();
});
it("preserves an existing destination and removes partial data after a failed download", async () => {
	const destination = path.join(directory, "demo.mp4");
	await fs.writeFile(destination, "original-video");
	state.save.mockResolvedValue({ filePath: destination });
	vi.stubGlobal(
		"fetch",
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("partial"));
						controller.error(new Error("network interrupted"));
					},
				}),
			),
	);
	const result = await state.handlers.get("google-drive-transfer")!(event, {
		id: "three",
		direction: "download",
		file: { id: "video", name: "demo.mp4" },
		ticketId: "ticket",
	});
	expect(result.success).toBe(false);
	expect(await fs.readFile(destination, "utf8")).toBe("original-video");
	expect(await fs.readdir(directory)).toEqual(["demo.mp4"]);
});
it("downloads the remote file to the destination chosen by the user", async () => {
	const destination = path.join(directory, "demo.mp4");
	state.save.mockResolvedValue({ filePath: destination });
	vi.stubGlobal("fetch", async () => new Response("downloaded-video"));
	const result = await state.handlers.get("google-drive-transfer")!(event, {
		id: "four",
		direction: "download",
		file: { id: "video", name: "demo.mp4" },
		ticketId: "ticket",
	});
	expect(result).toMatchObject({ success: true, filePath: destination });
	expect(await fs.readFile(destination, "utf8")).toBe("downloaded-video");
});
it("imports a Google video without a save dialog and exposes it in the existing library", async () => {
	vi.stubGlobal("fetch", async () => new Response("downloaded-video"));
	const result = await state.handlers.get("google-drive-transfer")!(event, {
		id: "library",
		direction: "download",
		ticketId: "ticket",
		destination: "library",
	});
	expect(result.success).toBe(true);
	expect(state.save).not.toHaveBeenCalled();
	expect((await listRecordings()).map((entry) => entry.path)).toContain(result.entry!.path);
	expect(await fs.readFile(result.entry!.path, "utf8")).toBe("downloaded-video");
	expect(state.broadcast).toHaveBeenCalledWith("recording-library-changed");
});
it("cancels a Google library import without leaving files or publishing a library update", async () => {
	vi.stubGlobal(
		"fetch",
		async (_url: unknown, init: RequestInit) =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array([1, 2, 3]));
						init.signal!.addEventListener("abort", () =>
							controller.error(new Error("canceled")),
						);
						setTimeout(() => {
							void state.handlers.get("google-drive-cancel")!(
								event,
								"cancel-library",
							);
						}, 10);
					},
				}),
			),
	);
	const result = await state.handlers.get("google-drive-transfer")!(event, {
		id: "cancel-library",
		direction: "download",
		ticketId: "ticket",
		destination: "library",
	});
	expect(result.canceled).toBe(true);
	expect(await fs.readdir(state.library)).toEqual([]);
	expect(state.broadcast).not.toHaveBeenCalled();
});
