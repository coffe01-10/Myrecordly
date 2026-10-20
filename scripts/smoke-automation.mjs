import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = process.cwd();
const automationPackage = path.resolve(
	process.env.RECORDLY_TEST_AUTOMATION_PACKAGE ?? path.join(root, "packages/automation"),
);
const { RecordlyClient } = await import(
	pathToFileURL(path.join(automationPackage, "dist/index.js")).href
);
const require = createRequire(import.meta.url);
const exec = promisify(execFile);
const ffmpeg = require("ffmpeg-static");
const ffprobe = require("ffprobe-static").path;
const temporaryRoot = path.resolve(root, ".tmp");
await mkdir(temporaryRoot, { recursive: true });
const directory = await mkdtemp(path.join(temporaryRoot, "automation-smoke-"));
const connectionFile = path.join(directory, "automation.json");
let child;
let mcp;
let modelServer;
const originalVisionEnv = Object.fromEntries(
	["RECORDLY_VISION_BASE_URL", "RECORDLY_VISION_MODEL", "RECORDLY_VISION_API_KEY"].map((key) => [
		key,
		process.env[key],
	]),
);
let logs = "";
const log = (text) => {
	logs = (logs + text).slice(-30_000);
};
const note = (text) => process.stdout.write(`[automation-smoke] ${text}\n`);
const exists = async (file) => {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
};
const probe = async (file) =>
	JSON.parse(
		(
			await exec(
				ffprobe,
				[
					"-v",
					"error",
					"-show_entries",
					"format=duration:stream=codec_type,width,height",
					"-of",
					"json",
					file,
				],
				{ windowsHide: true },
			)
		).stdout,
	);
