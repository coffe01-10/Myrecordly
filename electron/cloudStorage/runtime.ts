import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import { USER_DATA_PATH } from "../appPaths";
import {
	cloudProviders,
	type CloudAccount,
	type CloudEntry,
	type CloudProvider,
} from "../../src/types/cloudStorage";

export function cloudRuntimePath() {
	const base = app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked");
	return path.join(
		base,
		"electron/native/bin",
		`${process.platform}-${process.arch}`,
		process.platform === "win32" ? "rclone.exe" : "rclone",
	);
}
export class CloudStorage {
	private directory = path.join(USER_DATA_PATH, "cloud-storage");
	private config = path.join(this.directory, "accounts.conf");
	private accounts: CloudAccount[] = [];
	private password = "";
	private initialized?: Promise<void>;
	private queue: Promise<unknown> = Promise.resolve();
	private saves: Promise<void> = Promise.resolve();
	private keyUnavailable = false;
	private processes = new Map<string, AbortController>();
	private authorizing?: CloudProvider;
	private sessionOnly = false;
	private loginCanceled = false;
	private openingWeb = new Map<CloudProvider, Promise<CloudAccount>>();
	constructor(private changed: () => void) {}
	private async initialize() {
		this.initialized ??= (async () => {
			await fs.mkdir(this.directory, { recursive: true });
			try {
				this.accounts = JSON.parse(
					await fs.readFile(path.join(this.directory, "accounts.json"), "utf8"),
				);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		})();
		await this.initialized;
	}
	private async unlock() {
		if (this.password) return;
		const keyPath = path.join(this.directory, "key.bin");
		const encrypted =
			safeStorage.isEncryptionAvailable() &&
			!(
				process.platform === "linux" &&
				safeStorage.getSelectedStorageBackend() === "basic_text"
			);
		if (encrypted) {
			try {
				this.password = safeStorage.decryptString(await fs.readFile(keyPath));
				this.keyUnavailable = false;
				return;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					this.keyUnavailable = true;
					throw new Error("无法解锁本机网盘会话，请移除全部直连账号后重新登录。");
				}
			}
		}
		this.password = randomBytes(32).toString("base64url");
		this.sessionOnly = !encrypted;
		if (!encrypted) this.config = path.join(this.directory, `session-${randomUUID()}.conf`);
		try {
			await fs.writeFile(this.config, "", { mode: 0o600 });
			await this.command(
				["config", "encryption", "set"],
				undefined,
				`${this.password}\n${this.password}\n`,
			);
			if (encrypted)
				await fs.writeFile(keyPath, safeStorage.encryptString(this.password), {
					mode: 0o600,
				});
		} catch (error) {
			this.password = "";
			throw error;
		}
	}
	private ordered<T>(run: () => Promise<T>): Promise<T> {
		const next = this.queue.then(run);
		this.queue = next.catch(() => undefined);
		return next;
	}
	private command(args: string[], operationId?: string, input?: string): Promise<string> {
		const controller = new AbortController();
		if (operationId) this.processes.set(operationId, controller);
		return new Promise((resolve, reject) => {
			const child = spawn(cloudRuntimePath(), [...args, "--config", this.config], {
				windowsHide: true,
				signal: controller.signal,
				env: { ...process.env, RCLONE_CONFIG_PASS: this.password },
				stdio: ["pipe", "pipe", "pipe"],
			});
			let stdout = "",
				stderr = "";
			child.stdout.on("data", (chunk) => {
				stdout += chunk.toString();
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk.toString();
			});
			child.stdin.end(input);
			let processError: Error | undefined;
			child.on("error", (error) => {
				processError = error;
			});
			child.on("close", (code) => {
				if (operationId) this.processes.delete(operationId);
				if (controller.signal.aborted) reject(new Error("操作已取消"));
				else if (processError) reject(processError);
				else if (code === 0) resolve(stdout);
				else reject(new Error(stderr.trim() || `网盘操作失败 (${code})`));
			});
		});
	}
	private async save() {
		const contents = JSON.stringify(
			this.accounts.filter((account) => !this.sessionOnly || account.mode === "web"),
			null,
			2,
		);
		const next = this.saves.then(() =>
			fs.writeFile(path.join(this.directory, "accounts.json"), contents),
		);
		this.saves = next.catch(() => undefined);
		await next;
		this.changed();
	}
	async state() {
		await this.initialize();
		const runtimeAvailable = await fs.access(cloudRuntimePath()).then(
			() => true,
			() => false,
		);
		return {
			accounts: this.accounts,
			authorizing: this.authorizing,
			runtimeAvailable,
			sessionOnly: this.sessionOnly,
		};
	}
	async connectWeb(
		provider: CloudProvider,
		open: (account: CloudAccount) => Promise<void>,
		newSession = false,
	) {
		await this.initialize();
		const definition = cloudProviders.find(
			(item) => item.id === provider && item.mode === "web",
		);
		if (!definition) throw new Error("不支持的网页登录服务");
		if (!newSession && this.openingWeb.has(provider)) return this.openingWeb.get(provider)!;
		const connection = (async () => {
			const existing =
				!newSession &&
				this.accounts.find((item) => item.provider === provider && item.mode === "web");
			if (existing) {
				await open(existing);
				return existing;
			}
			const count = this.accounts.filter((item) => item.provider === provider).length;
			const account: CloudAccount = {
				id: `cloud_${randomUUID().replace(/-/g, "")}`,
				provider,
				name: count ? `${definition.name} · ${count + 1}` : definition.name,
				mode: "web",
				connectedAt: new Date().toISOString(),
			};
			await open(account);
			this.accounts.push(account);
			await this.save();
			return account;
		})();
		if (newSession) return connection;
		this.openingWeb.set(provider, connection);
		try {
			return await connection;
		} finally {
			this.openingWeb.delete(provider);
		}
	}
	async connect(provider: CloudProvider) {
		await this.initialize();
		if (provider !== "onedrive" && provider !== "dropbox")
			throw new Error("请使用网盘的网页登录入口");
		if (this.authorizing) throw new Error("请先完成或取消当前浏览器授权");
		this.authorizing = provider;
		this.loginCanceled = false;
		this.changed();
		return this.ordered(async () => {
			const account: CloudAccount = {
				id: `cloud_${randomUUID().replace(/-/g, "")}`,
				provider,
				name: provider === "onedrive" ? "OneDrive" : "Dropbox",
				mode: "oauth",
				connectedAt: new Date().toISOString(),
			};
			try {
				await this.unlock();
				if (this.loginCanceled) throw new Error("操作已取消");
				await this.command(
					[
						"config",
						"create",
						account.id,
						provider,
						"config_is_local",
						"true",
						...(provider === "onedrive" ? ["config_type", "onedrive"] : []),
						"--no-output",
					],
					"login",
				);
				if (this.loginCanceled) throw new Error("操作已取消");
				// The backend config command can finish without a usable drive (e.g. denied consent).
				await this.command(
					["lsjson", `${account.id}:`, "--max-depth", "1", "--dirs-only"],
					"login",
				);
				if (this.loginCanceled) throw new Error("操作已取消");
				this.accounts.push(account);
				await this.save();
				return account;
			} catch (error) {
				await this.command(["config", "delete", account.id]).catch(() => undefined);
				throw error;
			} finally {
				this.authorizing = undefined;
				this.changed();
			}
		});
	}
	async rename(id: string, name: string) {
		await this.initialize();
		const account = this.accounts.find((item) => item.id === id);
		if (!account || !name.trim()) throw new Error("请输入账号名称");
		account.name = name.trim();
		await this.save();
	}
	async remove(id: string) {
		await this.initialize();
		this.cancel(id);
		return this.ordered(async () => {
			const account = this.accounts.find((item) => item.id === id);
			if (account?.mode === "oauth") {
				try {
					await this.unlock();
					await this.command(["config", "delete", id]);
				} catch (error) {
					// An OS keyring reset must not trap an unusable account in the UI.
					if (!this.keyUnavailable) throw error;
				}
			}
			this.accounts = this.accounts.filter((item) => item.id !== id);
			if (this.keyUnavailable && !this.accounts.some((item) => item.mode === "oauth")) {
				await fs.rm(this.config, { force: true });
				await fs.rm(path.join(this.directory, "key.bin"), { force: true });
				this.keyUnavailable = false;
			}
			await this.save();
		});
	}
	async getAccount(id: string) {
		await this.initialize();
		const account = this.accounts.find((item) => item.id === id);
		if (!account) throw new Error("网盘账号已移除，请重新选择");
		return account;
	}
	private remote(id: string, relative: string) {
		return `${id}:${path.posix.normalize(`/${relative}`).slice(1)}`;
	}
	async list(id: string, directory: string): Promise<CloudEntry[]> {
		return this.ordered(async () => {
			await this.getAccount(id);
			await this.unlock();
			return JSON.parse(
				await this.command(["lsjson", this.remote(id, directory), "--max-depth", "1"], id),
			);
		});
	}
	async copy(id: string, remotePath: string, localPath: string, upload: boolean) {
		return this.ordered(async () => {
			await this.getAccount(id);
			await this.unlock();
			const remote = this.remote(id, remotePath);
			await this.command(
				["copyto", ...(upload ? [localPath, remote] : [remote, localPath])],
				id,
			);
		});
	}
	cancel(id = "login") {
		if (id === "login") this.loginCanceled = true;
		this.processes.get(id)?.abort();
	}
	async close() {
		this.loginCanceled = true;
		for (const controller of this.processes.values()) controller.abort();
		await this.queue;
		await this.saves;
		if (this.sessionOnly) await fs.rm(this.config, { force: true });
	}
}
