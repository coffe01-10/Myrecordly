import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dialog, ipcMain } from "electron";
import type { DriveTransfer, DriveTransferResult } from "../../../src/types/googleDrive";
import { isOwnedExportPath } from "../export/exportStream";
import { isAllowedLocalReadPath } from "../project/manager";
import type { DriveTicket } from "../../googleDrive/api";

const transfers = new Map<string, AbortController>();
const mimeTypes: Record<string, string> = {
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".gif": "image/gif",
	".recordly": "application/octet-stream",
};
async function resolveDriveUploadPath(filePath: string) {
	// Check the registered path before resolving directory aliases. Export ownership
	// is recorded using that path, while local-read approval also checks its target.
	if (!isOwnedExportPath(filePath) && !isAllowedLocalReadPath(filePath))
		throw new Error("This file is not an approved Recordly file.");
	return fs.realpath(filePath);
}
function createProgressStream(total: number, report: (transferred: number, total: number) => void) {
	let transferred = 0;
	let lastProgressAt = 0;
	return new Transform({
		transform(chunk, _encoding, callback) {
			transferred += chunk.length;
			const now = Date.now();
			if (now - lastProgressAt >= 100 || (total > 0 && transferred === total)) {
				lastProgressAt = now;
				report(transferred, total);
			}
			callback(null, chunk);
		},
	});
}
export function validateDriveUploadUrl(raw: string) {
	const url = new URL(raw);
	// Resumable URLs carry credentials. Never forward them to a caller-supplied host.
	if (url.origin !== "https://www.googleapis.com" || url.pathname !== "/upload/drive/v3/files") {
		throw new Error("Invalid Google Drive upload session.");
	}
	return url.href;
}

export function cancelAllDriveTransfers() {
	for (const controller of transfers.values()) controller.abort();
}
export function registerGoogleDriveHandlers(tickets: {
	consumeTicket(id: string): DriveTicket;
	assertTicket(ticket: DriveTicket): void;
	cancelTicket(id: string): void;
}) {
	ipcMain.handle("google-drive-pick-upload", async () => {
		const selected = await dialog.showOpenDialog({
			properties: ["openFile"],
			filters: [{ name: "Recordly media", extensions: ["mp4", "webm", "mov", "gif"] }],
		});
		if (selected.canceled) return { canceled: true };
		const filePath = await fs.realpath(selected.filePaths[0]);
		const { approveUserPath } = await import("../utils");
		approveUserPath(filePath);
		const stat = await fs.stat(filePath);
		return {
			filePath,
			name: path.basename(filePath),
			size: stat.size,
			mimeType: mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
		};
	});
	ipcMain.handle("google-drive-file-info", async (_event, filePath: string) => {
		const resolved = await resolveDriveUploadPath(filePath);
		const stat = await fs.stat(resolved);
		return {
			filePath,
			name: path.basename(resolved),
			size: stat.size,
			mimeType: mimeTypes[path.extname(resolved).toLowerCase()] || "application/octet-stream",
		};
	});
	ipcMain.handle(
		"google-drive-transfer",
		async (event, input: DriveTransfer): Promise<DriveTransferResult> => {
			const controller = new AbortController();
			transfers.set(input.id, controller);
			const reportProgress = (transferred: number, total: number) => {
				if (!event.sender.isDestroyed())
					event.sender.send("google-drive-progress", {
						id: input.id,
						transferred,
						total,
					});
			};
			let incompletePath: string | undefined;
			let source: Readable | undefined;
			try {
				const ticket = tickets.consumeTicket(input.ticketId);
				if (input.direction === "upload") {
					const filePath = await resolveDriveUploadPath(input.filePath!);
					const { size } = await fs.stat(filePath);
					source = createReadStream(filePath);
					const progress = createProgressStream(size, reportProgress);
					source.on("error", (error) => progress.destroy(error));
					source.pipe(progress);
					try {
						tickets.assertTicket(ticket);
						const response = await fetch(validateDriveUploadUrl(ticket.uploadUrl!), {
							method: "PUT",
							headers: {
								authorization: `Bearer ${ticket.token}`,
								"content-length": String(size),
							},
							body: progress as unknown as BodyInit,
							duplex: "half",
							redirect: "error",
							signal: controller.signal,
						} as RequestInit & { duplex: "half" });
						if (!response.ok)
							throw new Error(
								`Google Drive upload failed (${response.status}). Retry the upload.`,
							);
						return { success: true, file: await response.json() };
					} finally {
						progress.destroy();
					}
				}
				const file = ticket.file;
				if (!file || !/^[\w-]+$/.test(file.id))
					throw new Error("Invalid Google Drive file.");
				const save = await dialog.showSaveDialog({ defaultPath: path.basename(file.name) });
				if (save.canceled || !save.filePath) return { success: false, canceled: true };
				tickets.assertTicket(ticket);
				// Download beside the destination and rename only after success, so a failed
				// download cannot truncate an existing user file.
				incompletePath = `${save.filePath}.${crypto.randomUUID()}.partial`;
				const response = await fetch(
					`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
					{
						headers: { authorization: `Bearer ${ticket.token}` },
						signal: controller.signal,
					},
				);
				if (!response.ok || !response.body)
					throw new Error(`Google Drive download failed (${response.status}).`);
				const total = Number(response.headers.get("content-length") || file.size) || 0;
				const handle = await fs.open(incompletePath, "wx");
				source = Readable.fromWeb(
					response.body as import("node:stream/web").ReadableStream,
				);
				await pipeline(
					source,
					createProgressStream(total, reportProgress),
					handle.createWriteStream(),
					{
						signal: controller.signal,
					},
				);
				controller.signal.throwIfAborted();
				await fs.rename(incompletePath, save.filePath);
				incompletePath = undefined;
				return { success: true, filePath: save.filePath };
			} catch (error) {
				return {
					success: false,
					canceled: controller.signal.aborted,
					error: error instanceof Error ? error.message : String(error),
				};
			} finally {
				source?.destroy();
				transfers.delete(input.id);
				if (incompletePath) await fs.rm(incompletePath, { force: true });
			}
		},
	);
	ipcMain.handle("google-drive-cancel", (_event, id: string) => {
		tickets.cancelTicket(id);
		transfers.get(id)?.abort();
	});
}
