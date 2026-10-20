import type { SmartCutAnalysis } from "@/types/smartCut";
import { packClipSequence } from "../clipSequence";
import {
	type AudioRegion,
	type ClipRegion,
	type CursorTelemetryPoint,
	getClipSourceEndMs,
	getClipSourceStartMs,
	sortClipRegions,
} from "../types";

export type SmartCutAction = "keep" | "delete" | "speed";
export interface SmartCutCandidate {
	id: string;
	clipId: string;
	startMs: number;
	endMs: number;
	activity: "active" | "idle" | "unknown";
	hasAddedAudio: boolean;
	action: SmartCutAction;
}

export function findSmartCutCandidates(
	analysis: SmartCutAnalysis,
	clips: ClipRegion[],
	telemetry: CursorTelemetryPoint[],
	audio: AudioRegion[],
	minPauseMs: number,
): SmartCutCandidate[] {
	const points = [...telemetry].sort((a, b) => a.timeMs - b.timeMs);
	return sortClipRegions(clips).flatMap((clip) => {
		const sourceStart = getClipSourceStartMs(clip);
		const sourceEnd = getClipSourceEndMs(clip);
		return analysis.intervals.flatMap((pause) => {
			const start = Math.max(sourceStart, pause.startMs);
			const end = Math.min(sourceEnd, pause.endMs);
			if ((end - start) / clip.speed < minPauseMs) return [];
			// Keep 250 ms of source on each side for natural speech boundaries.
			const cutStart = start + 250;
			const cutEnd = end - 250;
			if (cutEnd <= cutStart) return [];
			const startMs = clip.startMs + (cutStart - sourceStart) / clip.speed;
			const endMs = clip.startMs + (cutEnd - sourceStart) / clip.speed;
			let low = 0;
			let high = points.length;
			while (low < high) {
				const mid = (low + high) >>> 1;
				if (points[mid].timeMs < cutStart) low = mid + 1;
				else high = mid;
			}
			const anchor = points[Math.max(0, low - 1)];
			let active = false;
			for (let i = low; i < points.length && points[i].timeMs <= cutEnd; i++) {
				const point = points[i];
				if (
					(point.interactionType && point.interactionType !== "move") ||
					(point.pressure ?? 0) > 0 ||
					(anchor && Math.hypot(point.cx - anchor.cx, point.cy - anchor.cy) > 0.006)
				) {
					active = true;
					break;
				}
			}
			const covered =
				points.length > 1 &&
				points[0].timeMs <= cutStart &&
				points[points.length - 1].timeMs >= cutEnd - 500;
			const activity = active ? "active" : covered ? "idle" : "unknown";
			const hasAddedAudio = audio.some(
				(region) => region.volume > 0 && region.endMs > startMs && region.startMs < endMs,
			);
			return [
				{
					id: `${clip.id}:${cutStart}:${cutEnd}`,
					clipId: clip.id,
					startMs,
					endMs,
					activity,
					hasAddedAudio,
					action:
						analysis.hasAudio && activity === "idle" && !hasAddedAudio
							? "delete"
							: "keep",
				} satisfies SmartCutCandidate,
			];
		});
	});
}

/** Split first, then ripple by fragment identity so effects retain their source position. */
export function buildSmartCutPlan(
	clips: ClipRegion[],
	candidates: SmartCutCandidate[],
	createId: () => string,
) {
	const before: ClipRegion[] = [];
	const retained: ClipRegion[] = [];
	const parents = new Map<string, string>();
	for (const clip of sortClipRegions(clips)) {
		const edits = candidates
			.filter((item) => item.clipId === clip.id && item.action !== "keep")
			.sort((a, b) => a.startMs - b.startMs);
		if (edits.length === 0) {
			before.push(clip);
			retained.push(clip);
			continue;
		}
		let cursor = clip.startMs;
		const append = (endMs: number, action: SmartCutAction) => {
			if (endMs <= cursor) return;
			const fragment: ClipRegion = {
				...clip,
				id: createId(),
				startMs: cursor,
				endMs,
				sourceStartMs: getClipSourceStartMs(clip) + (cursor - clip.startMs) * clip.speed,
			};
			before.push(fragment);
			parents.set(fragment.id, clip.id);
			if (action !== "delete") {
				// 4x absolute speed never slows an already faster clip down.
				const speed = action === "speed" ? Math.max(4, clip.speed) : clip.speed;
				retained.push({
					...fragment,
					speed,
					endMs: cursor + ((endMs - cursor) * clip.speed) / speed,
				});
			}
			cursor = endMs;
		};
		for (const edit of edits) {
			append(Math.max(cursor, Math.min(edit.startMs, clip.endMs)), "keep");
			append(Math.max(cursor, Math.min(edit.endMs, clip.endMs)), edit.action);
		}
		append(clip.endMs, "keep");
	}
	const after = packClipSequence(retained);
	const oldDuration = Math.max(0, ...clips.map((clip) => clip.endMs));
	const newDuration = Math.max(0, ...after.map((clip) => clip.endMs));
	return { before, after, parents, savedMs: oldDuration - newDuration };
}
