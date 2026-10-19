import { useTimelineContext } from "dnd-timeline";
import {
	useEffect,
	useLayoutEffect,
	useImperativeHandle,
	useRef,
	useState,
	type Ref,
	type RefObject,
} from "react";
import { createScrubScheduler } from "./scrubScheduler";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { formatPlayheadTime } from "../../core/time";

import {
	getPlayheadDisplayTime,
	getTimeAtClipSeam,
	type ClipPresentation,
} from "../../core/clipPresentation";

export interface PlaybackCursorHandle {
	startDrag(clientX: number, snapToKeyframes?: boolean): void;
}

interface PlaybackCursorProps {
	ref?: Ref<PlaybackCursorHandle>;
	onDraggingChange?: (dragging: boolean) => void;
	clips: ClipPresentation[];
	currentTimeMs: number;
	videoDurationMs: number;
	onSeek?: (time: number) => void;
	timelineRef: RefObject<HTMLDivElement | null>;
	keyframes?: { id: string; time: number }[];
	isLoading?: boolean;
}

export default function PlaybackCursor({
	ref,
	onDraggingChange,
	clips,
	currentTimeMs,
	videoDurationMs,
	onSeek,
	timelineRef,
	keyframes = [],
	isLoading = false,
}: PlaybackCursorProps) {
	const { sidebarWidth, direction, range, valueToPixels, pixelsToValue } = useTimelineContext();
	const t = useScopedT("timeline");
	const sideProperty = direction === "rtl" ? "right" : "left";
	const [isDragging, setIsDragging] = useState(false);
	const [isHovered, setIsHovered] = useState(false);

	const lineRef = useRef<HTMLDivElement>(null);
	const capRef = useRef<HTMLButtonElement>(null);
	const labelRef = useRef<HTMLSpanElement>(null);
	const dragRef = useRef<{ time: number; dispose: () => void } | null>(null);
	const expanded = isHovered || isDragging || isLoading;
	const paint = (timeMs: number) => {
		const line = lineRef.current;
		const cap = capRef.current;
		if (!line || !cap) return;
		const time = Math.max(0, Math.min(timeMs, videoDurationMs));
		const offset = valueToPixels(getPlayheadDisplayTime(time, clips) - range.start);
		const width = valueToPixels(range.end - range.start);
		const capShift = Math.max(0, 34 - offset) - Math.max(0, 34 - (width - offset));
		line.style.transform = `translate3d(${direction === "rtl" ? -offset : offset}px, 0, 0)`;
		line.style.visibility = time < range.start || time > range.end ? "hidden" : "visible";
		cap.style.transform = `translateX(calc(-50% + ${expanded || dragRef.current ? (direction === "rtl" ? -capShift : capShift) : 0}px))`;
		const label = formatPlayheadTime(time);
		if (labelRef.current) labelRef.current.textContent = label;
		cap.setAttribute("aria-label", t("playhead.aria", undefined, { time: label }));
	};
	// Media callbacks must not pull the cursor back to an older decoded frame mid-drag.
	useLayoutEffect(() => {
		paint(dragRef.current?.time ?? currentTimeMs);
	});
	function timeAt(x: number, rect: DOMRect, snapToKeyframes: boolean) {
		const position =
			direction === "rtl" ? rect.right - sidebarWidth - x : x - rect.left - sidebarWidth;
		const displayMs = Math.max(
			0,
			Math.min(range.start + pixelsToValue(position), videoDurationMs),
		);
		let time = getTimeAtClipSeam(displayMs, clips);
		// A small pixel magnet stays predictable at every timeline zoom level.
		let distance = 4;
		if (snapToKeyframes)
			for (const keyframe of keyframes) {
				if (keyframe.time < range.start || keyframe.time > range.end) continue;
				const delta = Math.abs(
					valueToPixels(getPlayheadDisplayTime(keyframe.time, clips) - displayMs),
				);
				if (delta <= distance) {
					distance = delta;
					time = keyframe.time;
				}
			}
		return time;
	}
	const latestRef = useRef({ paint, onSeek, timeAt });
	useLayoutEffect(() => {
		latestRef.current = { paint, onSeek, timeAt };
	});
	useEffect(() => () => dragRef.current?.dispose(), []);

	const startDrag = (clientX: number, snapToKeyframes = false) => {
		if (!timelineRef.current || !onSeek || videoDurationMs <= 0) return;
		dragRef.current?.dispose();
		// Read layout once per gesture, not after each cursor style write.
		let rect = timelineRef.current.getBoundingClientRect();
		const refreshRect = () => {
			if (timelineRef.current) rect = timelineRef.current.getBoundingClientRect();
		};
		const timeFromPointer = (x: number) => latestRef.current.timeAt(x, rect, snapToKeyframes);
		const scheduler = createScrubScheduler(
			(time) => {
				if (dragRef.current) dragRef.current.time = time;
				latestRef.current.paint(time);
			},
			(time) => latestRef.current.onSeek?.(time / 1000),
		);
		const previousCursor = document.body.style.cursor;
		const dispose = () => {
			scheduler.cancel();
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", up);
			window.removeEventListener("blur", blur);
			window.removeEventListener("resize", refreshRect);
			window.removeEventListener("scroll", refreshRect, true);
			document.body.style.cursor = previousCursor;
			dragRef.current = null;
		};
		const finish = (time: number) => {
			scheduler.finish(time);
			dispose();
			setIsDragging(false);
			onDraggingChange?.(false);
		};
		const move = (event: MouseEvent) => scheduler.update(timeFromPointer(event.clientX));
		const up = (event: MouseEvent) => finish(timeFromPointer(event.clientX));
		const blur = () => finish(dragRef.current!.time);
		dragRef.current = { time: currentTimeMs, dispose };
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", up);
		window.addEventListener("blur", blur);
		window.addEventListener("resize", refreshRect);
		window.addEventListener("scroll", refreshRect, true);
		document.body.style.cursor = "ew-resize";
		setIsDragging(true);
		onDraggingChange?.(true);
		scheduler.update(timeFromPointer(clientX));
	};
	useImperativeHandle(ref, () => ({ startDrag }));

	if (videoDurationMs <= 0 || currentTimeMs < 0) return null;
	return (
		<div data-testid="timeline-playhead" className="absolute inset-0 z-50 pointer-events-none">
			<div
				ref={lineRef}
				className="absolute top-0 bottom-0 w-px bg-accent"
				style={{
					[sideProperty]: sidebarWidth,
					willChange: isDragging ? "transform" : undefined,
				}}
			>
				<button
					type="button"
					ref={capRef}
					data-testid="playhead-cap"
					onMouseEnter={() => setIsHovered(true)}
					onMouseLeave={() => setIsHovered(false)}
					onFocus={() => setIsHovered(true)}
					onBlur={() => setIsHovered(false)}
					onClick={(event) => event.stopPropagation()}
					onMouseDown={(event) => {
						if (event.button !== 0) return;
						event.preventDefault();
						event.stopPropagation();
						startDrag(event.clientX, true);
					}}
					className="absolute top-0 h-4 rounded-full bg-accent text-accent-foreground cursor-ew-resize pointer-events-auto overflow-hidden transition-[width] duration-150"
					style={{
						width: expanded ? 68 : 16,
						left: "50%",
					}}
				>
					<span
						ref={labelRef}
						className={cn(
							"block whitespace-nowrap text-[10px] font-medium tabular-nums transition-opacity",
							expanded ? "opacity-100" : "opacity-0",
						)}
					/>
				</button>
			</div>
		</div>
	);
}
