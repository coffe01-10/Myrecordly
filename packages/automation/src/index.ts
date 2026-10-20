import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { ConnectionInfo, Job, ToolArguments, ToolName, ToolResults } from "./types.js";
export type * from "./types.js";

export function defaultConnectionFile(): string {
	const base =
		process.platform === "win32"
			? (process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"))
			: process.platform === "darwin"
				? path.join(homedir(), "Library", "Application Support")
				: (process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"));
	return path.join(base, "Recordly", "automation.json");
}

export class RecordlyClient {
	constructor(readonly options: { connectionFile?: string; timeoutMs?: number } = {}) {}

	async call<N extends ToolName>(name: N, args: ToolArguments[N]): Promise<ToolResults[N]> {
		const connectionFile =
			this.options.connectionFile ??
			process.env.RECORDLY_CONNECTION_FILE ??
			defaultConnectionFile();
		let connection: ConnectionInfo;
		try {
			connection = JSON.parse(await readFile(connectionFile, "utf8"));
		} catch {
			throw new Error(
				`Recordly automation is not running. Start Recordly with --automation or use recordly start. Connection: ${connectionFile}`,
			);
		}
		// The discovery file grants local editing access; never forward its token to a remote host.
		const url = new URL(connection.url);
		if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
			throw new Error("Recordly connection must use local loopback HTTP");
		const response = await fetch(new URL("/call", url), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${connection.token}`,
			},
			body: JSON.stringify({ name, args }),
			signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
		});
		const body = (await response.json()) as { result?: ToolResults[N]; error?: string };
		if (!response.ok || body.error)
			throw new Error(body.error ?? `Recordly request failed (${response.status})`);
		return body.result as ToolResults[N];
	}

	listRecordings() {
		return this.call("list_recordings", {});
	}
	indexVideo(options: ToolArguments["index_video"] = {}) {
		return this.call("index_video", options);
	}
	getVideoIndex(options: ToolArguments["get_video_index"]) {
		return this.call("get_video_index", options);
	}
	getStoryboard(options: ToolArguments["get_storyboard"]) {
		return this.call("get_storyboard", options);
	}
	searchVideo(options: ToolArguments["search_video"]) {
		return this.call("search_video", options);
	}
	inspectSegment(options: ToolArguments["inspect_segment"]) {
		return this.call("inspect_segment", options);
	}
	annotateVideo(options: ToolArguments["annotate_video"]) {
		return this.call("annotate_video", options);
	}
	runEditTask(options: ToolArguments["run_edit_task"]) {
		return this.call("run_edit_task", options);
	}
	listProjects() {
		return this.call("list_projects", {});
	}
	playback(action: ToolArguments["playback"]["action"], timeMs?: number) {
		return this.call("playback", { action, ...(timeMs === undefined ? {} : { timeMs }) });
	}
	getProject() {
		return this.call("get_project", {});
	}
	openProject(filePath: string) {
		return this.call("open_project", { path: filePath });
	}
	saveProject(options: ToolArguments["save_project"] = {}) {
		return this.call("save_project", options);
	}
	applyEdits(edits: ToolArguments["apply_edits"]["edits"], expectedRevision: number) {
		return this.call("apply_edits", { edits, expectedRevision });
	}
	undo() {
		return this.call("undo", {});
	}
	redo() {
		return this.call("redo", {});
	}
	analyzeMedia(options: ToolArguments["analyze_media"] = {}) {
		return this.call("analyze_media", options);
	}
	transcribeMedia(options: ToolArguments["transcribe_media"] = {}) {
		return this.call("transcribe_media", options);
	}
	getFrames(options: ToolArguments["get_frames"]) {
		return this.call("get_frames", options);
	}
	renderPreview(options: ToolArguments["render_preview"]) {
		return this.call("render_preview", options);
	}
	exportVideo(options: ToolArguments["export_video"]) {
		return this.call("export_video", options);
	}
	getJob(jobId: string) {
		return this.call("get_job", { jobId });
	}
	cancelJob(jobId: string) {
		return this.call("cancel_job", { jobId });
	}

	async waitForJob<T = unknown>(
		jobId: string,
		options: { signal?: AbortSignal; onProgress?: (job: Job<T>) => void; pollMs?: number } = {},
	): Promise<Job<T> & { result: T }> {
		for (;;) {
			options.signal?.throwIfAborted();
			const job = (await this.getJob(jobId)) as Job<T>;
			options.onProgress?.(job);
			if (job.status === "completed") return job as Job<T> & { result: T };
			if (job.status === "failed" || job.status === "canceled")
				throw new Error(job.error ?? `Job ${job.status}`);
			await new Promise<void>((resolve, reject) => {
				const abort = () => {
					clearTimeout(timer);
					reject(options.signal?.reason ?? new Error("Aborted"));
				};
				const timer = setTimeout(() => {
					options.signal?.removeEventListener("abort", abort);
					resolve();
				}, options.pollMs ?? 500);
				options.signal?.addEventListener("abort", abort, { once: true });
			});
		}
	}

	/** Starts a dedicated automation instance. The caller owns this child process. */
	static async launch(options: {
		executable: string;
		appPath?: string;
		userDataDir?: string;
		connectionFile: string;
		timeoutMs?: number;
		onLog?: (text: string) => void;
		detached?: boolean;
	}): Promise<{ client: RecordlyClient; process: ChildProcess }> {
		const child = spawn(
			options.executable,
			[
				...(options.appPath ? [options.appPath] : []),
				"--automation",
				...(options.userDataDir ? [`--user-data-dir=${options.userDataDir}`] : []),
			],
			{
				windowsHide: true,
				stdio: options.onLog ? ["ignore", "pipe", "pipe"] : "ignore",
				// Windows closes an attached child when `recordly start` exits.
				detached: options.detached,
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: undefined,
					RECORDLY_AUTOMATION: "1",
					RECORDLY_CONNECTION_FILE: path.resolve(options.connectionFile),
					RECORDLY_AUTOMATION_USER_DATA: options.userDataDir,
				},
			},
		);
		child.stdout?.on("data", (data) => options.onLog?.(String(data)));
		child.stderr?.on("data", (data) => options.onLog?.(String(data)));
		let spawnError: Error | undefined;
		child.on("error", (error) => {
			spawnError = error;
		});
		const client = new RecordlyClient({ connectionFile: options.connectionFile });
		const deadline = Date.now() + (options.timeoutMs ?? 60_000);
		let lastError: unknown;
		while (Date.now() < deadline) {
			if (spawnError) throw spawnError;
			if (child.exitCode !== null || child.signalCode !== null)
				throw new Error(
					`Recordly exited during startup (${child.exitCode ?? child.signalCode}). If another desktop instance is already running, restart it with --automation or use a separate userDataDir / --user-data.`,
				);
			try {
				const connection = JSON.parse(
					await readFile(options.connectionFile, "utf8"),
				) as ConnectionInfo;
				if (connection.pid === child.pid) {
					await client.getProject();
					return { client, process: child };
				}
			} catch (error) {
				lastError = error;
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		child.kill();
		throw new Error(`Recordly startup timed out: ${String(lastError ?? "No connection file")}`);
	}
}
