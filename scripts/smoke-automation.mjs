import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
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
			"[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[3:a]volume=0:enable='between(t,2,4)'[a]",
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
	assert.equal(listed.tools.length, 13);
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
	note("ALL SDK / CLI / MCP END-TO-END CHECKS PASSED");
} catch (error) {
	process.stderr.write(logs);
	throw error;
} finally {
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
