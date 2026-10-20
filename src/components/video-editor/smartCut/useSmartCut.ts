import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/contexts/I18nContext";
import type { SmartCutAnalysis } from "@/types/smartCut";
import { mapClipSequenceTime, rippleRegionAnchors, rippleRegions } from "../clipSequence";
import type { useEditorUiState } from "../state/useEditorUiState";
import type { useTimelineState } from "../state/useTimelineState";
import type { CursorTelemetryPoint } from "../types";
import { supportsPreviewPlaybackRate } from "../videoPlayback/playbackRate";
import {
	buildSmartCutPlan,
	findSmartCutCandidates,
	type SmartCutAction,
	type SmartCutCandidate,
} from "./smartCutPlan";

export function useSmartCut(
	sourcePath: string | null,
	timeline: ReturnType<typeof useTimelineState>,
	ui: ReturnType<typeof useEditorUiState>,
	telemetry: CursorTelemetryPoint[],
	startPlayback: () => void,
) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const [analysis, setAnalysis] = useState<SmartCutAnalysis | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [minPauseMs, setMinPauseMs] = useState(2000);
	const [actions, setActions] = useState<Record<string, SmartCutAction>>({});
	const [previewId, setPreviewId] = useState<string | null>(null);
	const previewEnd = useRef<number | null>(null);
	const pendingSeek = useRef<number | null>(null);
	const request = useRef<string | null>(null);
	const playbackRef = ui.videoPlaybackRef;
	const cancel = useCallback(() => {
		const id = request.current;
		request.current = null;
		if (id) void window.electronAPI.cancelSmartCut?.(id);
		setBusy(false);
	}, []);
	const stopPreview = useCallback(() => {
		if (previewEnd.current !== null) playbackRef.current?.pause();
		previewEnd.current = null;
		setPreviewId(null);
	}, [playbackRef]);
	const close = useCallback(() => {
		cancel();
		stopPreview();
		setOpen(false);
	}, [cancel, stopPreview]);
	useEffect(() => {
		// Analysis and decisions belong to this media file, never to the next project.
		void sourcePath;
		cancel();
		stopPreview();
		setAnalysis(null);
		pendingSeek.current = null;
		setActions({});
		setError(null);
		setOpen(false);
		return () => {
			const id = request.current;
			request.current = null;
			if (id) void window.electronAPI.cancelSmartCut?.(id);
			if (previewEnd.current !== null) playbackRef.current?.pause();
		};
	}, [sourcePath, cancel, stopPreview, playbackRef]);
	useEffect(() => {
		if (previewEnd.current !== null && ui.currentTime * 1000 >= previewEnd.current)
			stopPreview();
	}, [ui.currentTime, stopPreview]);
	useEffect(() => {
		void timeline.clipRegions;
		stopPreview();
		setActions({});
		if (pendingSeek.current !== null) {
			playbackRef.current?.seekTimeline(pendingSeek.current);
			pendingSeek.current = null;
		}
	}, [timeline.clipRegions, stopPreview, playbackRef]);
	const candidates = useMemo(() => {
		if (!analysis) return [];
		return findSmartCutCandidates(
			analysis,
			timeline.clipRegions,
			telemetry,
			timeline.audioRegions,
			minPauseMs,
		).map((item) => ({ ...item, action: actions[item.id] ?? item.action }));
	}, [analysis, timeline.clipRegions, telemetry, timeline.audioRegions, minPauseMs, actions]);
	const plan = useMemo(() => {
		let id = 0;
		return buildSmartCutPlan(timeline.clipRegions, candidates, () => `smart-preview-${id++}`);
	}, [timeline.clipRegions, candidates]);
	const analyze = async () => {
		if (!sourcePath) return;
		cancel();
		stopPreview();
		playbackRef.current?.pause();
		const id = crypto.randomUUID();
		request.current = id;
		setBusy(true);
		setError(null);
		setAnalysis(null);
		setActions({});
		try {
			const result = await window.electronAPI.analyzeSmartCut({
				videoPath: sourcePath,
				requestId: id,
			});
			if (request.current !== id) return;
			if (result.success) setAnalysis(result.analysis);
			else if (!result.canceled)
				setError(
					result.error ??
						t("editor.smartCut.failed", "Analysis failed. Please try again."),
				);
		} catch (cause) {
			if (request.current === id) setError(String(cause));
		} finally {
			if (request.current === id) {
				request.current = null;
				setBusy(false);
			}
		}
	};
	const preview = (item: SmartCutCandidate) => {
		if (item.id === previewId) {
			stopPreview();
			return;
		}
		stopPreview();
		playbackRef.current?.pause();
		playbackRef.current?.seekTimeline(Math.max(0, item.startMs - 500) / 1000);
		previewEnd.current = Math.min(
			item.endMs + 500,
			Math.max(0, ...timeline.clipRegions.map((clip) => clip.endMs)),
		);
		setPreviewId(item.id);
		startPlayback();
	};
	const apply = () => {
		if (plan.savedMs <= 0) return;
		if (candidates.some((item) => item.action === "speed") && !supportsPreviewPlaybackRate(4)) {
			toast.error(
				t(
					"editor.timeline.unsupportedSpeed",
					"This speed is not supported for preview on this device.",
				),
			);
			return;
		}
		const next = buildSmartCutPlan(
			timeline.clipRegions,
			candidates,
			() => `clip-${ui.nextClipIdRef.current++}`,
		);
		stopPreview();
		playbackRef.current?.pause();
		timeline.setZoomRegions(rippleRegions(timeline.zoomRegions, next.before, next.after));
		timeline.setAnnotationRegions(
			rippleRegions(timeline.annotationRegions, next.before, next.after),
		);
		timeline.setAudioRegions(
			rippleRegionAnchors(timeline.audioRegions, next.before, next.after),
		);
		const audioSettings = { ...timeline.sourceAudioTrackSettingsByClip };
		for (const [id, parent] of next.parents) {
			if (audioSettings[parent]) audioSettings[id] = audioSettings[parent];
		}
		timeline.setSourceAudioTrackSettingsByClip(audioSettings);
		timeline.setSelectedClipId(null);
		timeline.setSelectedZoomId(null);
		timeline.setSelectedAnnotationId(null);
		timeline.setSelectedAudioId(null);
		timeline.setSelectedCaptionId(null);
		timeline.setClipRegions(next.after);
		// Captions are source-timed and project automatically through the new clips.
		pendingSeek.current =
			mapClipSequenceTime(ui.currentTime * 1000, next.before, next.after) / 1000;
		setAnalysis(null);
		setOpen(false);
		toast.success(
			t("editor.smartCut.applied", "Smart cut applied. Undo restores the entire edit."),
		);
	};
	return {
		open,
		setOpen,
		close,
		busy,
		error,
		analysis,
		analyze,
		cancel,
		candidates,
		minPauseMs,
		setMinPauseMs,
		preview,
		previewId,
		savedMs: plan.savedMs,
		apply,
		setAction: (id: string, action: SmartCutAction) =>
			setActions((current) => ({ ...current, [id]: action })),
		setAll: (action: SmartCutAction) =>
			setActions(Object.fromEntries(candidates.map((item) => [item.id, action]))),
	};
}
