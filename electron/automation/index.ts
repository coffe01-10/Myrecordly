import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { BrowserWindow, ipcMain, app } from "electron";
import type {
	Edit,
	EditTaskOptions,
	EditTaskResult,
	ProjectSnapshot,
	RenderOptions,
	ToolArguments,
} from "../../packages/automation/src/types";
import type { RenderSnapshot } from "../../src/automation/renderTypes";
import { startAutomationBridge } from "./bridge";
import { createAutomationTransport } from "./rendererTransport";
import { AutomationJobs } from "./jobs";
import { probeAutomationMedia, extractAutomationFrames } from "./media";
import { analyzeSmartCut } from "../ipc/smartCut";
import { generateAutoCaptionsFromVideo } from "../ipc/captions/generate";
import { getWhisperSmallModelStatus } from "../ipc/captions/whisper";
import { hasProjectFileExtension, loadProjectFromPath } from "../ipc/project/manager";
import { writeProjectFileAtomically } from "../ipc/project/atomicSave";
import { approveUserPath } from "../ipc/utils";
import { ensurePackagedRendererServer } from "../rendererServer";
import { VideoIndexLibrary } from "./videoIndex";
import { planVideoTask } from "./editTask";
import type { SmartCutCandidate } from "../../src/components/video-editor/smartCut/smartCutPlan";

