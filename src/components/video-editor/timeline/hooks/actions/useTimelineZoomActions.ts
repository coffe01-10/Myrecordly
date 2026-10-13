import type { Span } from "dnd-timeline";
import { useCallback, useEffect, useMemo } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import type { CursorTelemetryPoint, ZoomFocus, ZoomRegion } from "../../../types";
import { buildInteractionZoomSuggestions } from "../../zoomSuggestionUtils";
import { timelineNotifications } from "../utils/timelineNotifications";

interface UseTimelineZoomActionsParams {
	timeline: {
		videoDuration: number;
		totalMs: number;
		currentTimeMs: number;
	};
	regions: {
		zoom: ZoomRegion[];
		clip: { startMs: number; endMs: number }[];
	};
	cursorTelemetry: CursorTelemetryPoint[];
	options: {
		disableSuggestedZooms: boolean;
	};
	autoSuggestZoomsTrigger: number;
	onAutoSuggestZoomsConsumed?: () => void;
	onZoomAdded: (span: Span) => void;
	onZoomSuggested?: (span: Span, focus: ZoomFocus) => void;
}

export function useTimelineZoomActions({
	timeline,
	regions,
	cursorTelemetry,
	options,
	autoSuggestZoomsTrigger,
	onAutoSuggestZoomsConsumed,
	onZoomAdded,
	onZoomSuggested,
}: UseTimelineZoomActionsParams) {
	const { videoDuration, totalMs, currentTimeMs } = timeline;
	const { zoom: zoomRegions, clip: clipRegions } = regions;
	const { disableSuggestedZooms } = options;
	const t = useScopedT("timeline");
	const defaultRegionDurationMs = useMemo(() => Math.min(1000, totalMs), [totalMs]);

	const canPlaceZoomAtMs = useCallback(
		(startMs: number) => {
			if (!videoDuration || videoDuration === 0 || totalMs === 0) {
				return false;
			}

			const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
			if (defaultDuration <= 0) {
				return false;
			}

			const startPos = Math.max(0, Math.min(startMs, totalMs));
			const activeClip =
				clipRegions.length === 0
					? { startMs: 0, endMs: totalMs }
					: clipRegions.find((clip) => startPos >= clip.startMs && startPos < clip.endMs);
			if (!activeClip) {
				return false;
			}

			const sorted = [...zoomRegions].sort((a, b) => a.startMs - b.startMs);
			const nextRegion = sorted.find((region) => region.startMs > startPos);
			const gapToNextClipEdge = activeClip.endMs - startPos;
			const gapToNextRegion = nextRegion ? nextRegion.startMs - startPos : gapToNextClipEdge;
			const availableDuration = Math.min(gapToNextClipEdge, gapToNextRegion);

			const isOverlapping = sorted.some(
				(region) => startPos >= region.startMs && startPos < region.endMs,
			);

			return !isOverlapping && availableDuration >= defaultDuration;
		},
		[videoDuration, totalMs, defaultRegionDurationMs, clipRegions, zoomRegions],
	);

	const addZoomAtMs = useCallback(
		(startMs: number) => {
			if (!videoDuration || videoDuration === 0 || totalMs === 0) {
				return;
			}

			const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
			if (defaultDuration <= 0) {
				return;
			}

			const startPos = Math.max(0, Math.min(startMs, totalMs));
			if (!canPlaceZoomAtMs(startPos)) {
				timelineNotifications.error(
					t("zoom.cannotPlace"),
					t("zoom.notEnoughRoom"),
				);
				return;
			}

			onZoomAdded({ start: startPos, end: startPos + defaultDuration });
		},
		[videoDuration, totalMs, defaultRegionDurationMs, canPlaceZoomAtMs, onZoomAdded, t],
	);

	const handleAddZoom = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0) {
			return;
		}

		addZoomAtMs(currentTimeMs);
	}, [videoDuration, totalMs, currentTimeMs, addZoomAtMs]);

	const handleSuggestZooms = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0) {
			return;
		}

		if (disableSuggestedZooms) {
			timelineNotifications.info(t("zoom.suggestUnavailableLoop"));
			return;
		}

		if (!onZoomSuggested) {
			timelineNotifications.error(t("zoom.suggestHandlerUnavailable"));
			return;
		}

		if (cursorTelemetry.length < 2) {
			timelineNotifications.info(t("zoom.noTelemetry"), t("zoom.recordFirst"));
			return;
		}

		const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
		if (defaultDuration <= 0) {
			return;
		}

		const result = buildInteractionZoomSuggestions({
			cursorTelemetry,
			totalMs,
			defaultDurationMs: defaultDuration,
			reservedSpans: zoomRegions
				.map((region) => ({ start: region.startMs, end: region.endMs }))
				.sort((a, b) => a.start - b.start),
		});

		if (result.status === "no-telemetry") {
			timelineNotifications.info(t("zoom.noUsableTelemetry"), t("zoom.notEnoughMovement"));
			return;
		}

		if (result.status === "no-interactions") {
			timelineNotifications.info(t("zoom.noInteractionMoments"), t("zoom.tryRecording"));
			return;
		}

		if (result.status === "no-slots" || result.suggestions.length === 0) {
			timelineNotifications.info(t("zoom.noAutoZoomSlots"), t("zoom.dwellPointsOverlap"));
			return;
		}

		for (const region of result.suggestions) {
			onZoomSuggested({ start: region.start, end: region.end }, region.focus);
		}

		timelineNotifications.success(
			t("zoom.addedSuggestions", undefined, { count: result.suggestions.length }),
		);
	}, [
		videoDuration,
		totalMs,
		disableSuggestedZooms,
		onZoomSuggested,
		cursorTelemetry,
		defaultRegionDurationMs,
		zoomRegions,
		t,
	]);

	useEffect(() => {
		if (autoSuggestZoomsTrigger <= 0) {
			return;
		}

		onAutoSuggestZoomsConsumed?.();
		handleSuggestZooms();
	}, [autoSuggestZoomsTrigger, handleSuggestZooms, onAutoSuggestZoomsConsumed]);

	return {
		defaultRegionDurationMs,
		canPlaceZoomAtMs,
		addZoomAtMs,
		handleAddZoom,
		handleSuggestZooms,
	};
}
