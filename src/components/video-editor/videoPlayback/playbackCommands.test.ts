import { afterEach, describe, expect, it, vi } from "vitest";
import { createClipPlayback } from "./clipPlayback";
import { createPlaybackCommands } from "./playbackCommands";

afterEach(() => vi.unstubAllGlobals());

function setup() {
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn(() => 1),
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	const video = {
		duration: 30,
		currentTime: 0,
		playbackRate: 1,
		play: vi.fn(async () => {}),
		pause: vi.fn(),
	} as unknown as HTMLVideoElement;
	const timelineTime = { current: 0 };
	const onError = vi.fn();
	const transport = createClipPlayback({
		video,
		getClips: () => [{ id: "clip", startMs: 0, endMs: 10000, sourceStartMs: 5000, speed: 2 }],
		onTime: (time) => {
			timelineTime.current = time;
		},
		onPlaying: vi.fn(),
		onError,
	});
	const transportRef = { current: null as typeof transport | null };
	const commands = createPlaybackCommands(transportRef, timelineTime);
	return { commands, transport, transportRef, timelineTime, video, onError };
}

describe("commands issued before preview transport initialization", () => {
	it("applies the latest staged timeline seek to the source frame", async () => {
		const { commands, transport, video, timelineTime } = setup();
		commands.seekTimeline(1);
		commands.seekTimeline(4);
		expect(video.currentTime).toBe(0);
		await commands.initialize(transport, false);
		expect(timelineTime.current).toBe(4);
		expect(video.currentTime).toBe(13);
		expect(video.play).not.toHaveBeenCalled();
	});

	it("seeks before starting a queued play request", async () => {
		const { commands, transport, video } = setup();
		commands.seekTimeline(3);
		await commands.play();
		expect(commands.isPlaying).toBe(true);
		expect(video.play).not.toHaveBeenCalled();
		await commands.initialize(transport, false);
		expect(video.currentTime).toBe(11);
		expect(video.play).toHaveBeenCalledOnce();
		expect(commands.isPlaying).toBe(true);
	});

	it("a second toggle cancels queued playback before media is ready", async () => {
		const { commands, transport, video } = setup();
		const toggle = async () => {
			if (commands.isPlaying) commands.pause();
			else await commands.play();
		};
		await toggle();
		await toggle();
		await commands.initialize(transport, false);
		expect(commands.isPlaying).toBe(false);
		expect(video.play).not.toHaveBeenCalled();
	});

	it("an explicit pause overrides autoplay during initialization", async () => {
		const { commands, transport, video } = setup();
		commands.pause();
		await commands.initialize(transport, true);
		expect(video.play).not.toHaveBeenCalled();
	});

	it("retains autoplay when there was no explicit playback command", async () => {
		const { commands, transport, video } = setup();
		await commands.initialize(transport, true);
		expect(video.play).toHaveBeenCalledOnce();
	});

	it("delegates commands after initialization without replaying a consumed play request", async () => {
		const { commands, transport, transportRef, video, onError } = setup();
		await commands.play();
		await commands.initialize(transport, false);
		commands.seekTimeline(2);
		expect(video.currentTime).toBe(9);
		commands.pause();
		expect(commands.isPlaying).toBe(false);
		await commands.play();
		expect(commands.isPlaying).toBe(true);
		transport.dispose();
		transportRef.current = null;
		const plays = vi.mocked(video.play).mock.calls.length;
		await commands.initialize(transport, false);
		expect(video.play).toHaveBeenCalledTimes(plays);
		expect(commands.isPlaying).toBe(false);
		expect(onError).not.toHaveBeenCalled();
	});
});
