import type { Edit, TimeRange } from "../../packages/automation/src/types";
import {
	packClipSequence,
	reorderClipSequence,
	rippleRegionAnchors,
	rippleRegions,
} from "@/components/video-editor/clipSequence";
import { planClipSplit } from "@/components/video-editor/clipSplit";
import type { ProjectEditorState } from "@/components/video-editor/projectPersistence";
import {
	type ClipRegion,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	getClipSourceStartMs,
	sortClipRegions,
} from "@/components/video-editor/types";

export function timelineDuration(clips: ClipRegion[]) {
	return Math.max(0, ...clips.map((clip) => clip.endMs));
}
function number(value: number, label: string, min = 0, max = Infinity) {
	if (!Number.isFinite(value) || value < min || value > max)
		throw new Error(`${label} must be between ${min} and ${max}`);
}
function range(value: TimeRange, duration: number) {
	number(value.startMs, "startMs", 0, duration);
	number(value.endMs, "endMs", 0, duration);
	if (value.endMs <= value.startMs) throw new Error("endMs must be greater than startMs");
}

function remap(editor: ProjectEditorState, before: ClipRegion[], after: ClipRegion[]) {
	editor.clipRegions = after;
	editor.zoomRegions = rippleRegions(editor.zoomRegions, before, after);
	editor.annotationRegions = rippleRegions(editor.annotationRegions, before, after);
	editor.audioRegions = rippleRegionAnchors(editor.audioRegions, before, after);
}

