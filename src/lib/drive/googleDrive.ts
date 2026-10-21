import type { DriveFile, DrivePermission, DriveStatus } from "@/types/googleDrive";
import { GoogleDesktopError, unwrapGoogle } from "../auth/googleDesktop";
export { GoogleDesktopError as GoogleDriveError } from "../auth/googleDesktop";
export type DriveOperation = { id: string; accountId?: string; canceled: boolean };
const driveChangeKey = "recordly.drive.changed";
export function notifyDriveChanged() {
	window.dispatchEvent(new Event("recordly-drive-changed"));
	// Auth callbacks can finish in a different Electron window from the library.
	localStorage.setItem(driveChangeKey, String(Date.now()));
}
export function subscribeDriveChanges(listener: () => void) {
	const storageChanged = (event: StorageEvent) => {
		if (event.key === driveChangeKey) listener();
	};
	window.addEventListener("recordly-drive-changed", listener);
	window.addEventListener("storage", storageChanged);
	return () => {
		window.removeEventListener("recordly-drive-changed", listener);
		window.removeEventListener("storage", storageChanged);
	};
}
export async function driveRequest<T>(
	action: string,
	input: Record<string, unknown> = {},
	expectedAccountId?: string,
): Promise<T> {
	if (!window.electronAPI?.driveRequest)
		throw new GoogleDesktopError(
			"Open the latest Recordly desktop app to use Drive.",
			"DESKTOP_REQUIRED",
		);
	return unwrapGoogle(
		await window.electronAPI.driveRequest(action, input, expectedAccountId),
	) as T;
}
export const driveApi = {
	status: () => driveRequest<DriveStatus>("status"),
	list: (parentId?: string, pageToken?: string, accountId?: string) =>
		driveRequest<{ files: DriveFile[]; nextPageToken?: string }>(
			"list",
			{
				parentId,
				pageToken,
			},
			accountId,
		),
	permissions: (fileId: string, accountId?: string) =>
		driveRequest<{ permissions: DrivePermission[] }>("permissions", { fileId }, accountId),
	async upload(filePath: string, operation: DriveOperation, parentId?: string, name?: string) {
		const info = await window.electronAPI.driveFileInfo(filePath);
		if (operation.canceled) return { success: false, canceled: true };
		const session = await driveRequest<{ ticketId: string }>(
			"start-upload",
			{ ...info, name: name || info.name, parentId, transferId: operation.id },
			operation.accountId,
		);
		if (operation.canceled) {
			await window.electronAPI.driveCancel(operation.id);
			return { success: false, canceled: true };
		}
		return window.electronAPI.driveTransfer({
			id: operation.id,
			direction: "upload",
			filePath,
			...session,
		});
	},
	async download(fileId: string, operation: DriveOperation, destination?: "library") {
		const session = await driveRequest<{ ticketId: string; file: DriveFile }>(
			"download",
			{ fileId, transferId: operation.id },
			operation.accountId,
		);
		if (operation.canceled) {
			await window.electronAPI.driveCancel(operation.id);
			return { success: false, canceled: true };
		}
		return window.electronAPI.driveTransfer({
			id: operation.id,
			direction: "download",
			...(destination ? { destination } : {}),
			...session,
		});
	},
	async disconnect() {
		await driveRequest("disconnect");
		notifyDriveChanged();
	},
};