async function cli(name, args = {}, wait = false) {
	const argumentFile = path.join(directory, "arguments.json");
	await writeFile(argumentFile, JSON.stringify(args));
	try {
		const result = await exec(
			process.execPath,
			[
				path.join(automationPackage, "dist/cli.js"),
				name,
				"--connection",
				connectionFile,
				"--file",
				argumentFile,
				...(wait ? ["--wait"] : []),
			],
			{ cwd: root, windowsHide: true, timeout: 120_000 },
		);
		return JSON.parse(result.stdout);
	} finally {
		await rm(argumentFile, { force: true });
	}
}
async function whitePixels(file, time, crop) {
	const { stdout } = await exec(
		ffmpeg,
		[
			"-v",
			"error",
			"-ss",
			String(time),
			"-i",
			file,
			"-vf",
			crop,
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		],
		{ encoding: "buffer", windowsHide: true },
	);
	let count = 0;
	for (let i = 0; i < stdout.length; i += 3)
		if (stdout[i] > 200 && stdout[i + 1] > 200 && stdout[i + 2] > 200) count++;
	return count;
}
async function pixel(file, time) {
	const result = await exec(
		ffmpeg,
		[
			"-v",
			"error",
			"-ss",
			String(time),
			"-i",
			file,
			"-vf",
			"crop=2:2:iw/2:ih/2,scale=1:1",
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		],
		{ encoding: "buffer", windowsHide: true },
	);
	return [...result.stdout];
}
try {
	// This deterministic local server verifies provider wiring; it is not a vision-quality test.
	modelServer = createServer(async (request, response) => {
		let raw = "";
		for await (const chunk of request) raw += chunk;
		const body = JSON.parse(raw);
		const content = body.messages[1].content;
		let answer;
		if (content.some((part) => part.type === "image_url")) {
			assert(
				content
					.filter((part) => part.type === "image_url")
					.every((part) => part.image_url.url.startsWith("data:image/jpeg;base64,")),
			);
			answer = { description: "测试模型返回的画面描述", keywords: ["provider-fixture"] };
		} else {
			const prompt = JSON.parse(content[0].text);
			answer =
				prompt.task === "search"
					? {
							matches: [
								{
									segmentId: prompt.segments[prompt.segments.length - 1].id,
									reason: "Deterministic semantic-search fixture",
								},
							],
						}
					: { keepSegmentIds: [prompt.segments[prompt.segments.length - 1].id] };
		}
		response.setHeader("Content-Type", "application/json");
		response.end(
			JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
		);
	});
	await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
	process.env.RECORDLY_VISION_BASE_URL = `http://127.0.0.1:${modelServer.address().port}/v1`;
	process.env.RECORDLY_VISION_MODEL = "recordly-test-fixture";
	process.env.RECORDLY_VISION_API_KEY = "smoke-key";
	const input = path.join(directory, "three-colors.mp4");
	await exec(
		ffmpeg,
		[
			"-v",
			"error",
			"-y",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=320x180:r=30:d=2",
			"-f",
			"lavfi",
			"-i",
			"color=c=green:s=320x180:r=30:d=2",
			"-f",
			"lavfi",
			"-i",
			"color=c=blue:s=320x180:r=30:d=2",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=48000:duration=6",
			"-filter_complex",
			"[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[3:a]volume=0:enable='between(t,1.9,4.1)'[a]",
			"-map",
			"[v]",
			"-map",
			"[a]",
			"-c:v",
			"libx264",
			"-preset",
			"ultrafast",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			input,
		],
		{ windowsHide: true },
	);
	await writeFile(
		`${input}.cursor.json`,
		JSON.stringify({
			version: 1,
			samples: [
				{ timeMs: 0, cx: 0.3, cy: 0.4, interactionType: "move" },
				{ timeMs: 2000, cx: 0.3, cy: 0.4, interactionType: "move" },
				{ timeMs: 4000, cx: 0.3, cy: 0.4, interactionType: "move" },
				{ timeMs: 4500, cx: 0.7, cy: 0.6, interactionType: "click" },
				{ timeMs: 6000, cx: 0.7, cy: 0.6, interactionType: "move" },
			],
		}),
	);
	note("Starting isolated Electron automation instance");
	const executable =
		process.env.RECORDLY_TEST_EXECUTABLE ??
		path.join(root, "node_modules/electron/dist/electron.exe");
	const running = await RecordlyClient.launch({
		executable,
		appPath: process.env.RECORDLY_TEST_EXECUTABLE ? undefined : root,
		connectionFile,
		userDataDir: path.join(directory, "user-data"),
		onLog: log,
	});
	child = running.process;
	const sdk = running.client;
	const original = await sdk.openProject(input);
	assert(original.ready);
	assert(Math.abs(original.durationMs - 6000) < 100);
	assert.equal((await cli("get_project")).revision, original.revision);
	note("SDK launch/open and CLI project read passed");
	const invalid = [
		{ type: "split", atMs: 1000 },
		{ type: "delete", timeBase: "source", startMs: 7000, endMs: 8000 },
	];
	await assert.rejects(sdk.applyEdits(invalid, original.revision));
	assert.equal((await sdk.getProject()).clips.length, 1);
	const edits = [
		{ type: "delete", timeBase: "source", startMs: 2000, endMs: 4000 },
		{ type: "speed", timeBase: "source", startMs: 4000, endMs: 6000, speed: 2 },
		{ type: "caption", startMs: 0, endMs: 1800, text: "真实字幕测试 / Real caption" },
		{ type: "zoom", startMs: 0, endMs: 1200, depth: 2, cx: 0.5, cy: 0.5 },
		{ type: "text", startMs: 0, endMs: 1800, text: "Recordly Automation", x: 50, y: 20 },
	];
	const edited = await sdk.applyEdits(edits, original.revision);
	assert.equal(edited.durationMs, 3000);
	assert.equal(edited.clips.length, 2);
	await assert.rejects(
		sdk.applyEdits([{ type: "split", atMs: 500 }], original.revision),
		/revision|changed/,
	);
	const undone = await cli("undo");
	assert.equal(undone.clips.length, 1);
	assert.equal(undone.editor.autoCaptions.length, 0);
	assert.equal(undone.editor.autoCaptionSettings.enabled, false);
	const redone = await cli("redo");
	assert.equal(redone.durationMs, 3000);
	assert.equal(redone.editor.autoCaptions.length, 1);
	note("Atomic edits, stale revision protection and one-step CLI undo/redo passed");
	const analysis = await sdk.analyzeMedia();
	const analyzed = await sdk.waitForJob(analysis.jobId);
	assert(analyzed.result.hasAudio);
	assert(analyzed.result.intervals.some((item) => item.startMs > 1800 && item.endMs < 4300));
	const frames = await sdk.getFrames({ timesMs: [500, 4500] });
	assert.equal(frames.frames.length, 2);
	assert(Buffer.from(frames.frames[0].data, "base64").length > 500);
	const missingModel = await sdk.transcribeMedia({
		modelPath: path.join(directory, "missing-model.bin"),
	});
	await assert.rejects(sdk.waitForJob(missingModel.jobId), /ENOENT|model|access/i);
	note("Real audio analysis, JPEG frames and missing-model error passed");
	const savedPath = path.join(directory, "edited.recordly");
	await cli("save_project", { path: savedPath });
	assert.equal(JSON.parse(await readFile(savedPath, "utf8")).editor.clipRegions.length, 2);
	const reopened = await sdk.openProject(savedPath);
	assert.equal(reopened.durationMs, 3000);
	assert.equal(reopened.projectId, JSON.parse(await readFile(savedPath, "utf8")).projectId);
	note("CLI save and SDK reopen preserved edited footage");
	mcp = new Client({ name: "recordly-smoke", version: "1" });
	await mcp.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: [path.join(automationPackage, "dist/mcp.js"), "--connection", connectionFile],
			stderr: "pipe",
		}),
	);
	const listed = await mcp.listTools();
	assert.equal(listed.tools.length, 23);
	const mcpProject = await mcp.callTool({ name: "get_project", arguments: {} });
	assert.equal(mcpProject.structuredContent.durationMs, 3000);
	const mcpEdited = await mcp.callTool({
		name: "apply_edits",
		arguments: {
			expectedRevision: mcpProject.structuredContent.revision,
			edits: [{ type: "split", atMs: 1000 }],
		},
	});
	assert.equal(mcpEdited.isError, undefined);
	assert.equal(mcpEdited.structuredContent.clips.length, 3);
	await mcp.callTool({ name: "undo", arguments: {} });
	const mcpFrames = await mcp.callTool({ name: "get_frames", arguments: { timesMs: [4500] } });
	assert(
		mcpFrames.content.some(
			(content) => content.type === "image" && content.mimeType === "image/jpeg",
		),
	);
	note("Official MCP client discovery, edits, undo and actual image content passed");
	const previewPath = path.join(directory, "blue-preview.mp4");
	const preview = await cli(
		"render_preview",
		{ startMs: 2000, endMs: 3000, outputPath: previewPath, width: 320, height: 180 },
		true,
	);
	assert.equal(preview.status, "completed");
	const previewMeta = await probe(previewPath);
	assert(Math.abs(Number(previewMeta.format.duration) - 1) < 0.2);
	const previewPixel = await pixel(previewPath, 0.5);
	assert(previewPixel[2] > previewPixel[0] + 100);
	assert.equal((await sdk.getProject()).durationMs, 3000);
	note("CLI preview produced correct blue footage and duration without changing the project");
	const exportedPath = path.join(directory, "mcp-export.mp4");
	const exportResponse = await mcp.callTool({
		name: "export_video",
		arguments: { outputPath: exportedPath, width: 320, height: 180, fps: 30 },
	});
	assert.equal(exportResponse.isError, undefined);
	await sdk.waitForJob(exportResponse.structuredContent.jobId);
	const exportedMeta = await probe(exportedPath);
	assert(Math.abs(Number(exportedMeta.format.duration) - 3) < 0.2);
	assert(exportedMeta.streams.some((stream) => stream.codec_type === "audio"));
	const exportedPixel = await pixel(exportedPath, 2.5);
	assert(exportedPixel[2] > exportedPixel[0] + 100);
	assert(
		(await whitePixels(exportedPath, 0.5, "crop=220:55:50:10")) > 20,
		"Title text must actually appear in the exported frame",
	);
	assert(
		(await whitePixels(exportedPath, 0.5, "crop=220:55:50:120")) > 20,
		"Caption text must actually appear in the exported frame",
	);
	note("MCP export produced a real 3-second MP4 with edited source timing and audio");
	const existing = await sdk.exportVideo({ outputPath: exportedPath });
	await assert.rejects(sdk.waitForJob(existing.jobId), /exist|EEXIST/i);
	const canceledPath = path.join(directory, "canceled.mp4");
	const canceled = await sdk.exportVideo({ outputPath: canceledPath, width: 1920, height: 1080 });
	assert.equal((await sdk.cancelJob(canceled.jobId)).status, "canceled");
	for (let i = 0; i < 100 && (await exists(canceledPath)); i++)
		await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(await exists(canceledPath), false);
	assert.equal((await probe(input)).format.duration, "6.000000");
	note(
		"Output overwrite protection, cancellation cleanup and original source preservation passed",
	);

	await sdk.openProject(input);
	const indexJob = await sdk.indexVideo({
		transcript: [
			{ startMs: 0, endMs: 1800, text: "打开项目，开始操作" },
			{ startMs: 2100, endMs: 3800, text: "导出失败，出现错误提示" },
			{ startMs: 4100, endMs: 5800, text: "修改完成，导出成功" },
		],
		ocr: true,
		vision: true,
	});
	const indexed = (await sdk.waitForJob(indexJob.jobId)).result;
	const indexId = indexed.indexId;
	assert.equal(indexed.totalSegments, 3);
	assert.equal(indexed.capabilities.vision, "ready");
	const contentIndex = await sdk.getVideoIndex({ indexId });
	assert.equal(contentIndex.segments.length, 3);
	assert(Math.abs(contentIndex.segments[1].startMs - 2000) < 50);
	const cached = (
		await sdk.waitForJob((await sdk.indexVideo({ transcribe: false, ocr: false })).jobId)
	).result;
	assert.equal(cached.indexId, indexId);
	assert.equal(cached.cached, true);
	const search = await cli("search_video", { indexId, query: "导出失败" });
	assert.equal(search.hits[0].segmentId, contentIndex.segments[1].id);
	const semantic = await sdk.searchVideo({ indexId, query: "成功操作的结果", semantic: true });
	assert.equal(semantic.retrieval, "model");
	assert.equal(semantic.hits[0].segmentId, contentIndex.segments[2].id);
	const board = await mcp.callTool({
		name: "get_storyboard",
		arguments: { indexId, offset: 1, limit: 1 },
	});
	assert.equal(board.content.filter((item) => item.type === "image").length, 3);
	const inspection = await mcp.callTool({
		name: "inspect_segment",
		arguments: {
			indexId,
			segmentId: contentIndex.segments[2].id,
			frameCount: 4,
			crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
		},
	});
	assert.equal(inspection.isError, undefined);
	assert.equal(inspection.content.filter((item) => item.type === "image").length, 4);
	assert(
		inspection.content.some(
			(item) =>
				item.type === "audio" &&
				Buffer.from(item.data, "base64").subarray(0, 4).toString() === "RIFF",
		),
	);
	await sdk.annotateVideo({
		indexId,
		observations: [
			{
				segmentId: contentIndex.segments[2].id,
				description: "蓝色页面，成功操作的结果",
				keywords: ["蓝色", "完成"],
			},
		],
	});
	assert.equal(
		(await sdk.searchVideo({ indexId, query: "蓝色" })).hits[0].segmentId,
		contentIndex.segments[2].id,
	);
	note(
		`Persistent scene index, cache reuse, text search, storyboard, cropped inspection/audio and external AI annotations passed (OCR: ${indexed.capabilities.ocr})`,
	);
	if (indexed.capabilities.ocr !== "ready")
		note(`OCR environment note: ${indexed.notes.join("; ")}`);
	const taskPath = path.join(directory, "task-preview.mp4");
	const taskProject = path.join(directory, "task.recordly");
	const taskVideo = path.join(directory, "task-final.mp4");
	const task = await sdk.runEditTask({
		indexId,
		goal: "只保留成功操作，制作一秒演示",
		mode: "selected",
		segmentIds: [contentIndex.segments[2].id],
		targetDurationMs: 1000,
		addCaptions: true,
		zoomClicks: true,
		previewPath: taskPath,
		projectPath: taskProject,
		outputPath: taskVideo,
	});
	const taskResult = (await sdk.waitForJob(task.jobId)).result;
	assert.equal(taskResult.project.durationMs, 1000);
	assert.equal(taskResult.planner, "explicit");
	assert.equal(taskResult.project.editor.autoCaptions.length, 3);
	assert.equal(taskResult.project.editor.zoomRegions.length, 1);
	assert((await pixel(taskPath, 0.5))[2] > 150);
	assert(Math.abs(Number((await probe(taskPath)).format.duration) - 1) < 0.2);
	assert(Math.abs(Number((await probe(taskVideo)).format.duration) - 1) < 0.2);
	assert((await pixel(taskVideo, 0.5))[2] > 150);
	assert.equal(
		JSON.parse(await readFile(taskProject, "utf8")).editor.clipRegions[0].sourceStartMs,
		4000,
	);
	await sdk.undo();
	assert.equal((await sdk.getProject()).durationMs, 6000);
	assert.equal((await sdk.getProject()).editor.autoCaptions.length, 0);
	const modelTask = await sdk.runEditTask({ indexId, goal: "保留最终成功画面" });
	assert.equal((await sdk.waitForJob(modelTask.jobId)).result.planner, "model");
	assert.equal((await sdk.getProject()).durationMs, 2000);
	await sdk.undo();
	const idleTask = await sdk.runEditTask({
		indexId,
		goal: "删除空闲停顿",
		mode: "remove_pauses",
	});
	const idleDuration = (await sdk.waitForJob(idleTask.jobId)).result.project.durationMs;
	assert(idleDuration > 4000 && idleDuration < 5000);
	note(
		"Full edit task selection/speed/captions/save/preview, single-step undo, model-provider planning and local pause mode passed",
	);
	if (process.platform === "win32") {
		const ocrInput = path.join(directory, "ocr-input.mp4");
		await exec(
			ffmpeg,
			[
				"-v",
				"error",
				"-y",
				"-f",
				"lavfi",
				"-i",
				"color=c=white:s=640x360:r=1:d=1",
				"-vf",
				String.raw`drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='Export FAILED':fontcolor=black:fontsize=42:x=50:y=100`,
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				ocrInput,
			],
			{ windowsHide: true },
		);
		const ocrJob = await sdk.indexVideo({ path: ocrInput, transcribe: false, ocr: true });
		const ocrResult = (await sdk.waitForJob(ocrJob.jobId)).result;
		if (ocrResult.capabilities.ocr === "ready") {
			const found = await sdk.searchVideo({
				indexId: ocrResult.indexId,
				query: "Export FAILED",
			});
			assert(
				found.hits.length > 0,
				"Windows OCR must read actual pixels, not the supplied transcript",
			);
			note("Windows OCR recognized Export FAILED from actual video pixels");
		} else note(`Windows OCR unavailable: ${ocrResult.notes.join("; ")}`);
	}
	note("ALL SDK / CLI / MCP END-TO-END CHECKS PASSED");
} catch (error) {
	process.stderr.write(logs);
	throw error;
} finally {
	if (modelServer) await new Promise((resolve) => modelServer.close(resolve));
	for (const [key, value] of Object.entries(originalVisionEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	if (mcp) await mcp.close();
	if (child?.pid) {
		if (process.platform === "win32")
			spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
				windowsHide: true,
				stdio: "ignore",
			});
		else child.kill("SIGTERM");
		await new Promise((resolve) => setTimeout(resolve, 800));
	}
	// Only remove this run's freshly-created directory inside the workspace's .tmp folder.
	if (path.dirname(path.resolve(directory)) === temporaryRoot)
		await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
