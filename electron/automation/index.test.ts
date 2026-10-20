import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectSnapshot } from "../../packages/automation/src/types";

const state = vi.hoisted(() => ({ root: "", send: vi.fn(), load: vi.fn() }));
vi.mock("electron", () => ({
	app: { getPath: () => state.root },
	BrowserWindow: vi.fn(),
	ipcMain: {},
}));
vi.mock("./bridge", () => ({ startAutomationBridge: vi.fn(async () => ({ close: vi.fn() })) }));
vi.mock("./rendererTransport", () => ({
	createAutomationTransport: () => ({ send: state.send, dispose: vi.fn() }),
}));
vi.mock("./videoIndex", () => ({
	VideoIndexLibrary: class {
		load = state.load;
	},
}));
vi.mock("./editTask", () => ({ planVideoTask: vi.fn() }));
vi.mock("./media", () => ({ probeAutomationMedia: vi.fn(), extractAutomationFrames: vi.fn() }));
vi.mock("../ipc/smartCut", () => ({ analyzeSmartCut: vi.fn() }));
vi.mock("../ipc/captions/generate", () => ({ generateAutoCaptionsFromVideo: vi.fn() }));
vi.mock("../ipc/captions/whisper", () => ({ getWhisperSmallModelStatus: vi.fn() }));
vi.mock("../ipc/project/manager", () => ({
	hasProjectFileExtension: vi.fn(),
	loadProjectFromPath: vi.fn(),
}));
vi.mock("../ipc/utils", () => ({ approveUserPath: vi.fn() }));
vi.mock("../rendererServer", () => ({ ensurePackagedRendererServer: vi.fn() }));
import { startRecordlyAutomation } from "./index";
import { startAutomationBridge } from "./bridge";
import { planVideoTask } from "./editTask";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const plan = {
	edits: [{ type: "split" as const, atMs: 1000 }],
	planner: "explicit" as const,
	notes: [],
};
let automation: Awaited<ReturnType<typeof startRecordlyAutomation>>;
let call: Parameters<typeof startAutomationBridge>[1];
let snapshot: ProjectSnapshot;

beforeEach(async () => {
	vi.clearAllMocks();
	state.root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-edit-task-"));
	snapshot = {
		revision: 1,
		projectId: "project",
		sourcePath: path.join(state.root, "video.mp4"),
		projectPath: path.join(state.root, "edit.recordly"),
		sourceDurationMs: 6000,
		durationMs: 6000,
		ready: true,
		error: null,
		canUndo: false,
		canRedo: false,
		clips: [],
		editor: {},
	};
	state.load.mockResolvedValue({ id: "v", path: snapshot.sourcePath });
	state.send.mockImplementation(async () => snapshot);
	vi.mocked(planVideoTask).mockResolvedValue(plan);
	automation = await startRecordlyAutomation({
		getEditor: () => ({ webContents: {} }) as never,
		rendererDir: "",
		preloadPath: "",
	});
	call = vi.mocked(startAutomationBridge).mock.calls.at(-1)![1];
});

afterEach(async () => {
	await automation.close();
	vi.restoreAllMocks();
	await fs.rm(state.root, { recursive: true, force: true });
});

it("does not apply edits canceled while waiting for another editor command", async () => {
	const planning = deferred<Awaited<ReturnType<typeof planVideoTask>>>();
	const entered = deferred<void>(),
		release = deferred<void>();
	vi.mocked(planVideoTask).mockReturnValueOnce(planning.promise);
	state.send.mockImplementation(async (_contents, command) => {
		if (command === "playback") {
			entered.resolve();
			await release.promise;
		}
		return snapshot;
	});
	const { jobId } = (await call("run_edit_task", { indexId: "v", goal: "剪辑" })) as {
		jobId: string;
	};
	await vi.waitFor(() => expect(planVideoTask).toHaveBeenCalled());
	const playback = call("playback", {});
	try {
		await entered.promise;
		planning.resolve(plan);
		await vi.waitFor(async () =>
			expect(await call("get_job", { jobId })).toMatchObject({ progress: 25 }),
		);
		expect(await call("cancel_job", { jobId })).toMatchObject({ status: "canceled" });
	} finally {
		planning.resolve(plan);
		release.resolve();
		await playback;
		await call("get_project", {});
	}
	expect(state.send.mock.calls.map(([, command]) => command)).not.toContain("apply_edits");
});

it("preserves the previous project when an edit task saves over the active file", async () => {
	const original = JSON.stringify({ version: 2, editor: { previous: true } });
	await fs.writeFile(snapshot.projectPath!, original);
	const { jobId } = (await call("run_edit_task", {
		indexId: "v",
		goal: "剪辑并保存",
		projectPath: snapshot.projectPath,
	})) as { jobId: string };
	await vi.waitFor(async () =>
		expect(await call("get_job", { jobId })).toMatchObject({ status: "completed" }),
	);
	expect(JSON.parse(await fs.readFile(snapshot.projectPath!, "utf8"))).toMatchObject({
		projectId: "project",
		videoPath: snapshot.sourcePath,
	});
	expect(await fs.readFile(`${snapshot.projectPath}.bak`, "utf8")).toBe(original);
});

