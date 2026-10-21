import { app, BrowserWindow, WebContentsView, dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CloudStorage } from "../../cloudStorage/runtime";
import { importCloudVideo } from "../../cloudStorage/importVideo";
import { cloudWebsiteSession } from "../../cloudStorage/webSessions";
import {
	cloudProviders,
	type CloudAccount,
	type CloudProvider,
} from "../../../src/types/cloudStorage";
import { isAllowedLocalReadPath } from "../project/manager";
import { isOwnedExportPath } from "../export/exportStream";

export function registerCloudStorageHandlers() {
	const manager = new CloudStorage(() => {
		for (const window of BrowserWindow.getAllWindows())
			if (!window.isDestroyed()) window.webContents.send("cloud-storage-changed");
	});
	const windows = new Map<string, BrowserWindow>();
	const imports = new Map<string, AbortController>();
	const openWeb = async (account: CloudAccount) => {
		const definition = cloudProviders.find((provider) => provider.id === account.provider)!;
		const current = windows.get(account.id);
		if (current && !current.isDestroyed()) {
			if (current.isMinimized()) current.restore();
			current.show();
			current.focus();
			return;
		}
		const partition = cloudWebsiteSession(account.id);
		partition.setPermissionRequestHandler((_contents, _permission, callback) =>
			callback(false),
		);
		const window = new BrowserWindow({
			width: 1200,
			height: 800,
			title: `${account.name} · Recordly`,
			autoHideMenuBar: true,
			webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
		});
		// Remote pages use a view without Recordly's preload or privileged local-file API.
		const view = new WebContentsView({
			webPreferences: {
				session: partition,
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		window.contentView.addChildView(view);
		const resize = () => {
			const [width, height] = window.getContentSize();
			view.setBounds({ x: 0, y: 0, width, height });
		};
		resize();
		window.on("resize", resize);
		view.webContents.setWindowOpenHandler(({ url }) => {
			if (new URL(url).protocol === "https:") void view.webContents.loadURL(url);
			return { action: "deny" };
		});
		windows.set(account.id, window);
		window.on("closed", () => {
			windows.delete(account.id);
			if (!view.webContents.isDestroyed()) view.webContents.close();
		});
		try {
			await view.webContents.loadURL(definition.url);
		} catch (error) {
			if (!window.isDestroyed()) window.destroy();
			throw new Error(
				`${definition.name}网页未能打开，请重试。${error instanceof Error ? ` ${error.message}` : ""}`,
			);
		}
	};
	ipcMain.handle(
		"cloud-storage-request",
		async (_event, action: string, input: Record<string, string> = {}) => {
			try {
				switch (action) {
					case "state":
						return { success: true, data: await manager.state() };
					case "connect": {
						const provider = cloudProviders.find((item) => item.id === input.provider);
						if (!provider) throw new Error("不支持的网盘服务");
						const account =
							provider.mode === "web"
								? await manager.connectWeb(
										provider.id,
										openWeb,
										input.newSession === "true",
									)
								: await manager.connect(provider.id as CloudProvider);
						return { success: true, data: account };
					}
					case "open": {
						const account = await manager.getAccount(input.id);
						if (account.mode !== "web") throw new Error("请在应用内浏览此账号的文件");
						await openWeb(account);
						break;
					}
					case "rename":
						await manager.rename(input.id, input.name);
						break;
					case "remove": {
						const account = await manager.getAccount(input.id);
						if (account.mode === "web") {
							windows.get(input.id)?.destroy();
							const partition = cloudWebsiteSession(account.id);
							await partition.clearStorageData();
							await partition.clearCache();
						}
						await manager.remove(input.id);
						break;
					}
					case "cancel":
						imports.get(input.id)?.abort();
						manager.cancel(input.id);
						break;
					case "list":
						return {
							success: true,
							data: await manager.list(input.id, input.directory ?? ""),
						};
					case "upload": {
						let file = input.filePath;
						if (file) {
							if (!isAllowedLocalReadPath(file) && !isOwnedExportPath(file))
								throw new Error("请选择要上传的文件");
						} else {
							const selected = await dialog.showOpenDialog({
								properties: ["openFile"],
							});
							if (selected.canceled)
								return { success: true, data: { canceled: true } };
							file = selected.filePaths[0];
						}
						await manager.copy(
							input.id,
							path.posix.join(
								input.directory ?? "",
								path.basename(input.name || file),
							),
							await fs.realpath(file),
							true,
						);
						break;
					}
					case "download": {
						const selected = await dialog.showSaveDialog({
							defaultPath: path.posix.basename(input.path),
						});
						if (selected.canceled || !selected.filePath)
							return { success: true, data: { canceled: true } };
						const partial = `${selected.filePath}.${randomUUID()}.partial`;
						try {
							await manager.copy(
								input.id,
								input.path,
								partial,
								false,
								input.operationId,
							);
							await fs.rename(partial, selected.filePath);
						} finally {
							await fs.rm(partial, { force: true });
						}
						break;
					}
					case "import": {
						const operationId = input.operationId ?? randomUUID();
						const controller = new AbortController();
						imports.set(operationId, controller);
						try {
							const data = await importCloudVideo(
								path.posix.basename(input.path),
								async (partial) => {
									// Cancel can arrive while the library directory/file is being prepared.
									controller.signal.throwIfAborted();
									await manager.copy(
										input.id,
										input.path,
										partial,
										false,
										operationId,
									);
									controller.signal.throwIfAborted();
								},
							);
							return { success: true, data };
						} finally {
							imports.delete(operationId);
						}
					}
					default:
						throw new Error("不支持的网盘操作");
				}
				return { success: true, data: null };
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);
	let closed = false;
	app.on("before-quit", (event) => {
		if (closed) return;
		event.preventDefault();
		for (const window of windows.values()) window.destroy();
		void manager
			.close()
			.catch((error) => console.warn("Could not close cloud sessions", error))
			.finally(() => {
				closed = true;
				app.quit();
			});
	});
}