/** Computes a complete batch before publishing state. An invalid edit leaves the project untouched. */
export function applyEditCommands(
	input: ProjectEditorState,
	edits: Edit[],
	sourceDurationMs: number,
	createId = () => crypto.randomUUID(),
): ProjectEditorState {
	const editor = structuredClone(input);
	const copyAudio = (parent: string, child: string) => {
		const setting = editor.sourceAudioTrackSettingsByClip?.[parent];
		if (setting) {
			editor.sourceAudioTrackSettingsByClip ??= {};
			editor.sourceAudioTrackSettingsByClip[child] = structuredClone(setting);
		}
	};
	for (const edit of edits) {
		const duration = timelineDuration(editor.clipRegions);
		switch (edit.type) {
			case "split": {
				number(edit.atMs, "atMs", 0, duration);
				const plan = planClipSplit({
					clipRegions: editor.clipRegions,
					splitMs: edit.atMs,
					createId,
				});
				if (!plan) throw new Error("Split position must be inside a clip");
				copyAudio(plan.targetId, plan.left.id);
				copyAudio(plan.targetId, plan.right.id);
				editor.clipRegions = editor.clipRegions.flatMap((clip) =>
					clip.id === plan.targetId ? [plan.left, plan.right] : [clip],
				);
				break;
			}
			case "delete":
			case "speed": {
				if (edit.timeBase !== "source" && edit.timeBase !== "timeline")
					throw new Error("timeBase must be source or timeline");
				range(edit, edit.timeBase === "source" ? sourceDurationMs : duration);
				if (edit.type === "speed") number(edit.speed, "speed", 0.25, 4);
				const before: ClipRegion[] = [];
				const retained: ClipRegion[] = [];
				let affected = false;
				for (const clip of sortClipRegions(editor.clipRegions)) {
					const inPoint = getClipSourceStartMs(clip);
					const start = Math.max(
						clip.startMs,
						edit.timeBase === "source"
							? clip.startMs + (edit.startMs - inPoint) / clip.speed
							: edit.startMs,
					);
					const end = Math.min(
						clip.endMs,
						edit.timeBase === "source"
							? clip.startMs + (edit.endMs - inPoint) / clip.speed
							: edit.endMs,
					);
					if (end <= start) {
						before.push(clip);
						retained.push(clip);
						continue;
					}
					affected = true;
					const fragment = (a: number, b: number, changed: boolean) => {
						if (b <= a) return;
						const item = {
							...clip,
							id: createId(),
							startMs: a,
							endMs: b,
							sourceStartMs: inPoint + (a - clip.startMs) * clip.speed,
						};
						before.push(item);
						copyAudio(clip.id, item.id);
						if (!changed || edit.type === "speed") {
							const speed =
								changed && edit.type === "speed" ? edit.speed : clip.speed;
							retained.push({
								...item,
								speed,
								endMs: a + ((b - a) * clip.speed) / speed,
							});
						}
					};
					fragment(clip.startMs, start, false);
					fragment(start, end, true);
					fragment(end, clip.endMs, false);
				}
				if (!affected) throw new Error("The range does not intersect retained footage");
				remap(editor, before, packClipSequence(retained));
				break;
			}
			case "reorder": {
				if (!editor.clipRegions.some((clip) => clip.id === edit.clipId))
					throw new Error("Unknown clipId");
				number(edit.index, "index", 0, editor.clipRegions.length - 1);
				if (!Number.isInteger(edit.index)) throw new Error("index must be an integer");
				const before = editor.clipRegions;
				remap(editor, before, reorderClipSequence(before, edit.clipId, edit.index));
				break;
			}
			case "mute": {
				if (!editor.clipRegions.some((clip) => clip.id === edit.clipId))
					throw new Error("Unknown clipId");
				if (typeof edit.muted !== "boolean") throw new Error("muted must be a boolean");
				editor.clipRegions = editor.clipRegions.map((clip) =>
					clip.id === edit.clipId ? { ...clip, muted: edit.muted } : clip,
				);
				break;
			}
			case "caption": {
				range(edit, sourceDurationMs);
				if (typeof edit.text !== "string" || !edit.text.trim())
					throw new Error("Caption text is required");
				editor.autoCaptions.push({
					id: createId(),
					startMs: edit.startMs,
					endMs: edit.endMs,
					text: edit.text,
				});
				editor.autoCaptionSettings.enabled = true;
				break;
			}
			case "zoom": {
				range(edit, duration);
				number(edit.cx, "cx", 0, 1);
				number(edit.cy, "cy", 0, 1);
				number(edit.depth, "depth", 1, 6);
				if (!Number.isInteger(edit.depth)) throw new Error("depth must be an integer");
				editor.zoomRegions.push({
					id: createId(),
					startMs: edit.startMs,
					endMs: edit.endMs,
					depth: edit.depth,
					focus: { cx: edit.cx, cy: edit.cy },
					mode: "manual",
				});
				break;
			}
			case "text": {
				range(edit, duration);
				if (typeof edit.text !== "string" || !edit.text.trim())
					throw new Error("Text is required");
				if (edit.x !== undefined) number(edit.x, "x", 0, 100);
				if (edit.y !== undefined) number(edit.y, "y", 0, 100);
				if (edit.fontSize !== undefined) number(edit.fontSize, "fontSize", 1, 1000);
				editor.annotationRegions.push({
					id: createId(),
					startMs: edit.startMs,
					endMs: edit.endMs,
					type: "text",
					content: edit.text,
					textContent: edit.text,
					position: {
						...DEFAULT_ANNOTATION_POSITION,
						...(edit.x !== undefined ? { x: edit.x } : {}),
						...(edit.y !== undefined ? { y: edit.y } : {}),
					},
					size: { ...DEFAULT_ANNOTATION_SIZE },
					style: {
						...DEFAULT_ANNOTATION_STYLE,
						...(edit.fontSize ? { fontSize: edit.fontSize } : {}),
						...(edit.color ? { color: edit.color } : {}),
					},
					zIndex:
						Math.max(0, ...editor.annotationRegions.map((region) => region.zIndex)) + 1,
				});
				break;
			}
			case "remove_effect": {
				const lists = [editor.zoomRegions, editor.annotationRegions, editor.autoCaptions];
				if (!lists.some((list) => list.some((item) => item.id === edit.id)))
					throw new Error("Unknown effect id");
				editor.zoomRegions = editor.zoomRegions.filter((item) => item.id !== edit.id);
				editor.annotationRegions = editor.annotationRegions.filter(
					(item) => item.id !== edit.id,
				);
				editor.autoCaptions = editor.autoCaptions.filter((item) => item.id !== edit.id);
				break;
			}
			default:
				throw new Error(`Unknown edit type: ${String((edit as { type: unknown }).type)}`);
		}
	}
	return editor;
}

export function previewEditor(
	editor: ProjectEditorState,
	startMs: number,
	endMs: number,
	sourceDurationMs: number,
) {
	const duration = timelineDuration(editor.clipRegions);
	range({ startMs, endMs }, duration);
	const edits: Edit[] = [];
	if (endMs < duration)
		edits.push({ type: "delete", timeBase: "timeline", startMs: endMs, endMs: duration });
	if (startMs > 0)
		edits.push({ type: "delete", timeBase: "timeline", startMs: 0, endMs: startMs });
	return applyEditCommands(editor, edits, sourceDurationMs);
}
