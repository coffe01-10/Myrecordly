export interface SmartCutInterval {
	startMs: number;
	endMs: number;
}

export interface SmartCutAnalysis {
	intervals: SmartCutInterval[];
	durationMs: number;
	hasAudio: boolean;
}

export type SmartCutAnalysisResult =
	| { success: true; analysis: SmartCutAnalysis }
	| { success: false; canceled?: boolean; error?: string };

export interface SmartCutRequest {
	requestId: string;
	videoPath: string;
}
