import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ root: "", appPath: process.cwd() }));
vi.mock("electron", () => ({
	app: { getAppPath: () => fixture.appPath },
	safeStorage: {
		isEncryptionAvailable: () => true,
		encryptString: (value: string) => Buffer.from(value),
		decryptString: (value: Buffer) => value.toString(),
	},
}));
vi.mock("../appPaths", () => ({
	get USER_DATA_PATH() {
		return fixture.root;
	},
}));
import { CloudStorage, cloudRuntimePath } from "./runtime";
const run = promisify(execFile);
beforeEach(async () => {
	fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-cloud-storage-"));
	fixture.appPath = process.cwd();
});
afterEach(async () => {
	await fs.rm(fixture.root, { recursive: true, force: true });
});

it("reuses website sessions, creates another only on request, and saves only after opening", async () => {
	const storage = new CloudStorage(() => {});
	const first = await storage.connectWeb("baidu", async () => {});
	expect((await storage.connectWeb("baidu", async () => {})).id).toBe(first.id);
	const second = await storage.connectWeb("baidu", async () => {}, true);
	await expect(
		storage.connectWeb("quark", async () => {
			throw new Error("ERR_FAILED");
		}),
	).rejects.toThrow("ERR_FAILED");
	expect((await storage.state()).accounts).toHaveLength(2);
	expect(first.id).not.toBe(second.id);
	await storage.rename(first.id, "工作资料");
	await storage.remove(second.id);
	const reopened = new CloudStorage(() => {});
	expect((await reopened.state()).accounts).toEqual([{ ...first, name: "工作资料" }]);
});

it("clears authorizing after a missing runtime so another provider can still be added", async () => {
	fixture.appPath = path.join(fixture.root, "no-runtime");
	const storage = new CloudStorage(() => {});
	await expect(storage.connect("dropbox")).rejects.toBeDefined();
	expect((await storage.state()).authorizing).toBeUndefined();
	expect((await storage.connectWeb("quark", async () => {})).mode).toBe("web");
});

it.skipIf(!existsSync(cloudRuntimePath()))(
	"uses the real runtime with encrypted config for listing, uploading and account removal",
	async () => {
		const directory = path.join(fixture.root, "cloud-storage"),
			remote = path.join(fixture.root, "remote");
		await fs.mkdir(directory);
		await fs.mkdir(remote);
		const config = path.join(directory, "accounts.conf");
		const password = "local-fixture-password";
		await fs.writeFile(config, `[fixture]\ntype = alias\nremote = ${remote}\n`);
		await fs.writeFile(path.join(directory, "key.bin"), password);
		await fs.writeFile(
			path.join(directory, "accounts.json"),
			JSON.stringify([
				{
					id: "fixture",
					provider: "dropbox",
					mode: "oauth",
					name: "Fixture",
					connectedAt: "",
				},
			]),
		);
		await new Promise<void>((resolve, reject) => {
			const child = execFile(
				cloudRuntimePath(),
				["config", "encryption", "set", "--config", config],
				{ windowsHide: true },
				(error) => (error ? reject(error) : resolve()),
			);
			child.stdin!.end(`${password}\n${password}\n`);
		});
		await fs.writeFile(path.join(remote, "existing.txt"), "previous");
		const local = path.join(fixture.root, "new.txt");
		await fs.writeFile(local, "new content");
		const storage = new CloudStorage(() => {});
		expect((await storage.list("fixture", "")).map((file) => file.Name)).toEqual([
			"existing.txt",
		]);
		await storage.copy("fixture", "nested/new.txt", local, true);
		expect(await fs.readFile(path.join(remote, "nested/new.txt"), "utf8")).toBe("new content");
		await storage.copy("fixture", "existing.txt", local, true);
		expect(await fs.readFile(path.join(remote, "existing.txt"), "utf8")).toBe("new content");
		expect(await fs.readFile(config, "utf8")).toContain("RCLONE_ENCRYPT_V0");
		await storage.remove("fixture");
		const remotes = await run(cloudRuntimePath(), ["listremotes", "--config", config], {
			env: { ...process.env, RCLONE_CONFIG_PASS: password },
			windowsHide: true,
		});
		expect(remotes.stdout.trim()).toBe("");
	},
);
