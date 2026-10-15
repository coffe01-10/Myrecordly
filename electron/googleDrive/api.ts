import { randomUUID } from "node:crypto";
import type { DriveFile, DrivePermission, DriveStatus } from "../../src/types/googleDrive";
import { GoogleDesktopAuth, GoogleError } from "./auth";

const fields = "id,name,mimeType,size,modifiedTime,webViewLink,capabilities";
const folderMime = "application/vnd.google-apps.folder";
function required(value: unknown, label: string) {
	if (typeof value !== "string" || !value.trim()) throw new GoogleError(`Missing ${label}.`);
	return value.trim();
}
function fileId(value: unknown) {
	const id = required(value, "file ID");
	if (!/^[\w-]+$/.test(id)) throw new GoogleError("Invalid file ID.");
	return id;
}
type Access = Awaited<ReturnType<GoogleDesktopAuth["access"]>>;
export type DriveTicket = Access & { uploadUrl?: string; file?: DriveFile };

export class DesktopDriveApi {
	private tickets = new Map<string, DriveTicket>();
	private rootPending?: { version: number; promise: Promise<string> };
	constructor(private auth: GoogleDesktopAuth) {}
	clearTickets() {
		this.tickets.clear();
	}
	cancelTicket(id: string) {
		this.tickets.delete(id);
	}
	consumeTicket(id: string) {
		const ticket = this.tickets.get(id);
		this.tickets.delete(id);
		if (!ticket) throw new GoogleError("This transfer has expired or was canceled. Try again.");
		this.auth.assertCurrent(ticket.version, ticket.accountId);
		return ticket;
	}
	assertTicket(ticket: DriveTicket) {
		this.auth.assertCurrent(ticket.version, ticket.accountId);
	}
	private async google<T>(access: Access, resource: string, init: RequestInit = {}): Promise<T> {
		this.auth.assertCurrent(access.version, access.accountId);
		const response = await this.auth.fetch(`https://www.googleapis.com/drive/v3/${resource}`, {
			...init,
			headers: {
				authorization: `Bearer ${access.token}`,
				"content-type": "application/json",
				...init.headers,
			},
		});
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new GoogleError(
				data.error?.message || `Google Drive request failed (${response.status}).`,
				response.status === 401 ? "RECONNECT_REQUIRED" : "DRIVE_ERROR",
				response.status,
			);
		}
		return response.status === 204 ? (undefined as T) : response.json();
	}
	private root(access: Access) {
		if (this.rootPending?.version === access.version) return this.rootPending.promise;
		const promise = this.findRoot(access).finally(() => {
			if (this.rootPending?.promise === promise) this.rootPending = undefined;
		});
		this.rootPending = { version: access.version, promise };
		return promise;
	}
	private async findRoot(access: Access) {
		if (access.folderId) {
			try {
				const folder = await this.google<{ trashed?: boolean }>(
					access,
					`files/${access.folderId}?fields=trashed`,
				);
				if (!folder.trashed) return access.folderId;
			} catch (error) {
				if (!(error instanceof GoogleError) || error.status !== 404) throw error;
			}
		}
		const q = `trashed = false and mimeType = '${folderMime}' and appProperties has { key='recordlyRoot' and value='true' }`;
		const found = await this.google<{ files: { id: string }[] }>(
			access,
			`files?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1" })}`,
		);
		const folder =
			found.files[0] ??
			(await this.google<{ id: string }>(access, "files?fields=id", {
				method: "POST",
				body: JSON.stringify({
					name: "Recordly",
					mimeType: folderMime,
					appProperties: { recordlyRoot: "true" },
				}),
			}));
		await this.auth.rememberFolder(folder.id, access.version, access.accountId);
		return folder.id;
	}
	async request(
		action: string,
		input: Record<string, unknown> = {},
		expectedAccountId?: string,
	): Promise<unknown> {
		const state = await this.auth.state();
		if (action === "disconnect") return this.auth.signOut();
		if (action === "status" && (!state.user || state.reconnect))
			return {
				configured: state.configured,
				connected: false,
				email: state.user?.email,
				reconnect: state.reconnect,
			} satisfies DriveStatus;
		const access = await this.auth.access(expectedAccountId);
		if (action === "status")
			return {
				connected: true,
				configured: true,
				accountId: access.accountId,
				email: state.user!.email,
				folderId: await this.root(access),
				sessionOnly: state.sessionOnly,
			};
		if (action === "list") {
			const parent = input.parentId ? fileId(input.parentId) : await this.root(access);
			return this.google(
				access,
				`files?${new URLSearchParams({ q: `'${parent}' in parents and trashed = false`, fields: `nextPageToken,files(${fields})`, pageSize: "100", orderBy: "folder,name", ...(input.pageToken ? { pageToken: String(input.pageToken) } : {}) })}`,
			);
		}
		if (action === "mkdir")
			return this.google(access, `files?fields=${fields}`, {
				method: "POST",
				body: JSON.stringify({
					name: required(input.name, "folder name"),
					mimeType: folderMime,
					parents: [input.parentId ? fileId(input.parentId) : await this.root(access)],
				}),
			});
		if (action === "start-upload") {
			if (!Number.isSafeInteger(input.size) || Number(input.size) <= 0)
				throw new GoogleError("The file is empty.");
			const response = await this.auth.fetch(
				`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${fields}`,
				{
					method: "POST",
					headers: {
						authorization: `Bearer ${access.token}`,
						"content-type": "application/json",
						"X-Upload-Content-Type": required(input.mimeType, "file type"),
						"X-Upload-Content-Length": String(input.size),
					},
					body: JSON.stringify({
						name: required(input.name, "file name"),
						parents: [
							input.parentId ? fileId(input.parentId) : await this.root(access),
						],
					}),
				},
			);
			if (!response.ok) {
				const data = await response.json().catch(() => ({}));
				throw new GoogleError(
					data.error?.message || `Could not start Drive upload (${response.status}).`,
				);
			}
			this.auth.assertCurrent(access.version, access.accountId);
			const uploadUrl = response.headers.get("location");
			if (!uploadUrl) throw new GoogleError("Google did not return an upload session.");
			const ticketId = typeof input.transferId === "string" ? input.transferId : randomUUID();
			this.tickets.set(ticketId, { ...access, uploadUrl });
			return { ticketId };
		}
		const id = fileId(input.fileId);
		const resource = `files/${id}`;
		if (action === "download") {
			const file = await this.google<DriveFile>(access, `${resource}?fields=${fields}`);
			this.auth.assertCurrent(access.version, access.accountId);
			const ticketId = typeof input.transferId === "string" ? input.transferId : randomUUID();
			this.tickets.set(ticketId, { ...access, file });
			return { ticketId, file };
		}
		if (action === "rename" || action === "trash")
			return this.google(access, `${resource}?fields=${fields}`, {
				method: "PATCH",
				body: JSON.stringify(
					action === "trash"
						? { trashed: true }
						: { name: required(input.name, "file name") },
				),
			});
		if (action === "permissions") {
			const permissions: DrivePermission[] = [];
			let pageToken: string | undefined;
			do {
				const page = await this.google<{
					permissions: DrivePermission[];
					nextPageToken?: string;
				}>(
					access,
					`${resource}/permissions?${new URLSearchParams({ fields: "nextPageToken,permissions(id,type,role,emailAddress,displayName,permissionDetails)", pageSize: "100", supportsAllDrives: "true", ...(pageToken ? { pageToken } : {}) })}`,
				);
				permissions.push(...page.permissions);
				pageToken = page.nextPageToken;
			} while (pageToken);
			return { permissions };
		}
		if (action === "grant") {
			if (input.role !== "reader" && input.role !== "writer")
				throw new GoogleError("Invalid permission role.");
			const permission =
				input.type === "anyone"
					? { type: "anyone", role: "reader", allowFileDiscovery: false }
					: {
							type: "user",
							role: input.role,
							emailAddress: required(input.email, "recipient email"),
						};
			return this.google(
				access,
				`${resource}/permissions?sendNotificationEmail=${input.type !== "anyone"}&fields=id,type,role,emailAddress`,
				{ method: "POST", body: JSON.stringify(permission) },
			);
		}
		if (action === "revoke") {
			await this.google(access, `${resource}/permissions/${fileId(input.permissionId)}`, {
				method: "DELETE",
			});
			return { success: true };
		}
		throw new GoogleError("Unknown Google Drive action.");
	}
}