export async function startRecordlyAutomation(options: {
	getEditor: () => BrowserWindow;
	rendererDir: string;
	preloadPath: string;
	devUrl?: string;
}) {
	const transport = createAutomationTransport();
	const jobs = new AutomationJobs();
	const library = new VideoIndexLibrary(path.join(app.getPath("userData"), "video-index"));
	const workers = new Set<BrowserWindow>();
	let editorQueue: Promise<unknown> = Promise.resolve();
	const enqueue = <T>(run: () => Promise<T>) => {
		const result = editorQueue.then(run);
		editorQueue = result.catch(() => undefined);
		return result;
	};
	const send = <T>(command: string, args: Record<string, unknown> = {}) =>
		transport.send<T>(options.getEditor().webContents, command, args);
	const source = async (requested?: unknown) => {
		const selected = requested ?? (await send<ProjectSnapshot>("get_project")).sourcePath;
		if (typeof selected !== "string" || !selected.trim())
			throw new Error("Open a project or provide a video path first");
		const file = path.resolve(selected);
		await fs.access(file);
		approveUserPath(file);
		return file;
	};
	const requirePath = (value: unknown) => {
		if (typeof value !== "string" || !value.trim()) throw new Error("A file path is required");
		return path.resolve(value);
	};
	async function render(
		snapshot: RenderSnapshot,
		args: RenderOptions & { startMs?: number; endMs?: number },
		signal: AbortSignal,
		progress: (value: number) => void,
	) {
		signal.throwIfAborted();
		const outputPath = requirePath(args.outputPath);
		if (path.extname(outputPath).toLowerCase() !== ".mp4")
			throw new Error("Export output must end in .mp4");
		const sameFile = (file: string) =>
			process.platform === "win32"
				? path.resolve(file).toLowerCase() === outputPath.toLowerCase()
				: path.resolve(file) === outputPath;
		const editor = snapshot.editor;
		const protectedPaths = [
			snapshot.sourcePath,
			snapshot.projectPath,
			(editor.webcam as { sourcePath?: string } | undefined)?.sourcePath,
			...((editor.audioRegions as { audioPath: string }[]) ?? []).map(
				(region) => region.audioPath,
			),
			...snapshot.sourceAudioFallbackPaths,
		];
		if (protectedPaths.some((file) => file && sameFile(file)))
			throw new Error("Export cannot replace project source media");
		for (const [label, value] of [
			["width", args.width],
			["height", args.height],
		] as const)
			if (
				value !== undefined &&
				(!Number.isInteger(value) || value < 2 || value > 8192 || value % 2)
			)
				throw new Error(`${label} must be an even integer between 2 and 8192`);
		if (args.fps !== undefined && ![24, 30, 60].includes(args.fps))
			throw new Error("fps must be 24, 30 or 60");
		await fs.mkdir(path.dirname(outputPath), { recursive: true });
		// Reserve a new output so accidental filename reuse cannot overwrite an existing video.
		if (!args.overwrite) {
			const handle = await fs.open(outputPath, "wx");
			await handle.close();
		}
		let finished = false;
		const worker = new BrowserWindow({
			show: false,
			width: 1280,
			height: 720,
			webPreferences: {
				preload: options.preloadPath,
				contextIsolation: true,
				nodeIntegration: false,
				backgroundThrottling: false,
				webSecurity: false,
			},
		});
		workers.add(worker);
		const onProgress = (event: Electron.IpcMainEvent, value: { percentage?: number }) => {
			if (event.sender === worker.webContents && typeof value?.percentage === "number")
				progress(value.percentage);
		};
		ipcMain.on("automation:progress", onProgress);
		const cancel = () => {
			void transport.send(worker.webContents, "cancel").catch(() => undefined);
		};
		signal.addEventListener("abort", cancel, { once: true });
		try {
			const baseUrl =
				options.devUrl ?? (await ensurePackagedRendererServer(options.rendererDir));
			await worker.loadURL(new URL("/automation-render.html", baseUrl).href);
			signal.throwIfAborted();
			const result = await transport.send(worker.webContents, "render", {
				...args,
				outputPath,
				snapshot,
			});
			signal.throwIfAborted();
			finished = true;
			return result;
		} finally {
			signal.removeEventListener("abort", cancel);
			ipcMain.removeListener("automation:progress", onProgress);
			workers.delete(worker);
			if (!worker.isDestroyed()) worker.destroy();
			if (!finished && !args.overwrite) await fs.rm(outputPath, { force: true });
		}
	}

	async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
		switch (name) {
			case "index_video": {
				const file = await source(args.path);
				return jobs.start("index", (signal, progress) =>
					library.build(file, args as ToolArguments["index_video"], signal, progress),
				);
			}
			case "get_video_index":
				return library.get(args as unknown as ToolArguments["get_video_index"]);
			case "get_storyboard":
				return library.storyboard(args as unknown as ToolArguments["get_storyboard"]);
			case "search_video":
				return library.search(args as unknown as ToolArguments["search_video"]);
			case "inspect_segment":
				return library.inspect(args as unknown as ToolArguments["inspect_segment"]);
			case "annotate_video":
				return library.annotate(args as unknown as ToolArguments["annotate_video"]);
			case "run_edit_task": {
				const task = args as unknown as EditTaskOptions;
				return jobs.start(
					"edit_task",
					async (signal, progress): Promise<EditTaskResult> => {
						const index = await library.load(task.indexId);
						const active = await enqueue(() => send<ProjectSnapshot>("get_project"));
						if (active.sourcePath !== index.path)
							throw new Error(
								"Open the indexed source project before running this edit task",
							);
						const plan = await planVideoTask(index, active, task, signal, {
							projectEdits: (edits) =>
								enqueue(() => send<ProjectSnapshot>("plan_edits", { edits })),
							pauseEdits: async () => {
								const result = await enqueue(() =>
									send<{ candidates: SmartCutCandidate[] }>(
										"analyze_candidates",
										{
											sourcePath: index.path,
											analysis: {
												intervals: index.silences,
												hasAudio: index.hasAudio,
												durationMs: index.durationMs,
											},
										},
									),
								);
								return result.candidates
									.filter((candidate) => candidate.action === "delete")
									.sort((a, b) => b.startMs - a.startMs)
									.map(
										(candidate): Edit => ({
											type: "delete",
											timeBase: "timeline",
											startMs: candidate.startMs,
											endMs: candidate.endMs,
										}),
									);
							},
						});
						progress(25);
						signal.throwIfAborted();
						const captured = await enqueue(async () => {
							const project = plan.edits.length
								? await send<ProjectSnapshot>("apply_edits", {
										expectedRevision: active.revision,
										edits: plan.edits,
									})
								: active;
							const context = await send<RenderSnapshot>("render_snapshot");
							return { project, snapshot: { ...context, ...project } };
						});
						const snapshot = captured.snapshot;
						const result: EditTaskResult = {
							goal: task.goal,
							...plan,
							project: captured.project,
						};
						if (task.projectPath) {
							const target = requirePath(task.projectPath);
							if (path.extname(target).toLowerCase() !== ".recordly")
								throw new Error("Project filename must end in .recordly");
							await fs.mkdir(path.dirname(target), { recursive: true });
							const data = {
								version: 2,
								projectId: snapshot.projectId ?? randomUUID(),
								videoPath: snapshot.sourcePath,
								editor: snapshot.editor,
							};
							await fs.writeFile(target, JSON.stringify(data, null, 2), {
								flag: target === snapshot.projectPath ? "w" : "wx",
							});
							await enqueue(() =>
								send("mark_saved", { path: target, project: data }),
							);
							result.savedPath = target;
						}
						progress(35);
						if (task.previewPath && snapshot.durationMs > 0)
							result.preview = await render(
								snapshot,
								{
									outputPath: task.previewPath,
									startMs: 0,
									endMs: Math.min(8000, snapshot.durationMs),
									width: 960,
									height: 540,
									fps: 30,
								},
								signal,
								(value) => progress(35 + value * 0.25),
							);
						if (task.outputPath)
							result.export = await render(
								snapshot,
								{ outputPath: task.outputPath },
								signal,
								(value) => progress(60 + value * 0.39),
							);
						return result;
					},
				);
			}
			case "get_project":
			case "apply_edits":
			case "undo":
			case "redo":
			case "list_recordings":
			case "list_projects":
			case "playback":
				return send(name, args);
			case "open_project": {
				const file = requirePath(args.path);
				let knownSourceDurationMs = 0;
				let project: unknown;
				let projectPath: string | null = null;
				if (hasProjectFileExtension(file)) {
					const loaded = await loadProjectFromPath(file);
					if (!loaded.success || !("project" in loaded))
						throw new Error(loaded.message ?? "Could not open project");
					project = loaded.project;
					projectPath = file;
				} else {
					const metadata = await probeAutomationMedia(file);
					approveUserPath(await fs.realpath(file).catch(() => file));
					knownSourceDurationMs = metadata.durationMs;
					project = {
						version: 2,
						videoPath: file,
						editor: {
							clipRegions: [
								{
									id: "clip-1",
									startMs: 0,
									endMs: metadata.durationMs,
									sourceStartMs: 0,
									speed: 1,
								},
							],
						},
					};
				}
				await send("open", { project, path: projectPath });
				const deadline = Date.now() + 60_000;
				while (Date.now() < deadline) {
					const snapshot = await send<ProjectSnapshot>("get_project");
					if (snapshot.error) throw new Error(snapshot.error);
					if (
						snapshot.ready &&
						(snapshot.sourceDurationMs > 0 || knownSourceDurationMs <= 0)
					)
						return {
							...snapshot,
							sourceDurationMs: snapshot.sourceDurationMs || knownSourceDurationMs,
						};
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				throw new Error("Video did not become ready within 60 seconds");
			}
			case "save_project": {
				const snapshot = await send<ProjectSnapshot>("get_project");
				if (!snapshot.sourcePath) throw new Error("No project is open");
				const target = requirePath(args.path ?? snapshot.projectPath);
				if (path.extname(target).toLowerCase() !== ".recordly")
					throw new Error("Project filename must end in .recordly");
				if (target !== snapshot.projectPath && !args.overwrite) {
					try {
						await fs.access(target);
						throw new Error(
							"Project already exists. Pass overwrite: true to replace it",
						);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					}
				}
				const projectId = snapshot.projectId ?? randomUUID();
				const project = {
					version: 2,
					projectId,
					videoPath: snapshot.sourcePath,
					editor: snapshot.editor,
				};
				await writeProjectFileAtomically(target, JSON.stringify(project, null, 2));
				return send("mark_saved", { path: target, project });
			}
			case "analyze_media": {
				const file = await source(args.path);
				return jobs.start("analysis", async (signal) => {
					const [analysis, metadata] = await Promise.all([
						analyzeSmartCut(file, signal),
						probeAutomationMedia(file, signal),
					]);
					signal.throwIfAborted();
					const activity = await send<{ revision?: number; candidates: unknown[] }>(
						"analyze_candidates",
						{ sourcePath: file, analysis },
					);
					return {
						path: file,
						timeBase: "source",
						...metadata,
						...analysis,
						...activity,
						candidateTimeBase: "timeline",
					};
				});
			}
			case "transcribe_media": {
				const file = await source(args.path);
				return jobs.start("transcription", async (signal) => {
					const model =
						typeof args.modelPath === "string"
							? args.modelPath
							: (await getWhisperSmallModelStatus()).path;
					if (!model)
						throw new Error(
							"Whisper model is not installed. Download it in Recordly Settings or provide modelPath. Other tools remain available.",
						);
					const result = await generateAutoCaptionsFromVideo({
						videoPath: file,
						whisperModelPath: model,
						whisperExecutablePath: args.executablePath as string | undefined,
						language: args.language as string | undefined,
						signal,
					});
					return { path: file, timeBase: "source", ...result };
				});
			}
			case "get_frames":
				return extractAutomationFrames(
					await source(args.path),
					args.timesMs as number[],
					args.width as number | undefined,
				);
			case "render_preview":
			case "export_video": {
				const snapshot = await send<RenderSnapshot>("render_snapshot");
				const renderArgs = args as unknown as RenderOptions & {
					startMs?: number;
					endMs?: number;
				};
				if (
					name === "render_preview" &&
					(!Number.isFinite(renderArgs.startMs) || !Number.isFinite(renderArgs.endMs))
				)
					throw new Error("Preview requires startMs and endMs in timeline time");
				requirePath(renderArgs.outputPath);
				return jobs.start(
					name === "render_preview" ? "preview" : "export",
					(signal, progress) => render(snapshot, renderArgs, signal, progress),
				);
			}
			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	}
	const connectionFile = path.resolve(
		process.env.RECORDLY_CONNECTION_FILE ??
			path.join(app.getPath("userData"), "automation.json"),
	);
	const bridge = await startAutomationBridge(connectionFile, async (name, args) => {
		if (name === "get_job") return jobs.get(String(args.jobId));
		if (name === "cancel_job") return jobs.cancel(String(args.jobId));
		if (["get_video_index", "get_storyboard", "search_video", "inspect_segment"].includes(name))
			return call(name, args);
		// Order mutations and snapshots so two agents cannot interleave half an edit batch.
		return enqueue(() => call(name, args));
	});
	return {
		connectionFile,
		async close() {
			await jobs.close();
			for (const worker of workers) if (!worker.isDestroyed()) worker.destroy();
			transport.dispose();
			await bridge.close();
		},
	};
}
