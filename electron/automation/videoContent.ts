import type {
	Edit,
	IndexedSegment,
	ProjectSnapshot,
	TimeRange,
	VideoIndex,
	VideoSearchHit,
} from "../../packages/automation/src/types";

/** Keep scene boundaries and subdivide long static screen recordings for inspection. */
export function segmentVideo(durationMs: number, sceneTimes: number[]): TimeRange[] {
	const boundaries = [
		0,
		...sceneTimes.filter((time) => time > 0 && time < durationMs),
		durationMs,
	].sort((a, b) => a - b);
	const segments: TimeRange[] = [];
	for (let i = 1; i < boundaries.length; i++) {
		const start = boundaries[i - 1],
			end = boundaries[i];
		const count = Math.ceil((end - start) / 15000);
		for (let n = 0; n < count; n++)
			segments.push({
				startMs: start + ((end - start) * n) / count,
				endMs: start + ((end - start) * (n + 1)) / count,
			});
	}
	return segments;
}

export function segmentText(segment: IndexedSegment): string {
	return [
		segment.description,
		...segment.keywords,
		...segment.transcript.map((cue) => cue.text),
		...segment.frames.map((frame) => frame.text),
	].join("\n");
}
function tokens(text: string): string[] {
	const parts = text.toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]+/gu) ?? [];
	return [
		...new Set(
			parts.flatMap((part) =>
				/\p{Script=Han}/u.test(part) && part.length > 1
					? Array.from({ length: part.length - 1 }, (_, i) => part.slice(i, i + 2))
					: [part],
			),
		),
	];
}
const synonyms = [
	["报错", "错误", "失败", "error", "failed", "failure"],
	["导出", "输出", "export", "render"],
	["保存", "save"],
	["打开", "open"],
	["点击", "click"],
	["登录", "登陆", "login", "sign in"],
];
export function searchVideo(index: VideoIndex, query: string, limit = 8): VideoSearchHit[] {
	const terms = new Set(tokens(query));
	for (const group of synonyms)
		if (group.some((word) => query.toLowerCase().includes(word)))
			for (const word of group) terms.add(word);
	return index.segments
		.map((segment) => {
			const text = segmentText(segment),
				lower = text.toLowerCase();
			const score =
				[...terms].reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0) +
				(lower.includes(query.toLowerCase()) ? 3 : 0);
			return {
				segmentId: segment.id,
				startMs: segment.startMs,
				endMs: segment.endMs,
				score,
				text,
			};
		})
		.filter((hit) => hit.score > 0)
		.sort((a, b) => b.score - a.score || a.startMs - b.startMs)
		.slice(0, limit);
}

export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
	const merged: TimeRange[] = [];
	for (const range of [...ranges].sort((a, b) => a.startMs - b.startMs)) {
		const last = merged[merged.length - 1];
		if (last && range.startMs <= last.endMs) last.endMs = Math.max(last.endMs, range.endMs);
		else merged.push({ ...range });
	}
	return merged;
}
/** Source-anchored deletions work even after previous edits shifted timeline positions. */
export function keepSegmentsEdits(index: VideoIndex, ids: string[]): Edit[] {
	const keep = mergeRanges(
		ids.map((id) => {
			const segment = index.segments.find((segment) => segment.id === id);
			if (!segment) throw new Error(`Unknown video segment: ${id}`);
			return segment;
		}),
	);
	if (!keep.length) throw new Error("Select at least one segment to retain");
	const edits: Edit[] = [];
	let start = 0;
	for (const span of keep) {
		if (span.startMs > start)
			edits.push({ type: "delete", timeBase: "source", startMs: start, endMs: span.startMs });
		start = span.endMs;
	}
	if (start < index.durationMs)
		edits.push({ type: "delete", timeBase: "source", startMs: start, endMs: index.durationMs });
	return edits;
}

export function clicksToZooms(index: VideoIndex, project: ProjectSnapshot): Edit[] {
	const edits: Edit[] = [];
	let lastEnd = -Infinity;
	for (const clip of [...project.clips].sort((a, b) => a.startMs - b.startMs)) {
		const sourceStart = clip.sourceStartMs ?? clip.startMs;
		for (const click of index.segments.flatMap((segment) => segment.clicks)) {
			const atMs = clip.startMs + (click.timeMs - sourceStart) / clip.speed;
			if (atMs < clip.startMs || atMs >= clip.endMs) continue;
			const startMs = Math.max(clip.startMs, atMs - 400),
				endMs = Math.min(clip.endMs, atMs + 1600);
			if (startMs < lastEnd) continue;
			edits.push({ type: "zoom", startMs, endMs, depth: 2, cx: click.cx, cy: click.cy });
			lastEnd = endMs;
		}
	}
	return edits;
}
