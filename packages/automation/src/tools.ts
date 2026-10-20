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
	z.object({ type: z.literal("caption"), ...range, text: z.string().min(1) }),
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
]);
const render = {
	outputPath: z.string().min(1).describe("Absolute local .mp4 output path"),
	width: z.number().int().min(2).max(8192).optional(),
	height: z.number().int().min(2).max(8192).optional(),
	fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).optional(),
	overwrite: z.boolean().optional(),
};
export const tools = {
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
			"Atomically apply an ordered edit batch, recorded as one undo step. Read get_project first and pass its revision. Each edit sees the preceding edits. Delete/speed explicitly choose source or timeline time; captions ALWAYS use source time; split/zoom/text use timeline time. All ranges are half-open milliseconds. Returns the new project and revision.",
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
	if (!Object.hasOwn(tools, name)) throw new Error(`Unknown tool: ${name}`);
	const toolName = name as ToolName;
	return { name: toolName, args: tools[toolName].schema.parse(args) };
}
