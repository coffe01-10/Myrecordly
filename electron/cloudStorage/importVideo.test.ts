import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "", approved: new Set<string>(), changed: vi.fn() }));
vi.mock("electron", () => ({
	app: { getAppPath: () => process.cwd(), getPath: () => state.root },
	safeStorage: {
		isEncryptionAvailable: () => true,
		encryptString: (value: string) => Buffer.from(value),
		decryptString: (value: Buffer) => value.toString(),
	},
	BrowserWindow: {
		getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: state.changed } }],
	},
	shell: { trashItem: vi.fn() },
}));
vi.mock("../appPaths", () => ({
	get USER_DATA_PATH() {
		return state.root;
	},
}));
vi.mock("../ipc/utils", () => ({
	getRecordingsDir: async () => path.join(state.root, "library"),
	getTelemetryPathForVideo: (file: string) => `${file}.cursor.json`,
	parseJsonWithByteOrderMark: JSON.parse,
	normalizeVideoSourcePath: (file: string) => file,
}));
vi.mock("../mediaServer", () => ({
	getMediaServerBaseUrl: () => "http://127.0.0.1:9999",
	buildMediaUrl: (server: string, file: string) =>
		`${server}/video?path=${encodeURIComponent(file)}`,
}));
vi.mock("../ipc/project/manager", () => ({
	rememberApprovedLocalReadPath: async (file: string) => {
		state.approved.add(file);
	},
	resolveApprovedLocalMediaPath: async (file: string) => (state.approved.has(file) ? file : null),
	isPathInsideDirectory: (file: string, root: string) => file.startsWith(`${root}${path.sep}`),
}));
vi.mock("../ipc/ffmpeg/binary", () => {
	const require = createRequire(import.meta.url);
	return {
		getFfmpegBinaryPath: () => require("ffmpeg-static"),
		getFfprobeBinaryPath: () => require("ffprobe-static").path,
	};
});
import { importCloudVideo } from "./importVideo";
import { CloudStorage, cloudRuntimePath } from "./runtime";
import { listRecordings } from "../ipc/recording/library";
import { importRecording } from "../ipc/recording/importRecording";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static") as string;
beforeEach(async () => {
	state.root = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "recordly-cloud-import-")),
	);
	await fs.mkdir(path.join(state.root, "library"));
	state.approved.clear();
	state.changed.mockClear();
});
afterEach(async () => {
	await fs.rm(state.root, { recursive: true, force: true });
});

it.skipIf(!existsSync(cloudRuntimePath()))(
	"downloads real video through the runtime, keeps same-name originals, and appends playable media",
	async () => {
		const remote = path.join(state.root, "remote");
		const configDir = path.join(state.root, "cloud-storage");
		await fs.mkdir(remote);
		await fs.mkdir(configDir);
		await fs.writeFile(
			path.join(configDir, "accounts.conf"),
			`[one]\ntype = alias\nremote = ${remote}\n[two]\ntype = alias\nremote = ${remote}\n`,
		);
		await fs.writeFile(path.join(configDir, "key.bin"), "test-password");
		await fs.writeFile(
			path.join(configDir, "accounts.json"),
			JSON.stringify([
				{
					id: "one",
					provider: "onedrive",
					name: "OneDrive",
					mode: "oauth",
					connectedAt: "",
				},
				{ id: "two", provider: "dropbox", name: "Dropbox", mode: "oauth", connectedAt: "" },
			]),
		);
		const source = path.join(remote, "clip.mp4");
		await run(
			ffmpeg,
			[
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"color=c=blue:s=160x90:r=24:d=1",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				source,
			],
			{ windowsHide: true },
		);
		const storage = new CloudStorage(() => {});
		try {
			const first = await importCloudVideo("clip.mp4", (partial) =>
				storage.copy("one", "clip.mp4", partial, false, "import-one"),
			);
			const second = await importCloudVideo("clip.mp4", (partial) =>
				storage.copy("two", "clip.mp4", partial, false, "import-two"),
			);
			expect(first.name).toBe("clip.mp4");
			expect(second.name).toBe("clip (2).mp4");
			expect((await listRecordings()).map((entry) => entry.path).sort()).toEqual(
				[first.path, second.path].sort(),
			);
			expect(await fs.readFile(first.path)).toEqual(await fs.readFile(source));
			expect(await fs.readFile(second.path)).toEqual(await fs.readFile(source));
			const sequence = await importRecording(first.path, second.path);
			expect(sequence.sourceStartMs).toBeCloseTo(1000, -1);
			expect(sequence.totalDurationMs).toBeCloseTo(2000, -1);
			// Decode across the join: ffprobe metadata alone would not catch broken video packets.
			await run(ffmpeg, ["-v", "error", "-i", sequence.path, "-f", "null", "-"], {
				windowsHide: true,
			});
			expect(state.changed).toHaveBeenCalledTimes(2);
			const pending = storage.copy(
				"one",
				"clip.mp4",
				path.join(state.root, "canceled.mp4"),
				false,
				"queued-import",
			);
			storage.cancel("queued-import");
			await expect(pending).rejects.toBeDefined();
			expect(existsSync(path.join(state.root, "canceled.mp4"))).toBe(false);
		} finally {
			await storage.close();
		}
	},
	30000,
);

it("removes interrupted bytes and reservations while preserving existing videos", async () => {
	const original = path.join(state.root, "library", "clip.mp4");
	await fs.writeFile(original, "existing");
	await expect(
		importCloudVideo("clip.mp4", async (partial) => {
			await fs.writeFile(partial, "interrupted");
			throw new Error("download canceled");
		}),
	).rejects.toThrow("download canceled");
	expect(await fs.readdir(path.dirname(original))).toEqual(["clip.mp4"]);
	expect(await fs.readFile(original, "utf8")).toBe("existing");
	expect(state.changed).not.toHaveBeenCalled();
});
