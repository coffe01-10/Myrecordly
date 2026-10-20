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
export async function extractAutomationFrames(
	file: string,
	timesMs: number[],
	width = 640,
	options: {
		signal?: AbortSignal;
		crop?: { x: number; y: number; width: number; height: number };
	} = {},
) {
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
		frames.push(await extractFrame(file, timeMs, width, options));
	}
	return { path: file, timeBase: "source" as const, frames };
}
export async function extractFrame(
	file: string,
	timeMs: number,
	width: number,
	options: {
		signal?: AbortSignal;
		crop?: { x: number; y: number; width: number; height: number };
	} = {},
) {
	const crop = options.crop;
	const filter = crop
		? `crop=iw*${crop.width}:ih*${crop.height}:iw*${crop.x}:ih*${crop.y},scale=${width}:-2`
		: `scale=${width}:-2`;
	const { stdout } = await exec(
		getFfmpegBinaryPath(),
		[
			"-v",
			"error",
			"-nostdin",
			"-ss",
			String(timeMs / 1000),
			// Keep the preceding keyframe, then sample at the requested millisecond.
			// Accurate input seek alone drops the only frame in low-FPS/static clips.
			"-noaccurate_seek",
			"-i",
			file,
			"-frames:v",
			"1",
			"-vf",
			`fps=1000:start_time=0:round=near,${filter}`,
			"-f",
			"image2pipe",
			"-vcodec",
			"mjpeg",
			"pipe:1",
		],
		{
			windowsHide: true,
			encoding: "buffer",
			maxBuffer: 8 * 1024 * 1024,
			signal: options.signal,
		},
	);
	if (stdout.length === 0) throw new Error(`Cannot decode frame at ${timeMs} ms`);
	return { timeMs, mimeType: "image/jpeg" as const, data: stdout.toString("base64") };
}

export async function extractSegmentAudio(
	tracks: Array<{ path: string; delayMs: number }>,
	startMs: number,
	endMs: number,
	signal?: AbortSignal,
) {
	const filters = tracks.map(
		(track, n) =>
			`[${n}:a:0]asetpts=PTS-STARTPTS,adelay=${Math.max(0, track.delayMs - startMs)}:all=1,apad,atrim=duration=${(endMs - startMs) / 1000}[a${n}]`,
	);
	filters.push(
		`${tracks.map((_, n) => `[a${n}]`).join("")}amix=inputs=${tracks.length}:duration=longest:normalize=0[out]`,
	);
	const { stdout } = await exec(
		getFfmpegBinaryPath(),
		[
			"-v",
			"error",
			"-nostdin",
			...tracks.flatMap((track) => [
				"-ss",
				String(Math.max(0, startMs - track.delayMs) / 1000),
				"-i",
				track.path,
			]),
			"-filter_complex",
			filters.join(";"),
			"-map",
			"[out]",
			"-vn",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-f",
			"wav",
			"pipe:1",
		],
		{ windowsHide: true, signal, encoding: "buffer", maxBuffer: 4 * 1024 * 1024 },
	);
	return { mimeType: "audio/wav" as const, data: stdout.toString("base64") };
}
export async function detectSceneTimes(file: string, signal: AbortSignal) {
	const { stderr } = await exec(
		getFfmpegBinaryPath(),
		[
			"-hide_banner",
			"-nostdin",
			"-i",
			file,
			"-an",
			"-vf",
			"scale=320:-2,format=rgb24,select='gt(scene,0.28)',showinfo",
			"-vsync",
			"vfr",
			"-f",
			"null",
			"-",
		],
		{ windowsHide: true, signal, maxBuffer: 20 * 1024 * 1024 },
	);
	return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((match) => Number(match[1]) * 1000);
}
