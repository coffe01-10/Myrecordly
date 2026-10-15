import fs from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import { USER_DATA_PATH } from "../appPaths";
import { parseDesktopClient, type GoogleSession } from "./auth";

const clientPath = path.join(USER_DATA_PATH, "google-oauth-desktop.json");
const sessionPath = path.join(USER_DATA_PATH, "google-session.bin");
async function readOptional(file: string) {
	try {
		return await fs.readFile(file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
function canEncrypt() {
	return (
		safeStorage.isEncryptionAvailable() &&
		!(process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")
	);
}
export const googleStorage = {
	async readClient() {
		const local = await readOptional(clientPath);
		const bundled =
			local ??
			(await readOptional(
				path.join(
					app.getAppPath(),
					app.isPackaged ? "dist" : "public",
					"google-oauth-desktop.json",
				),
			));
		return bundled ? parseDesktopClient(JSON.parse(bundled.toString("utf8"))) : null;
	},
	async importClient(file: string) {
		const content = await fs.readFile(file, "utf8");
		const client = parseDesktopClient(JSON.parse(content));
		await fs.mkdir(USER_DATA_PATH, { recursive: true });
		const temporary = `${clientPath}.new`;
		try {
			await fs.writeFile(
				temporary,
				JSON.stringify({
					installed: { client_id: client.clientId, client_secret: client.clientSecret },
				}),
				{ mode: 0o600 },
			);
			await fs.rename(temporary, clientPath);
		} finally {
			await fs.rm(temporary, { force: true });
		}
	},
	async readSession(): Promise<GoogleSession | null> {
		const content = await readOptional(sessionPath);
		if (!content || !canEncrypt()) return null;
		try {
			return JSON.parse(safeStorage.decryptString(content)) as GoogleSession;
		} catch {
			return null;
		} // An OS account/keyring change requires Google sign-in again.
	},
	async writeSession(session: GoogleSession | null) {
		if (!session) {
			await fs.rm(sessionPath, { force: true });
			return true;
		}
		if (!canEncrypt()) return false; // Keep this session in memory instead of writing plaintext tokens.
		await fs.mkdir(USER_DATA_PATH, { recursive: true });
		const temporary = `${sessionPath}.new`;
		try {
			await fs.writeFile(temporary, safeStorage.encryptString(JSON.stringify(session)), {
				mode: 0o600,
			});
			await fs.rename(temporary, sessionPath);
		} finally {
			await fs.rm(temporary, { force: true });
		}
		return true;
	},
};
