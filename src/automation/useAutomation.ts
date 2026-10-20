import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { AutomationRequest, Edit, ProjectSnapshot } from "../../packages/automation/src/types";
import {
	normalizeProjectEditor,
	type EditorProjectData,
} from "@/components/video-editor/projectPersistence";
import type { useEditorProjectController } from "@/components/video-editor/project/useEditorProjectController";
import type { useProjectState } from "@/components/video-editor/state/useProjectState";
import type { useTimelineState } from "@/components/video-editor/state/useTimelineState";
import type { useEditorUiState } from "@/components/video-editor/state/useEditorUiState";
import { applyEditCommands, timelineDuration } from "./editCommands";
import type { RenderContext } from "./renderTypes";
import { findSmartCutCandidates } from "@/components/video-editor/smartCut/smartCutPlan";
import type { SmartCutAnalysis } from "@/types/smartCut";

type Input = {
	project: ReturnType<typeof useProjectState>;
	timeline: ReturnType<typeof useTimelineState>;
	ui: ReturnType<typeof useEditorUiState>;
	controller: ReturnType<typeof useEditorProjectController>;
	isPreviewReady: boolean;
	renderContext: RenderContext;
};
export function useAutomation(input: Input) {
	const current = useRef(input);
	current.current = input;
	const revision = useRef(0);
	const previous = useRef<unknown>(null);
	const state = input.controller.snapshot.currentPersistedEditorState;
	if (previous.current !== state) {
		previous.current = state;
		revision.current++;
	}
	const snapshot = (): ProjectSnapshot => {
		const { project, ui, timeline, controller, isPreviewReady } = current.current;
		return {
			projectId: project.lastSavedSnapshot?.projectId,
			revision: revision.current,
			projectPath: project.currentProjectPath,
			sourcePath: controller.snapshot.currentSourcePath,
			sourceDurationMs: ui.duration * 1000,
			durationMs: timelineDuration(timeline.clipRegions),
			ready: isPreviewReady && !project.loading,
			error: project.error,
			canUndo: controller.history.canUndo,
			canRedo: controller.history.canRedo,
			clips: timeline.clipRegions,
			editor: controller.snapshot.currentPersistedEditorState as unknown as Record<
				string,
				unknown
			>,
		};
	};
	const snapshotRef = useRef(snapshot);
	snapshotRef.current = snapshot;
	useEffect(() => {
		if (!window.electronAPI.onAutomationRequest) return;
		const handle = async ({ id, command, args }: AutomationRequest) => {
			try {
				const { controller, project, timeline, ui } = current.current;
				let result: unknown;
				switch (command) {
					case "get_project":
						result = snapshotRef.current();
						break;
					case "open": {
						if (
							controller.hasUnsavedChanges &&
							!(await controller.saveActions.saveProject(false, {
								silent: true,
								remountPreviewAfterSave: false,
							}))
						)
							throw new Error(
								"Could not save current edits before opening another project",
							);
						if (
							!(await controller.lifecycle.applyLoadedProject(
								args.project,
								args.path as string | null,
							))
						)
							throw new Error("Invalid Recordly project");
						flushSync(() => {
							project.setProjectBrowserOpen(false);
							project.setLoading(false);
						});
						result = snapshotRef.current();
						break;
					}
					case "apply_edits": {
						const active = snapshotRef.current();
						if (!active.ready) throw new Error("Video preview is still loading");
						if (args.expectedRevision !== active.revision)
							throw new Error(
								`Project changed: expected revision ${String(args.expectedRevision)}, current ${active.revision}. Read get_project and replan.`,
							);
						if (!Array.isArray(args.edits) || args.edits.length === 0)
							throw new Error("edits must be a non-empty array");
						const editor = normalizeProjectEditor(active.editor);
						const next = applyEditCommands(
							editor,
							args.edits as Edit[],
							active.sourceDurationMs,
						);
						ui.videoPlaybackRef.current?.pause();
						flushSync(() => {
							timeline.setClipRegions(next.clipRegions);
							timeline.setZoomRegions(next.zoomRegions);
							timeline.setAnnotationRegions(next.annotationRegions);
							timeline.setAudioRegions(next.audioRegions);
							timeline.setAutoCaptions(next.autoCaptions);
							timeline.setAutoCaptionSettings(next.autoCaptionSettings);
							timeline.setSourceAudioTrackSettingsByClip(
								next.sourceAudioTrackSettingsByClip ?? {},
							);
							timeline.setSelectedClipId(null);
							timeline.setSelectedZoomId(null);
							timeline.setSelectedAnnotationId(null);
							timeline.setSelectedAudioId(null);
							timeline.setSelectedCaptionId(null);
						});
						ui.videoPlaybackRef.current?.seekTimeline(0);
						result = snapshotRef.current();
						break;
					}
					case "undo":
						flushSync(() => controller.history.handleUndo());
						result = snapshotRef.current();
						break;
					case "redo":
						flushSync(() => controller.history.handleRedo());
						result = snapshotRef.current();
						break;
					case "mark_saved": {
						const active = snapshotRef.current();
						const data = args.project as unknown as EditorProjectData;
						if (data.videoPath !== active.sourcePath)
							throw new Error(
								"Project source changed while saving. The file was saved, but the newly opened project was not changed.",
							);
						flushSync(() => {
							project.setCurrentProjectPath(args.path as string);
							project.setLastSavedSnapshot(data);
						});
						result = { path: args.path };
						break;
					}
					case "render_snapshot": {
						if (!snapshotRef.current().ready)
							throw new Error("Video preview is still loading");
						result = { ...snapshotRef.current(), ...current.current.renderContext };
						break;
					}
					case "analyze_candidates": {
						const active = snapshotRef.current();
						result =
							active.sourcePath === args.sourcePath
								? {
										revision: active.revision,
										candidates: findSmartCutCandidates(
											args.analysis as unknown as SmartCutAnalysis,
											timeline.clipRegions,
											current.current.renderContext.cursorTelemetry,
											timeline.audioRegions,
											2000,
										),
									}
								: { candidates: [] };
						break;
					}
					default:
						throw new Error(`Unknown editor command: ${command}`);
				}
				window.electronAPI.automationResponse({ id, result });
			} catch (error) {
				window.electronAPI.automationResponse({
					id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		};
		const remove = window.electronAPI.onAutomationRequest((request) => {
			void handle(request);
		});
		window.electronAPI.automationReady();
		return remove;
	}, []);
}
