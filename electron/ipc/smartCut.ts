import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SmartCutAnalysis, SmartCutInterval } from "../../src/types/smartCut";
import { parseSilenceIntervals } from "./captions/silence";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "./ffmpeg/binary";
import {
	getCompanionAudioStartDelayMs,
	getUsableCompanionAudioCandidates,
} from "./recording/diagnostics";
import { normalizeVideoSourcePath } from "./utils";

const execFileAsync = promisify(execFile);

/** A pause is quiet only when every recorded audio track is quiet. */
export function intersectSilences(a: SmartCutInterval[], b: SmartCutInterval[]) {
	const result: SmartCutInterval[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		const startMs = Math.max(a[i].startMs, b[j].startMs);
		const endMs = Math.min(a[i].endMs, b[j].endMs);
		if (endMs > startMs) result.push({ startMs, endMs });
		if (a[i].endMs < b[j].endMs) i++;
		else j++;
	}
	return result;
}

export async function analyzeSmartCut(
	videoPath: string,
	signal: AbortSignal,
): Promise<SmartCutAnalysis> {
	const source = normalizeVideoSourcePath(videoPath);
	if (!source) throw new Error("Invalid video path");
	const ffprobe = getFfprobeBinaryPath();
	const ffmpeg = getFfmpegBinaryPath();
	const processOptions = { signal, windowsHide: true, maxBuffer: 20 * 1024 * 1024 };
	const probe = async (file: string) => {
		const { stdout } = await execFileAsync(
			ffprobe,
			[
				"-v",
				"error",
				"-show_entries",
				"format=duration:stream=index,codec_type",
				"-of",
				"json",
				file,
			],
			processOptions,
		);
		return JSON.parse(stdout) as {
			format: { duration?: string };
			streams: { index: number; codec_type: string }[];
		};
	};
	const media = await probe(source);
	const durationMs = Math.round(Number(media.format.duration) * 1000);
	if (!Number.isFinite(durationMs) || durationMs <= 0)
		throw new Error("Cannot read video duration");
	const companions = await getUsableCompanionAudioCandidates(source);
	const paths = [...new Set(companions.flatMap((candidate) => candidate.usablePaths))];
	let intervals: SmartCutInterval[] = [{ startMs: 0, endMs: durationMs }];
	let hasAudio = false;
	for (const file of [source, ...paths]) {
		signal.throwIfAborted();
		const metadata = file === source ? media : await probe(file);
		const delayMs = file === source ? 0 : ((await getCompanionAudioStartDelayMs(file)) ?? 0);
		for (const stream of metadata.streams.filter((stream) => stream.codec_type === "audio")) {
			hasAudio = true;
			// Pad sidecars to the recording length. No intermediate WAV files are needed.
			const { stderr } = await execFileAsync(
				ffmpeg,
				[
					"-hide_banner",
					"-nostats",
					"-nostdin",
					"-i",
					file,
					"-map",
					`0:${stream.index}`,
					"-vn",
					"-af",
					`adelay=${delayMs}:all=1,apad,atrim=duration=${durationMs / 1000},silencedetect=noise=-35dB:d=0.5`,
					"-f",
					"null",
					"-",
				],
				processOptions,
			);
			const quiet = parseSilenceIntervals(stderr).map((span) => ({
				startMs: Math.min(durationMs, span.startMs),
				endMs: Math.min(durationMs, span.endMs),
			}));
			intervals = intersectSilences(intervals, quiet);
		}
	}
	return { durationMs, intervals, hasAudio };
}
