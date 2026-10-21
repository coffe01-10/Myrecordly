import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { GoogleAuthState, GoogleProfile } from "../../src/types/googleDrive";

export type DesktopClient = { clientId: string; clientSecret?: string };
export type GoogleSession = {
	user: GoogleProfile;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	folderId?: string;
};
export class GoogleError extends Error {
	constructor(
		message: string,
		public code = "GOOGLE_ERROR",
		public status?: number,
	) {
		super(message);
	}
}
export function parseDesktopClient(json: unknown): DesktopClient {
	const installed = (json as { installed?: { client_id?: unknown; client_secret?: unknown } })
		?.installed;
	if (!installed || typeof installed.client_id !== "string" || !installed.client_id.trim()) {
		throw new GoogleError(
			"Import the JSON downloaded for a Google Desktop app OAuth client, not a Web client or API key.",
			"INVALID_CLIENT",
		);
	}
	return {
		clientId: installed.client_id.trim(),
		clientSecret:
			typeof installed.client_secret === "string" ? installed.client_secret : undefined,
	};
}
export interface GoogleAuthOptions {
	readClient(): Promise<DesktopClient | null>;
	readSession(): Promise<GoogleSession | null>;
	writeSession(session: GoogleSession | null): Promise<boolean>;
	openBrowser(url: string): Promise<void>;
	onChange(state: GoogleAuthState): void;
	fetch?: typeof fetch;
}

