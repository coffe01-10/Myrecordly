/** Times are milliseconds. Ranges are half-open: [startMs, endMs). */
export interface TimeRange {
	startMs: number;
	endMs: number;
}
export interface TimelineClip extends TimeRange {
	id: string;
	speed: number;
	sourceStartMs?: number;
	muted?: boolean;
}
export type Edit =
	| { type: "split"; atMs: number }
	| ({ type: "delete"; timeBase: "source" | "timeline" } & TimeRange)
	| ({ type: "speed"; timeBase: "source" | "timeline"; speed: number } & TimeRange)
	| { type: "reorder"; clipId: string; index: number }
	| { type: "mute"; clipId: string; muted: boolean }
	| ({ type: "caption"; text: string } & TimeRange)
	| ({ type: "zoom"; depth: 1 | 2 | 3 | 4 | 5 | 6; cx: number; cy: number } & TimeRange)
	| ({
			type: "text";
			text: string;
			x?: number;
			y?: number;
			fontSize?: number;
			color?: string;
	  } & TimeRange)
	| { type: "remove_effect"; id: string };
export interface ProjectSnapshot {
	projectId?: string;
	revision: number;
	projectPath: string | null;
	sourcePath: string | null;
	sourceDurationMs: number;
	durationMs: number;
	ready: boolean;
	error: string | null;
	canUndo: boolean;
	canRedo: boolean;
	clips: TimelineClip[];
	/** Full persisted Recordly editor state, including effects and source-timed captions. */
	editor: Record<string, unknown>;
}
export interface RenderOptions {
	outputPath: string;
	width?: number;
	height?: number;
	fps?: 24 | 30 | 60;
	/** Explicitly permit replacing an existing output file. Defaults to false. */
	overwrite?: boolean;
}
export interface Job<T = unknown> {
	id: string;
	kind: "analysis" | "transcription" | "preview" | "export";
	status: "running" | "completed" | "failed" | "canceled";
	progress: number;
	cancellable: boolean;
	result?: T;
	error?: string;
}
export interface JobHandle {
	jobId: string;
}
export interface FrameImage {
	timeMs: number;
	mimeType: "image/jpeg";
	data: string;
}
export interface ToolArguments {
	get_project: Record<string, never>;
	open_project: { path: string };
	save_project: { path?: string; overwrite?: boolean };
	apply_edits: { expectedRevision: number; edits: Edit[] };
	undo: Record<string, never>;
	redo: Record<string, never>;
	analyze_media: { path?: string };
	transcribe_media: {
		path?: string;
		modelPath?: string;
		executablePath?: string;
		language?: string;
	};
	get_frames: { path?: string; timesMs: number[]; width?: number };
	render_preview: RenderOptions & TimeRange;
	export_video: RenderOptions;
	get_job: { jobId: string };
	cancel_job: { jobId: string };
}
export interface ToolResults {
	get_project: ProjectSnapshot;
	open_project: ProjectSnapshot;
	save_project: { path: string };
	apply_edits: ProjectSnapshot;
	undo: ProjectSnapshot;
	redo: ProjectSnapshot;
	analyze_media: JobHandle;
	transcribe_media: JobHandle;
	get_frames: { path: string; timeBase: "source"; frames: FrameImage[] };
	render_preview: JobHandle;
	export_video: JobHandle;
	get_job: Job;
	cancel_job: Job;
}
export type ToolName = keyof ToolArguments;
export interface ConnectionInfo {
	url: string;
	token: string;
	pid: number;
	version: 1;
}
export interface AutomationRequest {
	id: string;
	command: string;
	args: Record<string, unknown>;
}
export interface AutomationResponse {
	id: string;
	result?: unknown;
	error?: string;
}
