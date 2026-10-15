import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GoogleSession } from "./auth";
const state = vi.hoisted(() => ({
	root: "",
	encrypted: true,
	encrypt: vi.fn((value: string) =>
		Buffer.from(`sealed:${Buffer.from(value).toString("base64")}`),
	),
	decrypt: vi.fn((value: Buffer) => Buffer.from(value.toString().slice(7), "base64").toString()),
}));
vi.mock("electron", () => ({
	app: { getAppPath: () => state.root, isPackaged: false },
	safeStorage: {
		isEncryptionAvailable: () => state.encrypted,
		getSelectedStorageBackend: () => "test-keyring",
		encryptString: state.encrypt,
		decryptString: state.decrypt,
	},
}));
vi.mock("../appPaths", () => ({
	get USER_DATA_PATH() {
		return state.root;
	},
}));
let storage: typeof import("./storage").googleStorage;
const session: GoogleSession = {
	user: { id: "google:alice", email: "alice@example.test" },
	accessToken: "test-access-token",
	refreshToken: "test-refresh-token",
	expiresAt: 1,
};
beforeEach(async () => {
	vi.resetModules();
	state.encrypted = true;
	state.encrypt.mockClear();
	state.decrypt.mockClear();
	state.root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-google-storage-"));
	storage = (await import("./storage")).googleStorage;
});
afterEach(async () => {
	await fs.rm(state.root, { recursive: true, force: true });
});
it("persists and restores sessions through OS safeStorage without plaintext tokens or leftover temporary files", async () => {
	expect(await storage.writeSession(session)).toBe(true);
	expect(
		(await fs.readFile(path.join(state.root, "google-session.bin"))).toString(),
	).not.toContain("test-refresh-token");
	expect(state.encrypt).toHaveBeenCalledOnce();
	expect(await storage.readSession()).toEqual(session);
	expect(await fs.readdir(state.root)).toEqual(["google-session.bin"]);
	await storage.writeSession(null);
	expect(await fs.readdir(state.root)).toEqual([]);
});
it("uses memory-only sessions if OS encryption is unavailable", async () => {
	state.encrypted = false;
	expect(await storage.writeSession(session)).toBe(false);
	expect(await fs.readdir(state.root)).toEqual([]);
});
it("imports Desktop JSON atomically and rejects Web clients without overwriting it", async () => {
	const selected = path.join(state.root, "download.json");
	await fs.writeFile(
		selected,
		JSON.stringify({
			installed: { client_id: "desktop", client_secret: "native-client-secret" },
		}),
	);
	await storage.importClient(selected);
	expect(await storage.readClient()).toMatchObject({ clientId: "desktop" });
	await fs.writeFile(selected, JSON.stringify({ web: { client_id: "web" } }));
	await expect(storage.importClient(selected)).rejects.toMatchObject({ code: "INVALID_CLIENT" });
	expect(await storage.readClient()).toMatchObject({ clientId: "desktop" });
	expect((await fs.readdir(state.root)).some((name) => name.endsWith(".new"))).toBe(false);
});
