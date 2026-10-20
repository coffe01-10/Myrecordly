import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ipc/ffmpeg/binary";

const exec = promisify(execFile);
export async function probeAutomationMedia(file: string, signal?: AbortSignal) {
	const { stdout } = await exec(
		getFfprobeBinaryPath(),
		[
			"-v",
			"error",
			"-show_entries",
			"format=duration:stream=codec_type,width,height",
			"-of",
			"json",
			file,
		],
		{ windowsHide: true, signal },
	);
	const data = JSON.parse(stdout) as {
		format: { duration: string };
		streams: { codec_type: string; width?: number; height?: number }[];
	};
	const video = data.streams.find((stream) => stream.codec_type === "video");
	const durationMs = Number(data.format.duration) * 1000;
	if (!video || !Number.isFinite(durationMs) || durationMs <= 0)
		throw new Error("A readable video with a positive duration is required");
	return {
		durationMs,
		width: video.width!,
		height: video.height!,
		hasAudio: data.streams.some((stream) => stream.codec_type === "audio"),
	};
}
export async function extractAutomationFrames(file: string, timesMs: number[], width = 640) {
	if (!Array.isArray(timesMs) || timesMs.length === 0 || timesMs.length > 16)
		throw new Error("Request between 1 and 16 frames");
	if (!Number.isInteger(width) || width < 64 || width > 1280)
		throw new Error("Frame width must be an integer between 64 and 1280");
	const metadata = await probeAutomationMedia(file);
	for (const time of timesMs)
		if (!Number.isFinite(time) || time < 0 || time >= metadata.durationMs)
			throw new Error("Frame time is outside the source video");
	const frames = [];
	for (const timeMs of timesMs) {
		const { stdout } = await exec(
			getFfmpegBinaryPath(),
			[
				"-v",
				"error",
				"-nostdin",
				"-ss",
				String(timeMs / 1000),
				"-i",
				file,
				"-frames:v",
				"1",
				"-vf",
				`scale=${width}:-2`,
				"-f",
				"image2pipe",
				"-vcodec",
				"mjpeg",
				"pipe:1",
			],
			{ windowsHide: true, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 },
		);
		if (stdout.length === 0) throw new Error(`Cannot decode frame at ${timeMs} ms`);
		frames.push({ timeMs, mimeType: "image/jpeg" as const, data: stdout.toString("base64") });
	}
	return { path: file, timeBase: "source" as const, frames };
}
