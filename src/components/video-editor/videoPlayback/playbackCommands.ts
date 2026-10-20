import type { createClipPlayback } from "./clipPlayback";

type Transport = ReturnType<typeof createClipPlayback>;

/** Keep editor commands issued while the preview renderer is still loading. */
export function createPlaybackCommands(
	transportRef: { current: Transport | null },
	timelineTimeRef: { current: number },
) {
	let pendingPlay: boolean | undefined;
	return {
		get isPlaying() {
			return transportRef.current?.isPlaying ?? pendingPlay ?? false;
		},
		get timeMs() {
			return Math.round(timelineTimeRef.current * 1000);
		},
		seekTimeline(time: number) {
			if (transportRef.current) transportRef.current.seek(time);
			else timelineTimeRef.current = time;
		},
		async play() {
			if (transportRef.current) await transportRef.current.play();
			else pendingPlay = true;
		},
		pause() {
			pendingPlay = false;
			transportRef.current?.pause();
		},
		async initialize(transport: Transport, autoPlay: boolean) {
			transportRef.current = transport;
			transport.seek(timelineTimeRef.current);
			// An explicit pause takes precedence over automatic playback.
			const shouldPlay = pendingPlay ?? autoPlay;
			pendingPlay = undefined;
			if (shouldPlay) await transport.play();
		},
	};
}
