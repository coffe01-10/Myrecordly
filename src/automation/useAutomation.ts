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
import type { useAppearanceState } from "@/components/video-editor/state/useAppearanceState";
import type { useEditorUiState } from "@/components/video-editor/state/useEditorUiState";
import { applyEditCommands, timelineDuration } from "./editCommands";
import type { RenderContext } from "./renderTypes";
import { findSmartCutCandidates } from "@/components/video-editor/smartCut/smartCutPlan";
import type { SmartCutAnalysis } from "@/types/smartCut";

type Input = {
	appearance: ReturnType<typeof useAppearanceState>;
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
		const durationMs = timelineDuration(timeline.clipRegions);
		return {
			projectId: project.lastSavedSnapshot?.projectId,
			revision: revision.current,
			projectPath: project.currentProjectPath,
			sourcePath: controller.snapshot.currentSourcePath,
			sourceDurationMs: ui.duration * 1000,
			durationMs,
			ready: isPreviewReady && !project.loading,
			error: project.error,
			canUndo: controller.history.canUndo,
			canRedo: controller.history.canRedo,
			playback: {
				timeMs: Math.round(ui.currentTime * 1000),
				playing: ui.isPlaying,
				durationMs,
			},
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
				const { controller, project, timeline, ui, appearance } = current.current;
				let result: unknown;
				switch (command) {
					case "get_project":
						result = snapshotRef.current();
						break;
					case "list_recordings": {
						const listed = await window.electronAPI.listRecordings?.();
						if (!listed?.success)
							throw new Error(listed?.error ?? "Could not list recordings");
						const recordings = listed.value;
						result = {
							recordings: recordings.map((item) => ({
								path: item.path,
								name: item.name,
								bytes: item.bytes,
								createdAt: item.createdAt,
							})),
						};
						break;
					}
					case "list_projects": {
						const listed = await window.electronAPI.listProjectFiles?.();
						result = {
							projectsDir: listed?.projectsDir ?? null,
							projects: (listed?.entries ?? []).map((item) => ({
								path: item.path,
								name: item.name,
								updatedAt: item.updatedAt,
								videoPath: "videoPath" in item ? item.videoPath : undefined,
							})),
						};
						break;
					}
					case "playback": {
						const active = snapshotRef.current();
						const playback = ui.videoPlaybackRef.current;
						if (!playback) throw new Error("Video preview is still loading");
						const action = args.action;
						if (action === "seek") {
							const timeMs = Number(args.timeMs);
							if (
								!Number.isFinite(timeMs) ||
								timeMs < 0 ||
								timeMs > active.durationMs
							)
								throw new Error("timeMs must be inside the edited timeline");
							playback.pause();
							playback.seekTimeline(timeMs / 1000);
							ui.setIsPlaying(false);
						} else if (action === "play") {
							await playback.play();
							ui.setIsPlaying(true);
						} else if (action === "pause") {
							playback.pause();
							ui.setIsPlaying(false);
						} else {
							throw new Error("action must be play, pause, or seek");
						}
						result = {
							timeMs: playback.timeMs,
							playing: playback.isPlaying,
							durationMs: active.durationMs,
						};
						break;
					}
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
							appearance.setWallpaper(next.wallpaper);
							appearance.setShadowIntensity(next.shadowIntensity);
							appearance.setBackgroundBlur(next.backgroundBlur);
							appearance.setZoomMotionBlur(next.zoomMotionBlur);
							appearance.setConnectZooms(next.connectZooms);
							appearance.setZoomInDurationMs(next.zoomInDurationMs);
							appearance.setZoomInOverlapMs(next.zoomInOverlapMs);
							appearance.setZoomOutDurationMs(next.zoomOutDurationMs);
							appearance.setConnectedZoomGapMs(next.connectedZoomGapMs);
							appearance.setConnectedZoomDurationMs(next.connectedZoomDurationMs);
							appearance.setZoomInEasing(next.zoomInEasing);
							appearance.setZoomOutEasing(next.zoomOutEasing);
							appearance.setConnectedZoomEasing(next.connectedZoomEasing);
							appearance.setShowCursor(next.showCursor);
							appearance.setLoopCursor(next.loopCursor);
							appearance.setCursorStyle(next.cursorStyle);
							appearance.setCursorSize(next.cursorSize);
							appearance.setCursorSmoothing(next.cursorSmoothing);
							appearance.setCursorMotionBlur(next.cursorMotionBlur);
							appearance.setCursorClickEffect(next.cursorClickEffect);
							appearance.setCursorClickEffectColor(next.cursorClickEffectColor);
							appearance.setCursorClickEffectScale(next.cursorClickEffectScale);
							appearance.setCursorClickEffectOpacity(next.cursorClickEffectOpacity);
							appearance.setCursorClickEffectDurationMs(
								next.cursorClickEffectDurationMs,
							);
							appearance.setCursorClickBounce(next.cursorClickBounce);
							appearance.setCursorClickBounceDuration(next.cursorClickBounceDuration);
							appearance.setCursorSway(next.cursorSway);
							appearance.setBorderRadius(next.borderRadius);
							appearance.setPadding(next.padding);
							appearance.setCropRegion(next.cropRegion);
							appearance.setWebcam(next.webcam);
							ui.setAspectRatio(next.aspectRatio);
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
					case "plan_edits": {
						const active = snapshotRef.current();
						const editor = normalizeProjectEditor(active.editor);
						const next = applyEditCommands(
							editor,
							args.edits as Edit[],
							active.sourceDurationMs,
						);
						result = {
							...active,
							clips: next.clipRegions,
							durationMs: timelineDuration(next.clipRegions),
							editor: next,
						};
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
