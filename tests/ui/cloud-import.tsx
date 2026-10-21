import { createDesktopBridge } from "./bridge";
import type { RecordingLibraryEntry } from "@/types/recordingLibrary";

// Exercise the production editor with simulated remote transfers; HTML video playback is real.
createDesktopBridge("filmstrip.mp4");
const query = new URLSearchParams(location.search);
const entries: RecordingLibraryEntry[] = [];
const changed = new Set<() => void>();
const canceled = new Set<string>();
const mediaUrl = `${location.origin}/tests/ui/fixtures/filmstrip.mp4`;
if (query.has("library")) {
	for (const name of ["intro.mp4", "interview.mp4"])
		entries.push({
			name,
			path: `/recordings/${name}`,
			bytes: 81920,
			createdAt: Date.now(),
			url: mediaUrl,
		});
}
const accounts = [
	{ id: "one", provider: "onedrive", name: "OneDrive · Work", mode: "oauth", connectedAt: "" },
	{ id: "two", provider: "dropbox", name: "Dropbox · Personal", mode: "oauth", connectedAt: "" },
];
const files = ["intro.mp4", "interview.mp4", "slow.mp4", "broken.mp4", "notes.txt"];
const download = async (name: string, id: string) => {
	await new Promise((resolve) => setTimeout(resolve, name === "slow.mp4" ? 3000 : 250));
	if (canceled.delete(id)) throw new Error("Canceled");
	if (name === "broken.mp4") throw new Error("Download interrupted — retry available");
	const entry = {
		path: `/recordings/${name}`,
		name,
		bytes: 81920,
		createdAt: Date.now(),
		url: mediaUrl,
	};
	entries.push(entry);
	for (const callback of changed) callback();
	return entry;
};
Object.assign(window.electronAPI, {
	getAppSetting: (key: string) =>
		key === "recordly.onboarding.v1.seen"
			? true
			: key === "recordly.locale"
				? query.get("locale") || "en"
				: key === "recordly.theme"
					? query.get("theme") || "light"
					: null,
	getCurrentVideoPath: async () => ({
		success: true,
		path: query.has("empty") ? null : mediaUrl,
	}),
	getLocalMediaUrl: async (file: string) => ({
		success: true,
		url: file.includes("composed")
			? `${location.origin}/tests/ui/fixtures/cloud-import-composed.mp4`
			: mediaUrl,
	}),
	listRecordings: async () => ({ success: true, value: [...entries] }),
	getRecordingThumbnail: async () => ({
		success: true,
		value: `${location.origin}/tests/ui/fixtures/recording-thumbnail.jpg`,
	}),
	onRecordingLibraryChanged: (callback: () => void) => {
		changed.add(callback);
		return () => changed.delete(callback);
	},
	onCloudStorageChanged: () => () => {},
	cloudStorageRequest: async (action: string, input: Record<string, string> = {}) => {
		if (action === "state")
			return {
				success: true,
				data: { accounts, runtimeAvailable: true, sessionOnly: false },
			};
		if (action === "list")
			return {
				success: true,
				data: files.map((Name) => ({
					Name,
					Path: Name,
					IsDir: false,
					Size: 81920,
					ModTime: "",
				})),
			};
		if (action === "cancel") {
			canceled.add(input.id);
			return { success: true, data: null };
		}
		if (action === "import") {
			try {
				return { success: true, data: await download(input.path, input.operationId) };
			} catch (cause) {
				return { success: false, error: String(cause) };
			}
		}
		return { success: true, data: null };
	},
	googleAuthState: async () => ({
		success: true,
		data: {
			configured: true,
			user: { id: "google:fixture", email: "editor@example.test" },
			authorizing: false,
		},
	}),
	onGoogleAuthChanged: () => () => {},
	driveRequest: async (action: string, input: Record<string, string> = {}) => {
		if (action === "trash") {
			files.splice(files.indexOf(input.fileId), 1);
			return { success: true, data: null };
		}
		return {
			success: true,
			data:
				action === "status"
					? { connected: true, email: "editor@example.test" }
					: action === "list"
						? {
								files: files.map((name) => ({
									id: name,
									name,
									mimeType: name.endsWith("mp4") ? "video/mp4" : "text/plain",
									size: "81920",
								})),
							}
						: {
								ticketId: input.transferId,
								file: {
									id: input.fileId,
									name: input.fileId,
									mimeType: "video/mp4",
								},
							},
		};
	},
	driveTransfer: async (input: { id: string; file: { name: string } }) => {
		try {
			const entry = await download(input.file.name, input.id);
			return { success: true, entry, filePath: entry.path };
		} catch (cause) {
			return {
				success: false,
				canceled: String(cause).includes("Canceled"),
				error: String(cause),
			};
		}
	},
	driveCancel: async (id: string) => {
		canceled.add(id);
		return { success: true };
	},
	onDriveProgress: () => () => {},
	importRecording: async (_current: string, file: string) => {
		document.documentElement.dataset.importedPath = file;
		const url = `${location.origin}/tests/ui/fixtures/cloud-import-composed.mp4`;
		return {
			success: true,
			value: { path: url, url, sourceStartMs: 6000, durationMs: 3000, totalDurationMs: 9000 },
		};
	},
	cancelRecordingImport: async () => ({ success: true }),
});
await import("../../src/main");
