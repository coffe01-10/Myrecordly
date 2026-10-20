import { describe, expect, it, vi } from "vitest";
import { clicksToZooms, keepSegmentsEdits, searchVideo, segmentVideo } from "./videoContent";
import { planVideoTask } from "./editTask";
import type {
	IndexedSegment,
	ProjectSnapshot,
	VideoIndex,
} from "../../packages/automation/src/types";
import { applyEditCommands, timelineDuration } from "../../src/automation/editCommands";
import { normalizeProjectEditor } from "../../src/components/video-editor/projectPersistence";
import { requestVideoModel } from "./vision";
import { mediaToolResult } from "../../packages/automation/src/mediaResult";
vi.mock("./vision", () => ({ requestVideoModel: vi.fn() }));

const segment = (n: number): IndexedSegment => ({
	id: `v:${n}`,
	startMs: (n - 1) * 2000,
	endMs: n * 2000,
	description: "",
	keywords: [],
	transcript: [],
	frames: [],
	clicks: [],
});
const index = (): VideoIndex => ({
	id: "v",
	path: "video.mp4",
	durationMs: 6000,
	width: 640,
	height: 360,
	hasAudio: true,
	audioTracks: [],
	sourceSize: 1,
	sourceModifiedMs: 1,
	timeBase: "source",
	createdAt: "",
	capabilities: { transcript: "provided", ocr: "ready", vision: "disabled" },
	notes: [],
	silences: [],
	segments: [segment(1), segment(2), segment(3)],
});
function project(): ProjectSnapshot {
	const editor = normalizeProjectEditor({
		clipRegions: [{ id: "a", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }],
	});
	return {
		revision: 1,
		sourcePath: "video.mp4",
		projectPath: null,
		sourceDurationMs: 6000,
		durationMs: 6000,
		ready: true,
		error: null,
		canUndo: false,
		canRedo: false,
		clips: editor.clipRegions,
		editor: editor as unknown as Record<string, unknown>,
	};
}
describe("video content indexing and search", () => {
	it("keeps exact scene boundaries and divides long static scenes", () => {
		expect(segmentVideo(32000, [2000])).toEqual([
			{ startMs: 0, endMs: 2000 },
			{ startMs: 2000, endMs: 17000 },
			{ startMs: 17000, endMs: 32000 },
		]);
		expect(segmentVideo(2000, [0, 1000, 1000, 2000])).toEqual([
			{ startMs: 0, endMs: 1000 },
			{ startMs: 1000, endMs: 2000 },
		]);
	});
	it("retrieves Chinese natural-language queries from English OCR, speech and visual descriptions", () => {
		const data = index();
		data.segments[0].transcript = [{ startMs: 0, endMs: 1800, text: "现在打开项目" }];
		data.segments[1].frames = [
			{ timeMs: 2500, imagePath: "", text: "Export FAILED: disk full" },
		];
		data.segments[2].description = "点击导出，完成保存";
		const results = searchVideo(data, "找到导出失败的位置");
		expect(results[0].segmentId).toBe("v:2");
		expect(results[0].text).toContain("Export FAILED");
		expect(searchVideo(data, "打开项目")[0].segmentId).toBe("v:1");
		expect(searchVideo(data, "火星探测器")).toEqual([]);
	});
	it("creates source-anchored complementary cuts and merges adjacent selected scenes", () => {
		expect(keepSegmentsEdits(index(), ["v:2", "v:3"])).toEqual([
			{ type: "delete", timeBase: "source", startMs: 0, endMs: 2000 },
		]);
		expect(() => keepSegmentsEdits(index(), ["missing"])).toThrow("Unknown video segment");
	});
	it("places click zooms at their edited timeline locations and respects clip speed", () => {
		const data = index(),
			current = project();
		data.segments[2].clicks = [{ timeMs: 4500, cx: 0.3, cy: 0.4, type: "click" }];
		current.clips = [
			{ id: "trimmed", startMs: 1000, endMs: 2000, sourceStartMs: 4000, speed: 2 },
		];
		expect(clicksToZooms(data, current)).toEqual([
			{ type: "zoom", startMs: 1000, endMs: 2000, depth: 2, cx: 0.3, cy: 0.4 },
		]);
	});
	it("returns actual MCP images and audio without dumping base64 into the metadata", () => {
		const result = mediaToolResult({
			indexId: "v",
			frames: [{ timeMs: 500, mimeType: "image/jpeg", data: "jpeg-data" }],
			audio: { mimeType: "audio/wav", data: "wav-data" },
		});
		expect(result.content.map((part) => part.type)).toEqual(["text", "text", "image", "audio"]);
		expect(JSON.stringify(result.content[0])).not.toContain("jpeg-data");
		expect(result.content[1]).toEqual({ type: "text", text: "SOURCE 500 ms" });
	});
});
describe("autonomous edit planning", () => {
	const dependencies = (active: ProjectSnapshot) => ({
		projectEdits: async (edits: Parameters<typeof applyEditCommands>[1]) => {
			const editor = applyEditCommands(
				normalizeProjectEditor(active.editor),
				edits,
				active.sourceDurationMs,
			);
			return {
				...active,
				clips: editor.clipRegions,
				durationMs: timelineDuration(editor.clipRegions),
				editor: editor as unknown as Record<string, unknown>,
			};
		},
		pauseEdits: vi.fn(async () => []),
	});
	it("plans selection, duration, captions and zoom in one ordered undoable batch", async () => {
		const data = index(),
			active = project(),
			deps = dependencies(active);
		data.segments[2].transcript = [{ startMs: 4100, endMs: 5000, text: "导出成功" }];
		data.segments[2].clicks = [{ timeMs: 4500, cx: 0.5, cy: 0.5, type: "click" }];
		const plan = await planVideoTask(
			data,
			active,
			{
				indexId: "v",
				goal: "只保留成功操作",
				mode: "selected",
				segmentIds: ["v:3"],
				targetDurationMs: 1000,
				addCaptions: true,
				zoomClicks: true,
			},
			new AbortController().signal,
			deps,
		);
		const result = await deps.projectEdits(plan.edits);
		expect(plan.planner).toBe("explicit");
		expect(result.durationMs).toBe(1000);
		expect(result.clips[0]).toMatchObject({ sourceStartMs: 4000, speed: 2 });
		expect(result.editor.autoCaptions as unknown[]).toHaveLength(1);
		expect(result.editor.zoomRegions as unknown[]).toHaveLength(1);
	});
	it("supports model-chosen segment IDs using current indexed evidence", async () => {
		vi.mocked(requestVideoModel).mockResolvedValueOnce({ keepSegmentIds: ["v:2"] });
		const active = project(),
			deps = dependencies(active);
		const plan = await planVideoTask(
			index(),
			active,
			{ indexId: "v", goal: "留下错误提示" },
			new AbortController().signal,
			deps,
		);
		expect(plan.planner).toBe("model");
		expect((await deps.projectEdits(plan.edits)).clips[0].sourceStartMs).toBe(2000);
	});
	it("does not silently delete video when local pause analysis has no idle evidence", async () => {
		const active = project();
		const plan = await planVideoTask(
			index(),
			active,
			{ indexId: "v", goal: "删停顿", mode: "remove_pauses" },
			new AbortController().signal,
			dependencies(active),
		);
		expect(plan.edits).toEqual([]);
		expect(plan.notes[0]).toContain("retained");
	});
});
