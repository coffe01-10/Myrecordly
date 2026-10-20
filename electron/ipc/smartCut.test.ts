import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	companions: vi.fn(async (): Promise<{ usablePaths: string[] }[]> => []),
	delay: vi.fn(async () => 0),
}));
vi.mock("./recording/diagnostics", () => ({
	getUsableCompanionAudioCandidates: mocks.companions,
	getCompanionAudioStartDelayMs: mocks.delay,
}));
vi.mock("./utils", () => ({ normalizeVideoSourcePath: (value: string) => value }));
vi.mock("./ffmpeg/binary", async () => {
	const { createRequire } = await import("node:module");
	const require = createRequire(import.meta.url);
	return {
		getFfmpegBinaryPath: () => require("ffmpeg-static"),
		getFfprobeBinaryPath: () => require("ffprobe-static").path,
	};
});

import { analyzeSmartCut, intersectSilences } from "./smartCut";

const require = createRequire(import.meta.url);
const ffmpeg: string = require("ffmpeg-static");
const run = promisify(execFile);
let directory: string | undefined;
afterEach(async () => {
	if (directory) await rm(directory, { recursive: true, force: true });
	directory = undefined;
	mocks.companions.mockResolvedValue([]);
	mocks.delay.mockResolvedValue(0);
});

it("intersects all tracks, including gaps and trailing silence", () => {
	expect(
		intersectSilences(
			[{ startMs: 0, endMs: 10000 }],
			[
				{ startMs: 2000, endMs: 3000 },
				{ startMs: 5000, endMs: 10000 },
			],
		),
	).toEqual([
		{ startMs: 2000, endMs: 3000 },
		{ startMs: 5000, endMs: 10000 },
	]);
});

it("detects real multitrack audio and never cuts speech on the second track", async () => {
	directory = await mkdtemp(path.join(tmpdir(), "recordly-smart-cut-"));
	const file = path.join(directory, "tracks.mkv");
	await run(
		ffmpeg,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=size=16x16:rate=1:duration=8",
			"-f",
			"lavfi",
			"-i",
			"aevalsrc=if(between(t\\,1\\,6)\\,0\\,0.5*sin(2*PI*440*t)):s=16000:d=8",
			"-f",
			"lavfi",
			"-i",
			"aevalsrc=if(between(t\\,3\\,4)\\,0.5*sin(2*PI*880*t)\\,0):s=16000:d=8",
			"-map",
			"0:v",
			"-map",
			"1:a",
			"-map",
			"2:a",
			"-c:v",
			"ffv1",
			"-c:a",
			"pcm_s16le",
			file,
		],
		{ windowsHide: true },
	);
	const result = await analyzeSmartCut(file, new AbortController().signal);
	expect(result.hasAudio).toBe(true);
	expect(result.durationMs).toBe(8000);
	expect(result.intervals).toHaveLength(2);
	expect(result.intervals[0].startMs).toBeCloseTo(1000, -1);
	expect(result.intervals[0].endMs).toBeCloseTo(3000, -1);
	expect(result.intervals[1].startMs).toBeCloseTo(4000, -1);
	expect(result.intervals[1].endMs).toBeCloseTo(6000, -1);
}, 30000);

it("reports audio-free media explicitly and supports cancellation", async () => {
	directory = await mkdtemp(path.join(tmpdir(), "recordly-smart-cut-"));
	const file = path.join(directory, "silent.mkv");
	await run(
		ffmpeg,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=size=16x16:rate=1:duration=4",
			"-c:v",
			"ffv1",
			file,
		],
		{ windowsHide: true },
	);
	expect(await analyzeSmartCut(file, new AbortController().signal)).toEqual({
		hasAudio: false,
		durationMs: 4000,
		intervals: [{ startMs: 0, endMs: 4000 }],
	});
	const controller = new AbortController();
	controller.abort();
	await expect(analyzeSmartCut(file, controller.signal)).rejects.toThrow();
}, 30000);

it("aligns delayed microphone sidecars and includes quiet audio tails", async () => {
	directory = await mkdtemp(path.join(tmpdir(), "recordly-smart-cut-"));
	const file = path.join(directory, "video.mkv");
	const mic = path.join(directory, "microphone.wav");
	await run(
		ffmpeg,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=size=16x16:rate=1:duration=6",
			"-c:v",
			"ffv1",
			file,
		],
		{ windowsHide: true },
	);
	await run(
		ffmpeg,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=16000:duration=1",
			mic,
		],
		{ windowsHide: true },
	);
	mocks.companions.mockResolvedValue([{ usablePaths: [mic] }]);
	mocks.delay.mockResolvedValue(2000);
	const result = await analyzeSmartCut(file, new AbortController().signal);
	expect(result.hasAudio).toBe(true);
	expect(result.intervals).toHaveLength(2);
	expect(result.intervals[0].startMs).toBe(0);
	expect(result.intervals[0].endMs).toBeCloseTo(2000, -1);
	expect(result.intervals[1].startMs).toBeCloseTo(3000, -1);
	expect(result.intervals[1].endMs).toBe(6000);
}, 30000);
