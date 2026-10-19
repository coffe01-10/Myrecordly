import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createScrubScheduler } from "./scrubScheduler";

let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
	frames = new Map();
	let id = 0;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.set(++id, callback);
		return id;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());
function tick() {
	const pending = [...frames.values()];
	frames.clear();
	for (const callback of pending) callback(0);
}

it("paints every pointer position immediately but seeks only the newest target per frame", () => {
	const paint = vi.fn();
	const seek = vi.fn();
	const scrub = createScrubScheduler(paint, seek);
	for (let time = 0; time < 100; time++) scrub.update(time);
	expect(paint).toHaveBeenCalledTimes(100);
	expect(paint).toHaveBeenLastCalledWith(99);
	expect(seek).not.toHaveBeenCalled();
	expect(frames.size).toBe(1);
	tick();
	expect(seek.mock.calls).toEqual([[99]]);
	scrub.update(50);
	tick();
	expect(seek.mock.calls).toEqual([[99], [50]]);
});

it("uses the release position even before the pending move reaches a frame", () => {
	const paint = vi.fn();
	const seek = vi.fn();
	const scrub = createScrubScheduler(paint, seek);
	scrub.update(100);
	scrub.finish(153.25);
	expect(paint).toHaveBeenLastCalledWith(153.25);
	expect(seek.mock.calls).toEqual([[153.25]]);
	tick();
	expect(seek).toHaveBeenCalledTimes(1);
});

it("does not restart decoding when the pointer stays at the same time or clamped edge", () => {
	const seek = vi.fn();
	const scrub = createScrubScheduler(vi.fn(), seek);
	scrub.update(0);
	tick();
	scrub.update(0);
	tick();
	scrub.finish(0);
	expect(seek.mock.calls).toEqual([[0]]);
});

it("cancels a queued seek when the gesture is disposed", () => {
	const seek = vi.fn();
	const scrub = createScrubScheduler(vi.fn(), seek);
	scrub.update(123);
	scrub.cancel();
	tick();
	expect(seek).not.toHaveBeenCalled();
});
