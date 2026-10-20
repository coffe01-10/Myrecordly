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
	| ({ type: "caption"; text: string; timeBase?: "source" | "timeline" } & TimeRange)
	| ({ type: "zoom"; depth: 1 | 2 | 3 | 4 | 5 | 6; cx: number; cy: number } & TimeRange)
	| ({
			type: "text";
			text: string;
			x?: number;
			y?: number;
			fontSize?: number;
			color?: string;
	  } & TimeRange)
	| { type: "remove_effect"; id: string }
	| {
			type: "annotation";
			kind: "text" | "image" | "figure" | "blur";
			startMs: number;
			endMs: number;
			text?: string;
			image?: string;
			x?: number;
			y?: number;
			width?: number;
			height?: number;
			fontSize?: number;
			color?: string;
			backgroundColor?: string;
			arrow?:
				| "up"
				| "down"
				| "left"
				| "right"
				| "up-right"
				| "up-left"
				| "down-right"
				| "down-left";
			strokeWidth?: number;
			blur?: number;
	  }
	| {
			type: "audio";
			audioPath: string;
			startMs: number;
			endMs: number;
			volume?: number;
			normalize?: boolean;
	  }
	| {
			type: "audio_volume";
			id?: string;
			clipId?: string;
			volume: number;
			normalize?: boolean;
	  }
	| { type: "remove_audio"; id: string }
	| { type: "set_appearance"; appearance: Record<string, unknown> };
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
	playback?: { timeMs: number; playing: boolean; durationMs: number };
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
	kind: "analysis" | "transcription" | "preview" | "export" | "index" | "edit_task";
	status: "running" | "completed" | "failed" | "canceled";
	progress: number;
	cancellable: boolean;
	result?: T;
	error?: string;
}
export interface TranscriptCue extends TimeRange {
	text: string;
}
export interface VideoObservation {
	segmentId: string;
	description: string;
	keywords?: string[];
}
export interface IndexedSegment extends TimeRange {
	id: string;
	frames: Array<{ timeMs: number; imagePath: string; text: string }>;
	transcript: TranscriptCue[];
	clicks: Array<{ timeMs: number; cx: number; cy: number; type: string }>;
	description: string;
	keywords: string[];
	descriptionSource?: "model" | "agent";
}
export interface VideoIndex {
	id: string;
	path: string;
	timeBase: "source";
	createdAt: string;
	sourceSize: number;
	sourceModifiedMs: number;
	durationMs: number;
	width: number;
	height: number;
	hasAudio: boolean;
	audioTracks: Array<{ path: string; delayMs: number }>;
	capabilities: { transcript: string; ocr: string; vision: string };
	notes: string[];
	silences: TimeRange[];
	segments: IndexedSegment[];
}
export interface VideoSearchHit {
	segmentId: string;
	startMs: number;
	endMs: number;
	score: number;
	text: string;
}
export interface SegmentInspection {
	indexId: string;
	path: string;
	timeBase: "source";
	startMs: number;
	endMs: number;
	frames: FrameImage[];
	segments: IndexedSegment[];
	audio?: { mimeType: "audio/wav"; data: string };
}
export interface EditTaskOptions {
	indexId: string;
	goal: string;
	/** Auto uses a configured model; selected and remove_pauses run locally. */
	mode?: "auto" | "selected" | "remove_pauses";
	segmentIds?: string[];
	/** An external AI can supply its own complete batch instead of an internal model. */
	edits?: Edit[];
	addCaptions?: boolean;
	zoomClicks?: boolean;
	targetDurationMs?: number;
	previewPath?: string;
	outputPath?: string;
	projectPath?: string;
}
export interface EditTaskResult {
	goal: string;
	planner: "model" | "explicit" | "local";
	edits: Edit[];
	project: ProjectSnapshot;
	notes: string[];
	preview?: unknown;
	export?: unknown;
	savedPath?: string;
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
	index_video: {
		path?: string;
		refresh?: boolean;
		transcribe?: boolean;
		ocr?: boolean;
		vision?: boolean;
		transcript?: TranscriptCue[];
	};
	get_video_index: { indexId: string; offset?: number; limit?: number };
	get_storyboard: { indexId: string; offset?: number; limit?: number };
	search_video: { indexId: string; query: string; limit?: number; semantic?: boolean };
	inspect_segment: {
		indexId: string;
		segmentId?: string;
		startMs?: number;
		endMs?: number;
		frameCount?: number;
		width?: number;
		audio?: boolean;
		crop?: { x: number; y: number; width: number; height: number };
	};
	annotate_video: { indexId: string; observations: VideoObservation[] };
	run_edit_task: EditTaskOptions;
	list_recordings: Record<string, never>;
	list_projects: Record<string, never>;
	playback: { action: "play" | "pause" | "seek"; timeMs?: number };
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
	index_video: JobHandle;
	get_video_index: Omit<VideoIndex, "segments"> & {
		segments: IndexedSegment[];
		totalSegments: number;
		offset: number;
	};
	get_storyboard: {
		indexId: string;
		timeBase: "source";
		totalSegments: number;
		segments: IndexedSegment[];
		frames: FrameImage[];
	};
	search_video: {
		indexId: string;
		query: string;
		retrieval: "text" | "model";
		hits: VideoSearchHit[];
	};
	inspect_segment: SegmentInspection;
	annotate_video: { indexId: string; updated: number };
	run_edit_task: JobHandle;
	list_recordings: {
		recordings: Array<{ path: string; name: string; bytes: number; createdAt: number }>;
	};
	list_projects: {
		projectsDir: string | null;
		projects: Array<{ path: string; name: string; updatedAt: number; videoPath?: string }>;
	};
	playback: { timeMs: number; playing: boolean; durationMs: number };
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
