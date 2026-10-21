import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import { getRecordingsDir } from "../ipc/utils";
import { rememberApprovedLocalReadPath } from "../ipc/project/manager";
import { buildMediaUrl, getMediaServerBaseUrl } from "../mediaServer";
import { isLibraryVideo, type RecordingLibraryEntry } from "../../src/types/recordingLibrary";

/** Commit the download to the existing library only when every byte is available. */
export async function importCloudVideo(
	name: string,
	download: (partialPath: string) => Promise<void>,
): Promise<RecordingLibraryEntry> {
	if (!isLibraryVideo(name))
		throw new Error("This video format is not supported by the clip library.");
	const server = getMediaServerBaseUrl();
	if (!server) throw new Error("Media server is not ready. Try again.");
	const root = await getRecordingsDir();
	const parsed = path.parse(path.basename(name));
	let stem =
		parsed.name
			.replace(/[.-]webcam(?=[.-]|$)/gi, " webcam")
			.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
			.replace(/[. ]+$/, "") || "video";
	// Cloud filenames may be legal on the provider but reserved devices on Windows.
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `_${stem}`;
	let filePath = "";
	for (let index = 0; ; index++) {
		const candidate = path.join(root, `${stem}${index ? ` (${index + 1})` : ""}${parsed.ext}`);
		try {
			const reservation = await fs.open(candidate, "wx");
			await reservation.close();
			filePath = candidate;
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	const partial = `${filePath}.${randomUUID()}.partial`;
	let committed = false;
	try {
		await download(partial);
		await fs.rename(partial, filePath);
		await rememberApprovedLocalReadPath(filePath);
		const stat = await fs.stat(filePath);
		const entry = {
			path: filePath,
			name: path.basename(filePath),
			bytes: stat.size,
			createdAt: stat.mtimeMs,
			url: buildMediaUrl(server, filePath),
		};
		committed = true;
		for (const window of BrowserWindow.getAllWindows())
			if (!window.isDestroyed()) window.webContents.send("recording-library-changed");
		return entry;
	} finally {
		await fs.rm(partial, { force: true });
		if (!committed) await fs.rm(filePath, { force: true });
	}
}
