import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DriveTransferResult } from "../../../src/types/googleDrive";
type Handler = (...args: unknown[]) => Promise<DriveTransferResult>;
const state = vi.hoisted(() => ({
	handlers: new Map<string, Handler>(),
	save: vi.fn(),
	allowed: true,
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (name: string, callback: Handler) => state.handlers.set(name, callback),
	},
	dialog: { showSaveDialog: state.save },
}));
vi.mock("../project/manager", () => ({ isAllowedLocalReadPath: () => state.allowed }));
vi.mock("../export/exportStream", () => ({ isOwnedExportPath: () => false }));
import { registerGoogleDriveHandlers, validateDriveUploadUrl } from "./googleDrive";
let directory: string;
const event = { sender: { isDestroyed: () => false, send: vi.fn() } };
beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-drive-test-"));
	state.handlers.clear();
	state.allowed = true;
	state.save.mockReset();
	registerGoogleDriveHandlers();
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
		accessToken: "token",
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
		accessToken: "token",
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
		accessToken: "token",
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
		accessToken: "token",
	});
	expect(result).toMatchObject({ success: true, filePath: destination });
	expect(await fs.readFile(destination, "utf8")).toBe("downloaded-video");
});
