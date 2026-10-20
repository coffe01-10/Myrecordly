import { describe, expect, it } from "vitest";
import { projectCaptionCues } from "../captionTimeline";
import { rippleRegionAnchors, rippleRegions } from "../clipSequence";
import {
	createEditorHistoryStack,
	type EditorHistorySnapshot,
	recordEditorHistorySnapshot,
	redoEditorHistoryStack,
	undoEditorHistoryStack,
} from "../editorHistory";
import type { ClipRegion } from "../types";
import { buildSmartCutPlan, findSmartCutCandidates, type SmartCutCandidate } from "./smartCutPlan";

const clip: ClipRegion = {
	id: "clip-1",
	startMs: 0,
	endMs: 10000,
	sourceStartMs: 0,
	speed: 1,
	muted: true,
};
const analysis = { durationMs: 10000, hasAudio: true, intervals: [{ startMs: 2000, endMs: 6000 }] };
const idle = [
	{ timeMs: 0, cx: 0.5, cy: 0.5 },
	{ timeMs: 10000, cx: 0.5, cy: 0.5 },
];
const edit = (
	startMs: number,
	endMs: number,
	action: SmartCutCandidate["action"],
): SmartCutCandidate => ({
	id: `${startMs}`,
	clipId: clip.id,
	startMs,
	endMs,
	action,
	activity: "idle",
	hasAddedAudio: false,
});
const plan = (edits: SmartCutCandidate[], clips = [clip]) => {
	let id = 2;
	return buildSmartCutPlan(clips, edits, () => `clip-${id++}`);
};

describe("smart cut candidates", () => {
	it("pads pauses and maps source times through reordered, sped-up footage", () => {
		const clips = [{ ...clip, sourceStartMs: 2000, speed: 2, endMs: 4000 }];
		const candidates = findSmartCutCandidates(analysis, clips, idle, [], 2000);
		expect(candidates[0]).toMatchObject({ startMs: 125, endMs: 1875, action: "delete" });
		expect(findSmartCutCandidates(analysis, clips, idle, [], 3000)).toEqual([]);
	});
	it("keeps clicks, slow cursor movement, unknown telemetry, and added narration by default", () => {
		const click = [
			...idle,
			{ timeMs: 3000, cx: 0.5, cy: 0.5, interactionType: "click" as const },
		];
		const slow = [
			...idle,
			...Array.from({ length: 10 }, (_, i) => ({
				timeMs: 2300 + i * 100,
				cx: 0.5 + i * 0.002,
				cy: 0.5,
			})),
		];
		for (const points of [click, slow, []]) {
			expect(findSmartCutCandidates(analysis, [clip], points, [], 2000)[0].action).toBe(
				"keep",
			);
		}
		const audio = [{ id: "a", startMs: 3000, endMs: 4000, audioPath: "voice.wav", volume: 1 }];
		expect(findSmartCutCandidates(analysis, [clip], idle, audio, 2000)[0]).toMatchObject({
			action: "keep",
			hasAddedAudio: true,
		});
	});
	it("does not assume a silent imported video is disposable", () => {
		expect(
			findSmartCutCandidates({ ...analysis, hasAudio: false }, [clip], idle, [], 2000)[0]
				.action,
		).toBe("keep");
	});
});

describe("smart cut edit plan", () => {
	it("deletes a middle span while preserving source in-points, settings, and connected effects", () => {
		const result = plan([edit(2000, 6000, "delete")]);
		expect(result.savedMs).toBe(4000);
		expect(
			result.after.map(({ startMs, endMs, sourceStartMs, muted }) => ({
				startMs,
				endMs,
				sourceStartMs,
				muted,
			})),
		).toEqual([
			{ startMs: 0, endMs: 2000, sourceStartMs: 0, muted: true },
			{ startMs: 2000, endMs: 6000, sourceStartMs: 6000, muted: true },
		]);
		expect(
			rippleRegions([{ startMs: 6500, endMs: 8000 }], result.before, result.after),
		).toEqual([{ startMs: 2500, endMs: 4000 }]);
		expect(
			rippleRegions([{ startMs: 2500, endMs: 5000 }], result.before, result.after),
		).toEqual([]);
		expect(
			rippleRegionAnchors([{ startMs: 6500, endMs: 8500 }], result.before, result.after),
		).toEqual([{ startMs: 2500, endMs: 4500 }]);
		const cues = projectCaptionCues(
			[{ id: "c", startMs: 6500, endMs: 8000, text: "hello" }],
			result.after,
		);
		expect(cues[0]).toMatchObject({ startMs: 2500, endMs: 4000, text: "hello" });
	});
	it("combines delete and 4x acceleration without losing source coverage", () => {
		const result = plan([edit(1000, 3000, "delete"), edit(5000, 9000, "speed")]);
		expect(result.savedMs).toBe(5000);
		expect(result.after.map((c) => [c.startMs, c.endMs, c.sourceStartMs, c.speed])).toEqual([
			[0, 1000, 0, 1],
			[1000, 3000, 3000, 1],
			[3000, 4000, 5000, 4],
			[4000, 5000, 9000, 1],
		]);
	});
	it("preserves repeated source occurrences and already-fast clips", () => {
		const repeated = { ...clip, id: "clip-repeat", startMs: 10000, endMs: 20000 };
		const result = plan([edit(2000, 6000, "delete")], [clip, repeated]);
		expect(result.after.at(-1)).toMatchObject({
			id: repeated.id,
			startMs: 6000,
			endMs: 16000,
			sourceStartMs: 0,
		});
		const fast = plan([edit(200, 600, "speed")], [{ ...clip, endMs: 1000, speed: 8 }]);
		expect(fast.savedMs).toBe(0);
		expect(fast.after.every((c) => c.speed === 8)).toBe(true);
	});
	it("keeps the original sequence for a no-op", () => {
		const result = plan([edit(2000, 6000, "keep")]);
		expect(result.after).toEqual([clip]);
		expect(result.savedMs).toBe(0);
	});
	it("restores a batch edit and per-clip audio settings with one undo and redo", () => {
		const before: EditorHistorySnapshot = {
			clipRegions: [clip],
			zoomRegions: [],
			speedRegions: [],
			annotationRegions: [],
			audioRegions: [],
			autoCaptions: [],
			selectedZoomId: null,
			selectedClipId: null,
			selectedAnnotationId: null,
			selectedAudioId: null,
			sourceAudioTrackSettingsByClip: {
				[clip.id]: { mic: { volume: 0.4, normalize: true } },
			},
		};
		const result = plan([edit(2000, 6000, "delete")]);
		const after = {
			...before,
			clipRegions: result.after,
			sourceAudioTrackSettingsByClip: {
				...before.sourceAudioTrackSettingsByClip,
				[result.after[1].id]: { mic: { volume: 0.4, normalize: true } },
			},
		};
		const stack = createEditorHistoryStack();
		recordEditorHistorySnapshot(stack, before);
		recordEditorHistorySnapshot(stack, after);
		expect(undoEditorHistoryStack(stack, after)).toEqual(before);
		expect(redoEditorHistoryStack(stack, before)).toEqual(after);
	});
});
