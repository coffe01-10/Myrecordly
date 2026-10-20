import { describe, expect, it } from "vitest";
import { normalizeProjectEditor } from "@/components/video-editor/projectPersistence";
import { applyEditCommands, previewEditor, timelineDuration } from "./editCommands";

const editor = () =>
	normalizeProjectEditor({
		clipRegions: [
			{ id: "a", startMs: 0, endMs: 4000, sourceStartMs: 1000, speed: 2 },
			{ id: "b", startMs: 4000, endMs: 6000, sourceStartMs: 0, speed: 1 },
		],
		zoomRegions: [
			{ id: "z", startMs: 2500, endMs: 3500, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
		],
		annotationRegions: [],
		audioRegions: [
			{ id: "music", startMs: 5000, endMs: 7000, audioPath: "music.wav", volume: 1 },
		],
		autoCaptions: [{ id: "cue", startMs: 6000, endMs: 7500, text: "source caption" }],
		sourceAudioTrackSettingsByClip: { a: { embedded: { volume: 0.4, muted: false } } },
	});
describe("automation edit batches", () => {
	it("maps captions beginning at source zero and selects the correct side of a source cut", () => {
		const input = normalizeProjectEditor({
			clipRegions: [
				{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 },
				{ id: "b", startMs: 1000, endMs: 2000, sourceStartMs: 4000, speed: 1 },
			],
		});
		const next = applyEditCommands(
			input,
			[
				{ type: "caption", timeBase: "timeline", startMs: 0, endMs: 500, text: "开始" },
				{
					type: "caption",
					timeBase: "timeline",
					startMs: 1000,
					endMs: 1500,
					text: "切换后",
				},
			],
			5000,
		);
		expect(next.autoCaptions.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
			[0, 500],
			[4000, 4500],
		]);
		expect(() =>
			applyEditCommands(
				input,
				[
					{
						type: "caption",
						timeBase: "timeline",
						startMs: 500,
						endMs: 1500,
						text: "跨片段",
					},
				],
				5000,
			),
		).toThrow("inside one timeline clip");
	});
	it("maps source deletion through sped/repeated footage and ripples effects and audio", () => {
		const next = applyEditCommands(
			editor(),
			[{ type: "delete", timeBase: "source", startMs: 1000, endMs: 2000 }],
			9000,
		);
		expect(timelineDuration(next.clipRegions)).toBe(4500);
		expect(next.clipRegions.map((clip) => clip.sourceStartMs)).toEqual([2000, 0]);
		expect(next.zoomRegions[0]).toMatchObject({ startMs: 2000, endMs: 3000 });
		expect(next.audioRegions[0]).toMatchObject({ startMs: 4500, endMs: 6500 });
		expect(next.autoCaptions[0]).toMatchObject({ startMs: 6000, endMs: 7500 });
		expect(next.sourceAudioTrackSettingsByClip?.[next.clipRegions[0].id]).toEqual(
			editor().sourceAudioTrackSettingsByClip?.a,
		);
	});
	it("sets absolute speed and preserves source in-points across later edits", () => {
		const next = applyEditCommands(
			editor(),
			[{ type: "speed", timeBase: "timeline", startMs: 1000, endMs: 2000, speed: 4 }],
			9000,
		);
		expect(
			next.clipRegions.map((clip) => [
				clip.startMs,
				clip.endMs,
				clip.sourceStartMs,
				clip.speed,
			]),
		).toEqual([
			[0, 1000, 1000, 2],
			[1000, 1500, 3000, 4],
			[1500, 3500, 5000, 2],
			[3500, 5500, 0, 1],
		]);
	});
	it("publishes no partial state if a later edit in a batch is invalid", () => {
		const original = editor();
		const before = structuredClone(original);
		expect(() =>
			applyEditCommands(
				original,
				[
					{ type: "split", atMs: 500 },
					{ type: "speed", timeBase: "timeline", startMs: 0, endMs: 500, speed: 0 },
				],
				9000,
			),
		).toThrow();
		expect(original).toEqual(before);
	});
	it("keeps source time for captions, adds text and zoom, and removes individual effects", () => {
		let counter = 0;
		const next = applyEditCommands(
			editor(),
			[
				{ type: "caption", startMs: 500, endMs: 1000, text: "new" },
				{ type: "text", startMs: 100, endMs: 1000, text: "title", x: 25 },
				{ type: "zoom", startMs: 100, endMs: 1000, depth: 3, cx: 0.2, cy: 0.7 },
				{ type: "remove_effect", id: "z" },
			],
			9000,
			() => `effect-${++counter}`,
		);
		expect(next.autoCaptionSettings.enabled).toBe(true);
		expect(next.annotationRegions[0]).toMatchObject({
			textContent: "title",
			position: { x: 25, y: 50 },
		});
		expect(next.zoomRegions).toHaveLength(1);
		expect(next.zoomRegions[0].focus).toEqual({ cx: 0.2, cy: 0.7 });
	});
	it("adds annotations and audio, changes appearance, and updates clip volume", () => {
		const next = applyEditCommands(
			editor(),
			[
				{
					type: "annotation",
					kind: "figure",
					startMs: 100,
					endMs: 800,
					arrow: "right",
					color: "#ff0000",
				},
				{ type: "audio", audioPath: "voice.wav", startMs: 0, endMs: 1000, volume: 0.5 },
				{ type: "audio_volume", clipId: "a", volume: 0.2 },
				{
					type: "set_appearance",
					appearance: { showCursor: false, wallpaper: "solid:#111" },
				},
			],
			9000,
			() => "added",
		);
		expect(next.annotationRegions[0]).toMatchObject({
			type: "figure",
			figureData: { arrowDirection: "right", color: "#ff0000" },
		});
		expect(next.audioRegions.at(-1)).toMatchObject({ audioPath: "voice.wav", volume: 0.5 });
		expect(next.sourceAudioTrackSettingsByClip?.a.embedded).toMatchObject({ volume: 0.2 });
		expect(next.showCursor).toBe(false);
		expect(next.wallpaper).toBe("solid:#111");
		expect(next.clipRegions.map((clip) => clip.id)).toEqual(["a", "b"]);
	});
	it("places a timeline caption onto the source time of the kept clip", () => {
		const next = applyEditCommands(
			editor(),
			[{ type: "caption", timeBase: "timeline", startMs: 4500, endMs: 5500, text: "kept" }],
			9000,
		);
		expect(next.autoCaptions.at(-1)).toMatchObject({
			startMs: 500,
			endMs: 1500,
			text: "kept",
		});
	});
	it("reorders complete clips, keeps audio duration, and mutes by stable id", () => {
		const next = applyEditCommands(
			editor(),
			[
				{ type: "reorder", clipId: "b", index: 0 },
				{ type: "mute", clipId: "a", muted: true },
			],
			9000,
		);
		expect(next.clipRegions.map((clip) => clip.id)).toEqual(["b", "a"]);
		expect(next.clipRegions[1]).toMatchObject({
			sourceStartMs: 1000,
			startMs: 2000,
			muted: true,
		});
		expect(next.audioRegions[0].endMs - next.audioRegions[0].startMs).toBe(2000);
	});
	it("trims preview using edited timeline positions without modifying the open editor", () => {
		const original = editor();
		const next = previewEditor(original, 1000, 4500, 9000);
		expect(timelineDuration(next.clipRegions)).toBe(3500);
		expect(next.clipRegions[0]).toMatchObject({ startMs: 0, sourceStartMs: 3000 });
		expect(next.clipRegions[1]).toMatchObject({ sourceStartMs: 0, endMs: 3500 });
		expect(timelineDuration(original.clipRegions)).toBe(6000);
	});
	it("represents deleting all footage with an empty explicit clip list", () => {
		const next = applyEditCommands(
			editor(),
			[{ type: "delete", timeBase: "timeline", startMs: 0, endMs: 6000 }],
			9000,
		);
		expect(next.clipRegions).toEqual([]);
		expect(next.zoomRegions).toEqual([]);
	});
});
