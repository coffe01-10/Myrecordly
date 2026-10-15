import type { Session } from "@supabase/supabase-js";
import type { DriveFile, DrivePermission, DriveStatus } from "@/types/googleDrive";
import { recordlyAuth } from "../auth/client";

export class GoogleDriveError extends Error {
	constructor(
		message: string,
		public code?: string,
	) {
		super(message);
	}
}
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
	if (!recordlyAuth)
		throw new GoogleDriveError(
			"Google Drive needs the Recordly authentication service to be configured.",
			"NOT_CONFIGURED",
		);
	const { data: auth } = await recordlyAuth.auth.getSession();
	if (!auth.session || (expectedAccountId && auth.session.user.id !== expectedAccountId))
		throw new GoogleDriveError(
			"Your account changed. Start this operation again.",
			"ACCOUNT_CHANGED",
		);
	const { data, error } = await recordlyAuth.functions.invoke("google-drive", {
		body: { ...input, action },
		headers: { Authorization: `Bearer ${auth.session.access_token}` },
	});
	if (error) {
		const detail =
			error.context instanceof Response ? await error.context.json().catch(() => null) : null;
		throw new GoogleDriveError(
			detail?.error ||
				"Google Drive is unavailable. Check that the Drive service is deployed.",
			detail?.code,
		);
	}
	return data as T;
}

export async function connectDriveSession(session: Session) {
	if (!session.provider_token) return;
	await driveRequest<DriveStatus>("connect", {
		accessToken: session.provider_token,
		refreshToken: session.provider_refresh_token,
	});
	notifyDriveChanged();
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
		const session = await driveRequest<{ accessToken: string; uploadUrl: string }>(
			"start-upload",
			{ ...info, name: name || info.name, parentId },
			operation.accountId,
		);
		if (operation.canceled) return { success: false, canceled: true };
		return window.electronAPI.driveTransfer({
			id: operation.id,
			direction: "upload",
			filePath,
			...session,
		});
	},
	async download(fileId: string, operation: DriveOperation) {
		const session = await driveRequest<{ accessToken: string; file: DriveFile }>(
			"download",
			{ fileId },
			operation.accountId,
		);
		if (operation.canceled) return { success: false, canceled: true };
		return window.electronAPI.driveTransfer({
			id: operation.id,
			direction: "download",
			...session,
		});
	},
	async disconnect() {
		await driveRequest("disconnect");
		notifyDriveChanged();
	},
};