export class GoogleDesktopAuth {
	private client: DesktopClient | null = null;
	private session: GoogleSession | null = null;
	private loaded?: Promise<void>;
	private persistence = Promise.resolve();
	private pending?: { controller: AbortController; promise: Promise<GoogleAuthState> };
	private refreshing?: Promise<string>;
	private sessionOnly = false;
	private reconnect = false;
	private revision = 0;
	version = 0;
	readonly fetch: typeof fetch;
	constructor(private options: GoogleAuthOptions) {
		this.fetch = options.fetch ?? fetch;
	}
	private async load() {
		this.loaded ??= (async () => {
			this.client = await this.options.readClient();
			this.session = await this.options.readSession();
		})();
		try {
			await this.loaded;
		} catch (error) {
			this.loaded = undefined;
			throw error;
		}
	}
	private snapshot(): GoogleAuthState {
		return {
			revision: this.revision,
			configured: Boolean(this.client),
			user: this.session?.user ?? null,
			authorizing: Boolean(this.pending),
			reconnect: this.reconnect,
			sessionOnly: this.sessionOnly,
		};
	}
	private changed() {
		this.revision++;
		this.options.onChange(this.snapshot());
	}
	async state() {
		await this.load();
		return this.snapshot();
	}
	private persist(session: GoogleSession | null, version: number) {
		const next = this.persistence.then(async () => {
			if (version !== this.version) return;
			this.sessionOnly = !(await this.options.writeSession(session));
		});
		this.persistence = next.catch(() => undefined);
		return next;
	}
	async replaceClient() {
		await this.load();
		this.client = await this.options.readClient();
		await this.signOut();
		return this.snapshot();
	}
	async signOut() {
		await this.load();
		this.cancelSignIn();
		const version = ++this.version;
		this.session = null;
		this.reconnect = false;
		this.refreshing = undefined;
		this.changed();
		await this.persist(null, version);
		return this.snapshot();
	}
	cancelSignIn() {
		this.pending?.controller.abort();
	}
	async signIn(): Promise<GoogleAuthState> {
		await this.load();
		if (this.pending) return this.pending.promise;
		if (!this.client)
			throw new GoogleError(
				"This build does not include Google authorization. The application publisher must configure it; you do not need to create an API key.",
				"NOT_CONFIGURED",
			);
		const controller = new AbortController();
		const version = ++this.version;
		const promise = this.authorize(this.client, controller.signal, version)
			.finally(() => {
				if (this.pending?.promise === promise) {
					this.pending = undefined;
					this.changed();
				}
			})
			.then(() => this.snapshot());
		this.pending = { controller, promise };
		this.changed();
		return promise;
	}
	private async authorize(client: DesktopClient, signal: AbortSignal, version: number) {
		const verifier = randomBytes(32).toString("base64url");
		const state = randomBytes(24).toString("base64url");
		let receive!: (code: string) => void;
		let fail!: (error: Error) => void;
		let received = false;
		const callback = new Promise<string>((resolve, reject) => {
			receive = resolve;
			fail = reject;
		});
		// Attach a rejection handler before opening the browser or awaiting listen.
		void callback.catch(() => undefined);
		const server = createServer((request, response) => {
			const url = new URL(request.url || "/", "http://127.0.0.1");
			const valid =
				request.method === "GET" &&
				url.pathname === "/oauth/google/callback" &&
				url.searchParams.get("state") === state &&
				!received;
			response.setHeader("Content-Type", "text/html; charset=utf-8");
			response.setHeader("Cache-Control", "no-store");
			response.setHeader(
				"Content-Security-Policy",
				"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
			);
			if (!valid) {
				response.writeHead(400);
				response.end("Invalid authorization callback.");
				return;
			}
			const code = url.searchParams.get("code");
			const denied = url.searchParams.get("error");
			if (!code && !denied) {
				response.writeHead(400);
				response.end("Missing authorization code.");
				return;
			}
			received = true;
			response.end(
				'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Recordly</title><style>body{font:16px system-ui;display:grid;place-content:center;min-height:90vh;background:#f6f6f5;color:#222;text-align:center}p{color:#666}</style><h1>请返回 Recordly</h1><p>授权结果已收到，可以关闭此页面。</p></html>',
			);
			if (denied)
				fail(
					new GoogleError(
						"Google authorization was canceled or denied.",
						"AUTH_CANCELED",
					),
				);
			else receive(code!);
		});
		const abort = () =>
			fail(new GoogleError("Google authorization was canceled.", "AUTH_CANCELED"));
		const timeout = setTimeout(
			() =>
				fail(
					new GoogleError(
						"Google authorization timed out. Try signing in again.",
						"AUTH_TIMEOUT",
					),
				),
			10 * 60 * 1000,
		);
		timeout.unref();
		signal.addEventListener("abort", abort, { once: true });
		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(0, "127.0.0.1", resolve);
			});
			const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth/google/callback`;
			const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
			url.search = new URLSearchParams({
				client_id: client.clientId,
				redirect_uri: redirectUri,
				response_type: "code",
				scope: "openid email profile https://www.googleapis.com/auth/drive.file",
				state,
				code_challenge: createHash("sha256").update(verifier).digest("base64url"),
				code_challenge_method: "S256",
				access_type: "offline",
				prompt: "consent select_account",
			}).toString();
			if (signal.aborted) abort();
			else await this.options.openBrowser(url.href);
			const code = await callback;
			const tokens = await this.exchange(
				client,
				{
					grant_type: "authorization_code",
					code,
					redirect_uri: redirectUri,
					code_verifier: verifier,
				},
				signal,
			);
			if (
				tokens.scope &&
				!tokens.scope.split(" ").includes("https://www.googleapis.com/auth/drive.file")
			)
				throw new GoogleError(
					"Allow Recordly access to its Google Drive files, then try again.",
					"DRIVE_PERMISSION_REQUIRED",
				);
			const response = await this.fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
				headers: { authorization: `Bearer ${tokens.access_token}` },
				signal,
			});
			if (!response.ok) throw new GoogleError("Could not read your Google account profile.");
			const profile = (await response.json()) as {
				sub: string;
				email: string;
				name?: string;
				picture?: string;
			};
			if (!profile.sub || !profile.email || !tokens.refresh_token)
				throw new GoogleError(
					"Google did not grant offline access. Try signing in again and allow Drive access.",
					"DRIVE_PERMISSION_REQUIRED",
				);
			if (signal.aborted || version !== this.version)
				throw new GoogleError("Google authorization was canceled.", "AUTH_CANCELED");
			const previous =
				this.session?.user.id === `google:${profile.sub}` ? this.session : null;
			const nextSession: GoogleSession = {
				user: {
					id: `google:${profile.sub}`,
					email: profile.email,
					name: profile.name,
					picture: profile.picture,
				},
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token,
				expiresAt: Date.now() + tokens.expires_in * 1000,
				folderId: previous?.folderId,
			};
			await this.persist(nextSession, version);
			if (signal.aborted) {
				// A disk write cannot be aborted. Restore the prior session after it finishes;
				// a concurrent sign-out has its own newer, queued persistence operation.
				await this.persist(this.session, version);
				throw new GoogleError("Google authorization was canceled.", "AUTH_CANCELED");
			}
			if (version !== this.version)
				throw new GoogleError("Your account changed. Sign in again.", "ACCOUNT_CHANGED");
			this.session = nextSession;
			this.reconnect = false;
			this.version++;
			this.changed();
			return this.snapshot();
		} finally {
			clearTimeout(timeout);
			signal.removeEventListener("abort", abort);
			server.close();
		}
	}
	private async exchange(
		client: DesktopClient,
		values: Record<string, string>,
		signal?: AbortSignal,
	) {
		const response = await this.fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			signal,
			body: new URLSearchParams({
				client_id: client.clientId,
				...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
				...values,
			}),
		});
		const data = (await response.json()) as {
			access_token: string;
			refresh_token?: string;
			expires_in: number;
			scope?: string;
			error?: string;
		};
		if (!response.ok)
			throw new GoogleError(
				data.error === "invalid_grant"
					? "Google authorization expired or was revoked. Sign in again."
					: "Google rejected the OAuth client or authorization. Check the Desktop client configuration and try again.",
				data.error === "invalid_grant" ? "RECONNECT_REQUIRED" : "GOOGLE_ERROR",
			);
		return data;
	}
	async access(expectedAccountId?: string) {
		await this.load();
		const session = this.session;
		if (!session || !this.client)
			throw new GoogleError("Sign in with Google to connect Drive.", "SIGN_IN_REQUIRED");
		if (expectedAccountId && expectedAccountId !== session.user.id)
			throw new GoogleError(
				"Your account changed. Start this operation again.",
				"ACCOUNT_CHANGED",
			);
		const version = this.version;
		if (session.expiresAt <= Date.now() + 60000) {
			this.refreshing ??= (async () => {
				try {
					const tokens = await this.exchange(this.client!, {
						grant_type: "refresh_token",
						refresh_token: session.refreshToken,
					});
					this.assertCurrent(version, session.user.id);
					session.accessToken = tokens.access_token;
					session.expiresAt = Date.now() + tokens.expires_in * 1000;
					if (tokens.refresh_token) session.refreshToken = tokens.refresh_token;
					await this.persist(session, version);
					return tokens.access_token;
				} catch (error) {
					if (
						version === this.version &&
						error instanceof GoogleError &&
						error.code === "RECONNECT_REQUIRED"
					) {
						this.reconnect = true;
						this.changed();
					}
					throw error;
				} finally {
					this.refreshing = undefined;
				}
			})();
			await this.refreshing;
		}
		this.assertCurrent(version, session.user.id);
		return {
			token: session.accessToken,
			accountId: session.user.id,
			version,
			folderId: session.folderId,
		};
	}
	assertCurrent(version: number, accountId: string) {
		if (version !== this.version || this.session?.user.id !== accountId)
			throw new GoogleError(
				"Your account changed. Start this operation again.",
				"ACCOUNT_CHANGED",
			);
	}
	async rememberFolder(id: string, version: number, accountId: string) {
		this.assertCurrent(version, accountId);
		this.session!.folderId = id;
		await this.persist(this.session, version);
	}
}
