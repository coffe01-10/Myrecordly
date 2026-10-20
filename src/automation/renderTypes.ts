import type { ProjectSnapshot, RenderOptions } from "../../packages/automation/src/types";
import type {
	CursorTelemetryPoint,
	SourceAudioTrackSettings,
} from "@/components/video-editor/types";
export interface RenderContext {
	cursorTelemetry: CursorTelemetryPoint[];
	sourceAudioFallbackPaths: string[];
	sourceAudioFallbackStartDelayMsByPath: Record<string, number>;
	sourceAudioTrackSettings: SourceAudioTrackSettings;
	effectiveShowCursor: boolean;
}
export type RenderSnapshot = ProjectSnapshot & RenderContext;
export type RenderRequest = RenderOptions & {
	snapshot: RenderSnapshot;
	startMs?: number;
	endMs?: number;
};
