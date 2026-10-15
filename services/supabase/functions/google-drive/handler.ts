export type Connection = {
	user_id: string;
	google_sub: string;
	email: string;
	refresh_token: string;
	access_token: string;
	expires_at: number;
	folder_id: string | null;
};
export interface DriveBackend {
	authenticate(token: string): Promise<string | null>;
	read(userId: string): Promise<Connection | null>;
	save(connection: Connection): Promise<void>;
	remove(userId: string): Promise<void>;
	clientId: string;
	clientSecret: string;
	fetch?: typeof fetch;
}
const headers = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Content-Type": "application/json",
	"Cache-Control": "no-store",
};
const fields = "id,name,mimeType,size,modifiedTime,webViewLink,capabilities";
const folderMime = "application/vnd.google-apps.folder";
const reply = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers });
class DriveError extends Error {
	constructor(
		message: string,
		public status = 400,
		public code = "DRIVE_ERROR",
	) {
		super(message);
	}
}
function required(value: unknown, label: string) {
	if (typeof value !== "string" || !value.trim()) throw new DriveError(`Missing ${label}.`);
	return value.trim();
}
function fileId(value: unknown) {
	const id = required(value, "file ID");
	if (!/^[\w-]+$/.test(id)) throw new DriveError("Invalid file ID.");
	return id;
}

