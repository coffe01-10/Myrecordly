/** Move the cursor immediately; decode only the newest target once per display frame. */
export function createScrubScheduler(
	paint: (timeMs: number) => void,
	seek: (timeMs: number) => void,
) {
	let frame: number | null = null;
	let latest = 0;
	let committed: number | null = null;
	const cancel = () => {
		if (frame !== null) cancelAnimationFrame(frame);
		frame = null;
	};
	const flush = () => {
		frame = null;
		if (committed === latest) return;
		committed = latest;
		seek(latest);
	};
	return {
		update(timeMs: number) {
			latest = timeMs;
			paint(timeMs);
			if (frame === null) frame = requestAnimationFrame(flush);
		},
		finish(timeMs: number) {
			cancel();
			latest = timeMs;
			paint(timeMs);
			flush();
		},
		cancel,
	};
}
