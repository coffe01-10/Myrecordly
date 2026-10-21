import {
	useEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { FilmStrip } from "@/components/ui/icons";

type Drag = {
	pointerId: number;
	x: number;
	y: number;
	paths: string[];
	name: string;
	host: HTMLElement;
	active: boolean;
};
type Target = { index: number; x: number; top: number; height: number };

/** Pointer capture keeps library drags independent of the browser's native file-drag gesture. */
export function useRecordingDrag(onDrop: (paths: string[], index: number) => Promise<unknown>) {
	const [label, setLabel] = useState<{ name: string; count: number }>();
	const ghost = useRef<HTMLDivElement>(null);
	const marker = useRef<HTMLDivElement>(null);
	const drag = useRef<Drag | undefined>(undefined);
	const lastDrop = useRef(-Infinity);
	const drop = useRef(onDrop);
	drop.current = onDrop;
	useEffect(() => {
		let frame = 0;
		let point = { x: 0, y: 0 };
		let bounds: DOMRect | undefined;
		let clips: DOMRect[] = [];
		const hit = (x: number, y: number): Target | undefined => {
			if (
				!bounds ||
				x < bounds.left ||
				x > bounds.right ||
				y < bounds.top ||
				y > bounds.bottom
			)
				return;
			let index = clips.findIndex((rect) => x < rect.left + rect.width / 2);
			if (index < 0) index = clips.length;
			return {
				index,
				x:
					index < clips.length
						? clips[index].left
						: (clips[clips.length - 1]?.right ?? bounds.left + 20),
				top: clips[0]?.top ?? bounds.top + 24,
				height: clips[0]?.height ?? 56,
			};
		};
		const draw = () => {
			frame = 0;
			if (ghost.current)
				ghost.current.style.transform = `translate3d(${point.x + 16}px, ${point.y + 16}px, 0)`;
			const target = hit(point.x, point.y);
			if (marker.current) {
				marker.current.style.display = target ? "block" : "none";
				if (target) {
					marker.current.style.transform = `translate3d(${target.x}px, ${target.top - 5}px, 0)`;
					marker.current.style.height = `${target.height + 10}px`;
				}
			}
		};
		const end = () => {
			const current = drag.current;
			if (current?.active) {
				lastDrop.current = performance.now();
				if (current.host.hasPointerCapture(current.pointerId))
					current.host.releasePointerCapture(current.pointerId);
			}
			drag.current = undefined;
			cancelAnimationFrame(frame);
			frame = 0;
			document.documentElement.removeAttribute("data-library-dragging");
			setLabel(undefined);
		};
		const move = (event: PointerEvent) => {
			const current = drag.current;
			if (!current || event.pointerId !== current.pointerId) return;
			if (!current.active) {
				if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return;
				current.active = true;
				current.host.setPointerCapture(current.pointerId);
				const panel = document.querySelector<HTMLElement>("[data-timeline-panel]");
				bounds = panel?.getBoundingClientRect();
				clips = [
					...(panel?.querySelectorAll<HTMLElement>(
						'[data-timeline-item][data-variant="clip"]',
					) ?? []),
				]
					.sort((a, b) => Number(a.dataset.startMs) - Number(b.dataset.startMs))
					.map((clip) => clip.getBoundingClientRect());
				document.documentElement.setAttribute("data-library-dragging", "");
				setLabel({ name: current.name, count: current.paths.length });
			}
			event.preventDefault();
			point = { x: event.clientX, y: event.clientY };
			current.x = point.x;
			current.y = point.y;
			if (!frame) frame = requestAnimationFrame(draw);
		};
		const up = (event: PointerEvent) => {
			const current = drag.current;
			if (!current || event.pointerId !== current.pointerId) return;
			const target = current.active ? hit(event.clientX, event.clientY) : undefined;
			end();
			if (target) void drop.current(current.paths, target.index);
		};
		const cancel = () => end();
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape" && drag.current?.active) {
				event.preventDefault();
				event.stopPropagation();
				end();
			}
		};
		document.addEventListener("pointermove", move, { capture: true, passive: false });
		document.addEventListener("pointerup", up, true);
		document.addEventListener("pointercancel", cancel, true);
		document.addEventListener("keydown", key, true);
		window.addEventListener("blur", cancel);
		return () => {
			end();
			document.removeEventListener("pointermove", move, true);
			document.removeEventListener("pointerup", up, true);
			document.removeEventListener("pointercancel", cancel, true);
			document.removeEventListener("keydown", key, true);
			window.removeEventListener("blur", cancel);
		};
	}, []);
	return {
		start: (event: ReactPointerEvent<HTMLElement>, paths: string[], name: string) => {
			if (
				event.button !== 0 ||
				(event.target as Element).closest("[data-recording-select], [data-recording-add]")
			)
				return;
			drag.current = {
				pointerId: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				paths,
				name,
				host: event.currentTarget,
				active: false,
			};
		},
		suppressClick: (event: MouseEvent) => {
			if (performance.now() - lastDrop.current < 250) {
				event.preventDefault();
				event.stopPropagation();
			}
		},
		overlay: label
			? createPortal(
					<>
						<div
							ref={ghost}
							data-library-drag-preview
							className="pointer-events-none fixed left-0 top-0 z-[200] flex max-w-72 items-center gap-2 rounded-xl border border-separator bg-overlay px-3 py-2 text-xs text-foreground shadow-lg"
							style={{
								willChange: "transform",
								transform: `translate3d(${(drag.current?.x ?? 0) + 16}px, ${(drag.current?.y ?? 0) + 16}px, 0)`,
							}}
						>
							<FilmStrip className="size-4 shrink-0" />
							<span className="truncate">{label.name}</span>
							{label.count > 1 && (
								<span className="shrink-0 tabular-nums">× {label.count}</span>
							)}
						</div>
						<div
							ref={marker}
							data-library-insertion-marker
							className="pointer-events-none fixed left-0 top-0 z-[190] w-0.5 rounded-full bg-accent shadow-sm"
							style={{ display: "none" }}
						/>
					</>,
					document.body,
				)
			: null,
	};
}
