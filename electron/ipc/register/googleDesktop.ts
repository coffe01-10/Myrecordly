import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { GoogleResult } from "../../../src/types/googleDrive";
import { GoogleDesktopAuth, GoogleError } from "../../googleDrive/auth";
import { DesktopDriveApi } from "../../googleDrive/api";
import { googleStorage } from "../../googleDrive/storage";
import { cancelAllDriveTransfers } from "./googleDrive";
import { t } from "../../i18n";

export function registerGoogleDesktopHandlers() {
	let previousVersion = 0;
	const auth = new GoogleDesktopAuth({
		...googleStorage,
		openBrowser: (url) => shell.openExternal(url),
		onChange(state) {
			if (previousVersion !== auth.version) {
				previousVersion = auth.version;
				api.clearTickets();
				cancelAllDriveTransfers();
			}
			for (const window of BrowserWindow.getAllWindows())
				if (!window.isDestroyed()) window.webContents.send("google-auth-changed", state);
		},
	});
	const api = new DesktopDriveApi(auth);
	const wrap =
		<T>(action: () => Promise<T>) =>
		async (): Promise<GoogleResult<T>> => {
			try {
				return { success: true, data: await action() };
			} catch (error) {
				return {
					success: false,
					error:
						error instanceof GoogleError
							? error.message
							: "Could not complete the Google request. Check your connection and configuration, then try again.",
					code: error instanceof GoogleError ? error.code : "GOOGLE_ERROR",
					canceled: error instanceof GoogleError && error.code === "AUTH_CANCELED",
				};
			}
		};
	const importClient = async () => {
		const choice = await dialog.showOpenDialog({
			title: t("dialog.importGoogleClient", "Import Google Desktop OAuth client"),
			properties: ["openFile"],
			filters: [
				{
					name: t("filter.googleClient", "Google Desktop OAuth client JSON"),
					extensions: ["json"],
				},
			],
		});
		if (choice.canceled) return auth.state();
		await googleStorage.importClient(choice.filePaths[0]);
		return auth.replaceClient();
	};
	ipcMain.handle(
		"google-auth-state",
		wrap(() => auth.state()),
	);
	ipcMain.handle("google-auth-import-client", wrap(importClient));
	ipcMain.handle(
		"google-auth-sign-in",
		wrap(async () => {
			const state = await auth.signIn();
			const window =
				BrowserWindow.getAllWindows().find((candidate) =>
					candidate.webContents.getURL().includes("windowType=editor"),
				) ?? BrowserWindow.getFocusedWindow();
			if (window && !window.isDestroyed()) {
				if (window.isMinimized()) window.restore();
				window.show();
				window.focus();
			}
			return state;
		}),
	);
	ipcMain.handle(
		"google-auth-sign-out",
		wrap(() => auth.signOut()),
	);
	ipcMain.handle("google-auth-cancel", () => auth.cancelSignIn());
	ipcMain.handle(
		"google-drive-request",
		(_event, action: string, input: Record<string, unknown>, accountId?: string) =>
			wrap(() => api.request(action, input, accountId))(),
	);
	app.on("before-quit", () => {
		auth.cancelSignIn();
		cancelAllDriveTransfers();
	});
	return api;
}