export function googleDriveHandler(backend: DriveBackend) {
	const requestGoogle = backend.fetch ?? fetch;
	async function google<T>(token: string, resource: string, init: RequestInit = {}): Promise<T> {
		const response = await requestGoogle(`https://www.googleapis.com/drive/v3/${resource}`, {
			...init,
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
				...init.headers,
			},
		});
		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			throw new DriveError(
				body.error?.message || `Google Drive request failed (${response.status}).`,
				response.status,
				response.status === 401 ? "RECONNECT_REQUIRED" : "DRIVE_ERROR",
			);
		}
		return response.status === 204 ? (undefined as T) : response.json();
	}
	async function tokenFor(connection: Connection) {
		if (connection.expires_at > Date.now() + 60000) return connection.access_token;
		if (!backend.clientId || !backend.clientSecret)
			throw new DriveError(
				"Configure the Google OAuth credentials in the Drive service.",
				503,
				"NOT_CONFIGURED",
			);
		const response = await requestGoogle("https://oauth2.googleapis.com/token", {
			method: "POST",
			body: new URLSearchParams({
				client_id: backend.clientId,
				client_secret: backend.clientSecret,
				refresh_token: connection.refresh_token,
				grant_type: "refresh_token",
			}),
		});
		const data = await response.json();
		if (!response.ok)
			throw new DriveError(
				"Reconnect Google Drive to renew its authorization.",
				401,
				"RECONNECT_REQUIRED",
			);
		connection.access_token = data.access_token;
		connection.expires_at = Date.now() + data.expires_in * 1000;
		if (data.refresh_token) connection.refresh_token = data.refresh_token;
		await backend.save(connection);
		return connection.access_token;
	}
	async function folderFor(connection: Connection, token: string) {
		if (connection.folder_id) {
			try {
				const folder = await google<{ trashed?: boolean }>(
					token,
					`files/${connection.folder_id}?fields=trashed`,
				);
				if (!folder.trashed) return connection.folder_id;
			} catch (error) {
				if (!(error instanceof DriveError) || error.status !== 404) throw error;
			}
		}
		const q = `trashed = false and mimeType = '${folderMime}' and appProperties has { key='recordlyRoot' and value='true' }`;
		const found = await google<{ files: { id: string }[] }>(
			token,
			`files?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1" })}`,
		);
		const folder =
			found.files[0] ??
			(await google<{ id: string }>(token, "files?fields=id", {
				method: "POST",
				body: JSON.stringify({
					name: "Recordly",
					mimeType: folderMime,
					appProperties: { recordlyRoot: "true" },
				}),
			}));
		connection.folder_id = folder.id;
		await backend.save(connection);
		return folder.id;
	}
	return async (request: Request): Promise<Response> => {
		if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
		if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
		try {
			const bearer = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
			const userId = bearer ? await backend.authenticate(bearer) : null;
			if (!userId)
				return reply(
					{ code: "SIGN_IN_REQUIRED", error: "Sign in to Recordly first." },
					401,
				);
			const input = await request.json();
			let connection = await backend.read(userId);
			if (input.action === "connect") {
				if (!backend.clientId || !backend.clientSecret)
					throw new DriveError(
						"Configure the Google OAuth credentials in the Drive service.",
						503,
						"NOT_CONFIGURED",
					);
				const accessToken = required(input.accessToken, "Google access token");
				const profileResponse = await requestGoogle(
					"https://www.googleapis.com/oauth2/v3/userinfo",
					{
						headers: { authorization: `Bearer ${accessToken}` },
					},
				);
				if (!profileResponse.ok)
					throw new DriveError(
						"Google authorization expired. Connect again.",
						401,
						"RECONNECT_REQUIRED",
					);
				const profile = await profileResponse.json();
				// Only reuse the refresh token for the same Google identity. Otherwise a
				// connection could display account B while refreshing account A's token.
				const refreshToken =
					input.refreshToken ||
					(connection?.google_sub === profile.sub ? connection.refresh_token : null);
				if (!refreshToken)
					throw new DriveError(
						"Authorize offline access to connect Google Drive.",
						401,
						"RECONNECT_REQUIRED",
					);
				const sameAccount = connection?.google_sub === profile.sub;
				connection = {
					user_id: userId,
					google_sub: profile.sub,
					email: profile.email,
					refresh_token: refreshToken,
					access_token: accessToken,
					expires_at: 0,
					folder_id: sameAccount ? connection!.folder_id : null,
				};
				// Validate the refresh token against this OAuth client and identity before
				// saving it. Pairing unrelated access/refresh tokens must never switch accounts.
				const refreshedResponse = await requestGoogle(
					"https://oauth2.googleapis.com/token",
					{
						method: "POST",
						body: new URLSearchParams({
							client_id: backend.clientId,
							client_secret: backend.clientSecret,
							refresh_token: refreshToken,
							grant_type: "refresh_token",
						}),
					},
				);
				const refreshed = await refreshedResponse.json();
				if (!refreshedResponse.ok)
					throw new DriveError(
						"Could not renew Google authorization. Reconnect Drive or check the Google OAuth service configuration.",
						401,
						"RECONNECT_REQUIRED",
					);
				const verifiedResponse = await requestGoogle(
					"https://www.googleapis.com/oauth2/v3/userinfo",
					{
						headers: { authorization: `Bearer ${refreshed.access_token}` },
					},
				);
				const verified = await verifiedResponse.json();
				if (!verifiedResponse.ok || verified.sub !== profile.sub)
					throw new DriveError(
						"Google account authorization does not match. Connect again.",
						401,
						"RECONNECT_REQUIRED",
					);
				connection.access_token = refreshed.access_token;
				connection.expires_at = Date.now() + refreshed.expires_in * 1000;
				await google(connection.access_token, "files?pageSize=1&fields=files(id)");
				await folderFor(connection, connection.access_token);
				await backend.save(connection);
			}
			if (input.action === "disconnect") {
				await backend.remove(userId);
				return reply({ connected: false });
			}
			if (!connection) {
				if (input.action === "status") return reply({ connected: false });
				throw new DriveError("Connect Google Drive first.", 409, "DRIVE_NOT_CONNECTED");
			}
			const token = await tokenFor(connection);
			const folderId = await folderFor(connection, token);
			if (input.action === "status" || input.action === "connect") {
				return reply({ connected: true, email: connection.email, folderId });
			}
			if (input.action === "list") {
				const parent = input.parentId ? fileId(input.parentId) : folderId;
				return reply(
					await google(
						token,
						`files?${new URLSearchParams({
							q: `'${parent}' in parents and trashed = false`,
							fields: `nextPageToken,files(${fields})`,
							pageSize: "100",
							orderBy: "folder,name",
							...(input.pageToken ? { pageToken: String(input.pageToken) } : {}),
						})}`,
					),
				);
			}
			if (input.action === "mkdir") {
				return reply(
					await google(token, `files?fields=${fields}`, {
						method: "POST",
						body: JSON.stringify({
							name: required(input.name, "folder name"),
							mimeType: folderMime,
							parents: [input.parentId ? fileId(input.parentId) : folderId],
						}),
					}),
				);
			}
			if (input.action === "start-upload") {
				if (!Number.isSafeInteger(input.size) || input.size <= 0)
					throw new DriveError("The file is empty.");
				const response = await requestGoogle(
					`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${fields}`,
					{
						method: "POST",
						headers: {
							authorization: `Bearer ${token}`,
							"content-type": "application/json",
							"X-Upload-Content-Type": required(input.mimeType, "file type"),
							"X-Upload-Content-Length": String(input.size),
						},
						body: JSON.stringify({
							name: required(input.name, "file name"),
							parents: [input.parentId ? fileId(input.parentId) : folderId],
						}),
					},
				);
				if (!response.ok) {
					const body = await response.json().catch(() => ({}));
					throw new DriveError(
						body.error?.message || "Could not start Drive upload.",
						response.status,
					);
				}
				return reply({ uploadUrl: response.headers.get("location"), accessToken: token });
			}
			const id = fileId(input.fileId);
			const resource = `files/${id}`;
			if (input.action === "download") {
				const file = await google(token, `${resource}?fields=${fields}`);
				return reply({ file, accessToken: token });
			}
			if (input.action === "rename" || input.action === "trash") {
				return reply(
					await google(token, `${resource}?fields=${fields}`, {
						method: "PATCH",
						body: JSON.stringify(
							input.action === "trash"
								? { trashed: true }
								: { name: required(input.name, "file name") },
						),
					}),
				);
			}
			if (input.action === "permissions") {
				return reply(
					await google(
						token,
						`${resource}/permissions?fields=permissions(id,type,role,emailAddress,displayName,permissionDetails)&supportsAllDrives=true`,
					),
				);
			}
			if (input.action === "grant") {
				if (input.role !== "reader" && input.role !== "writer")
					throw new DriveError("Invalid permission role.");
				const permission =
					input.type === "anyone"
						? { type: "anyone", role: "reader", allowFileDiscovery: false }
						: {
								type: "user",
								role: input.role,
								emailAddress: required(input.email, "recipient email"),
							};
				return reply(
					await google(
						token,
						`${resource}/permissions?sendNotificationEmail=${input.type !== "anyone"}&fields=id,type,role,emailAddress`,
						{
							method: "POST",
							body: JSON.stringify(permission),
						},
					),
				);
			}
			if (input.action === "revoke") {
				await google(token, `${resource}/permissions/${fileId(input.permissionId)}`, {
					method: "DELETE",
				});
				return reply({ success: true });
			}
			throw new DriveError("Unknown Drive action.");
		} catch (error) {
			if (error instanceof DriveError)
				return reply({ error: error.message, code: error.code }, error.status);
			// Do not send database errors (which could contain token values) to clients.
			return reply(
				{
					error: "Google Drive service unavailable. Check the service configuration and try again.",
					code: "DRIVE_UNAVAILABLE",
				},
				500,
			);
		}
	};
}
