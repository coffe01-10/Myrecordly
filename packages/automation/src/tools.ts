import { z } from "zod";
import type { ToolName } from "./types.js";

const time = z.number().finite().min(0);
const range = { startMs: time, endMs: time };
const timeBase = z.enum(["source", "timeline"]);
const edit = z.discriminatedUnion("type", [
	z.object({ type: z.literal("split"), atMs: time }),
	z.object({ type: z.literal("delete"), ...range, timeBase }),
	z.object({ type: z.literal("speed"), ...range, timeBase, speed: z.number().min(0.25).max(4) }),
	z.object({ type: z.literal("reorder"), clipId: z.string(), index: z.number().int().min(0) }),
	z.object({ type: z.literal("mute"), clipId: z.string(), muted: z.boolean() }),
	z.object({
		type: z.literal("caption"),
		...range,
		text: z.string().min(1),
		timeBase: timeBase.optional(),
	}),
	z.object({
		type: z.literal("zoom"),
		...range,
		depth: z.union([
			z.literal(1),
			z.literal(2),
			z.literal(3),
			z.literal(4),
			z.literal(5),
			z.literal(6),
		]),
		cx: z.number().min(0).max(1),
		cy: z.number().min(0).max(1),
	}),
	z.object({
		type: z.literal("text"),
		...range,
		text: z.string().min(1),
		x: z.number().min(0).max(100).optional(),
		y: z.number().min(0).max(100).optional(),
		fontSize: z.number().min(1).max(1000).optional(),
		color: z.string().optional(),
	}),
	z.object({ type: z.literal("remove_effect"), id: z.string() }),
	z.object({
		type: z.literal("annotation"),
		kind: z.enum(["text", "image", "figure", "blur"]),
		...range,
		text: z.string().optional(),
		image: z.string().optional(),
		x: z.number().min(0).max(100).optional(),
		y: z.number().min(0).max(100).optional(),
		width: z.number().min(1).max(100).optional(),
		height: z.number().min(1).max(100).optional(),
		fontSize: z.number().min(1).max(1000).optional(),
		color: z.string().optional(),
		backgroundColor: z.string().optional(),
		arrow: z
			.enum(["up", "down", "left", "right", "up-right", "up-left", "down-right", "down-left"])
			.optional(),
		strokeWidth: z.number().min(1).max(40).optional(),
		blur: z.number().min(1).max(100).optional(),
	}),
	z.object({
		type: z.literal("audio"),
		audioPath: z.string().min(1),
		...range,
		volume: z.number().min(0).max(1).optional(),
		normalize: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("audio_volume"),
		id: z.string().optional(),
		clipId: z.string().optional(),
		volume: z.number().min(0).max(1),
		normalize: z.boolean().optional(),
	}),
	z.object({ type: z.literal("remove_audio"), id: z.string() }),
	z.object({ type: z.literal("set_appearance"), appearance: z.record(z.unknown()) }),
]);
const render = {
	outputPath: z.string().min(1).describe("Absolute local .mp4 output path"),
	width: z.number().int().min(2).max(8192).optional(),
	height: z.number().int().min(2).max(8192).optional(),
	fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).optional(),
	overwrite: z.boolean().optional(),
};
export const tools = {
	index_video: {
		description:
			"Build/reuse a persistent SOURCE-time video index: scene boundaries, timestamped storyboards, local OCR, transcript, pauses and clicks. Returns jobId; get_job result includes indexId, capabilities and missing-environment notes. Vision is opt-in and uses configured RECORDLY_VISION_* endpoint.",
		schema: z.object({
			path: z.string().optional(),
			refresh: z.boolean().optional(),
			transcribe: z.boolean().optional(),
			ocr: z.boolean().optional(),
			vision: z.boolean().optional(),
			transcript: z.array(z.object({ ...range, text: z.string() })).optional(),
		}),
	},
	get_video_index: {
		description:
			"Read indexed content with stable segment IDs, source timestamps, OCR, transcript, clicks and descriptions. Paginated; no image payloads.",
		schema: z.object({
			indexId: z.string(),
			offset: z.number().int().min(0).optional(),
			limit: z.number().int().min(1).max(100).optional(),
		}),
	},
	get_storyboard: {
		description:
			"See the video overview as actual timestamped JPEG images with segment IDs. Read pages, then inspect_segment for continuous action or small text. Times are SOURCE time.",
		schema: z.object({
			indexId: z.string(),
			offset: z.number().int().min(0).optional(),
			limit: z.number().int().min(1).max(8).optional(),
		}),
	},
	search_video: {
		description:
			"Search indexed speech, screen text, visual descriptions and keywords. Returns ranked segment IDs and SOURCE-time evidence. Default is text retrieval; semantic:true uses the configured model to interpret the query and rank indexed evidence. Use annotate_video after viewing images to make visual meaning searchable.",
		schema: z.object({
			indexId: z.string(),
			query: z.string().min(1),
			semantic: z.boolean().optional(),
			limit: z.number().int().min(1).max(50).optional(),
		}),
	},
	inspect_segment: {
		description:
			"Inspect an indexed segment or an explicit SOURCE-time range (up to 30 seconds): sequential JPEG frames, optional cropped close-ups, actual WAV audio and aligned indexed evidence. Returns images/audio directly in MCP. Crop coordinates are fractions of the source frame.",
		schema: z.object({
			indexId: z.string(),
			segmentId: z.string().optional(),
			startMs: time.optional(),
			endMs: time.optional(),
			frameCount: z.number().int().min(1).max(16).optional(),
			width: z.number().int().min(64).max(1280).optional(),
			audio: z.boolean().optional(),
			crop: z
				.object({
					x: z.number().min(0).max(1),
					y: z.number().min(0).max(1),
					width: z.number().positive().max(1),
					height: z.number().positive().max(1),
				})
				.optional(),
		}),
	},
	annotate_video: {
		description:
			"Persist what your vision model observed in storyboard/inspection images. Attach factual descriptions and searchable keywords to stable segment IDs; this enables external AI video understanding without any additional model API.",
		schema: z.object({
			indexId: z.string(),
			observations: z
				.array(
					z.object({
						segmentId: z.string(),
						description: z.string(),
						keywords: z.array(z.string()).optional(),
					}),
				)
				.min(1),
		}),
	},
	run_edit_task: {
		description:
			"Run a complete editing workflow as one background job: plan, apply a single undoable batch, optionally render preview, save and export. Supply explicit edits from your own reasoning, selected segmentIds, local remove_pauses mode, or auto with a configured vision/planning model. Reads the current edited timeline; original SOURCE times stay stable. Does not require an approval round-trip.",
		schema: z.object({
			indexId: z.string(),
			goal: z.string().min(1),
			mode: z.enum(["auto", "selected", "remove_pauses"]).optional(),
			segmentIds: z.array(z.string()).optional(),
			edits: z.array(edit).optional(),
			addCaptions: z.boolean().optional(),
			zoomClicks: z.boolean().optional(),
			targetDurationMs: time.optional(),
			previewPath: z.string().optional(),
			outputPath: z.string().optional(),
			projectPath: z.string().optional(),
		}),
	},
	list_recordings: {
		description:
			"List local screen recordings available to open. Returns path, name, size and time.",
		schema: z.object({}),
	},
	list_projects: {
		description: "List saved .recordly projects and the projects directory.",
		schema: z.object({}),
	},
	playback: {
		description:
			"Control the open editor preview. action is play, pause, or seek. seek uses timeline timeMs in milliseconds.",
		schema: z.object({
			action: z.enum(["play", "pause", "seek"]),
			timeMs: time.optional(),
		}),
	},
	get_project: {
		description:
			"Read the active project, full editor state, clips, readiness, history and revision. Times are milliseconds.",
		schema: z.object({}),
	},
	open_project: {
		description:
			"Open a local video or .recordly project in Recordly and wait for preview readiness. Existing unsaved edits are saved first.",
		schema: z.object({ path: z.string().min(1) }),
	},
	save_project: {
		description:
			"Save an editable .recordly project. Supply path for a new project; overwrite must be explicit for an existing other file.",
		schema: z.object({ path: z.string().optional(), overwrite: z.boolean().optional() }),
	},
	apply_edits: {
		description:
			"Atomically apply an ordered edit batch, recorded as one undo step. Read get_project first and pass its revision. Each edit sees the preceding edits. Delete/speed explicitly choose source or timeline time; captions default to source time and accept timeBase; split/zoom/text use timeline time. All ranges are half-open milliseconds. Returns the new project and revision.",
		schema: z.object({ expectedRevision: z.number().int(), edits: z.array(edit).min(1) }),
	},
	undo: {
		description: "Undo one complete edit batch, including edits made in the UI.",
		schema: z.object({}),
	},
	redo: { description: "Redo one previously undone edit batch.", schema: z.object({}) },
	analyze_media: {
		description:
			"Start local pause analysis across recorded audio tracks. Returns jobId. get_job returns source-time silence intervals; these are candidates, not automatic deletion decisions.",
		schema: z.object({ path: z.string().optional() }),
	},
	transcribe_media: {
		description:
			"Start local Whisper transcription, returning jobId and source-timed cues via get_job. Uses installed model or explicit modelPath. Missing models produce an actionable failed job; other tools still work.",
		schema: z.object({
			path: z.string().optional(),
			modelPath: z.string().optional(),
			executablePath: z.string().optional(),
			language: z.string().optional(),
		}),
	},
	get_frames: {
		description:
			"Return actual JPEG images at SOURCE-time milliseconds. Optional path lets you inspect a completed edited preview/export as a new source. At most 16 frames per call.",
		schema: z.object({
			path: z.string().optional(),
			timesMs: z.array(time).min(1).max(16),
			width: z.number().int().min(64).max(1280).optional(),
		}),
	},
	render_preview: {
		description:
			"Render a TIMELINE-time range of the current edited project, with effects and audio. Returns jobId; get_job returns output path. Does not change the open project.",
		schema: z.object({ ...render, ...range }),
	},
	export_video: {
		description:
			"Export the current edited project to MP4 with captions, zoom, annotations and audio using Recordly's renderer. Returns jobId; inspect progress/result with get_job.",
		schema: z.object(render),
	},
	get_job: {
		description:
			"Read analysis, transcription, preview or export status, progress, result or error. Terminal states: completed, failed, canceled.",
		schema: z.object({ jobId: z.string() }),
	},
	cancel_job: {
		description: "Cancel an analysis, transcription, preview or export job and stop its work.",
		schema: z.object({ jobId: z.string() }),
	},
} satisfies Record<ToolName, { description: string; schema: z.AnyZodObject }>;

export function parseTool(name: string, args: unknown) {
	if (!Object.keys(tools).includes(name)) throw new Error(`Unknown tool: ${name}`);
	const toolName = name as ToolName;
	return { name: toolName, args: tools[toolName].schema.parse(args) };
}
