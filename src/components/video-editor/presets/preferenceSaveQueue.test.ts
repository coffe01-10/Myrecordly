import { afterEach, expect, it, vi } from "vitest";
import { createPreferenceSaveQueue } from "./preferenceSaveQueue";

afterEach(() => vi.useRealTimers());

it("saves the latest slider value once after dragging stops", () => {
	vi.useFakeTimers();
	const save = vi.fn();
	const queue = createPreferenceSaveQueue(save);
	for (let value = 1; value <= 30; value++) {
		queue.schedule({ padding: { top: value, bottom: value, left: value, right: value } });
		vi.advanceTimersByTime(16);
	}
	expect(save).not.toHaveBeenCalled();
	vi.advanceTimersByTime(150);
	expect(save).toHaveBeenCalledTimes(1);
	expect(save).toHaveBeenCalledWith({ padding: { top: 30, bottom: 30, left: 30, right: 30 } });
});

it("flushes the last change on exit and cancels its delayed write", () => {
	vi.useFakeTimers();
	const save = vi.fn();
	const queue = createPreferenceSaveQueue(save);
	queue.schedule({ cursorSize: 1.5 });
	queue.flush();
	queue.flush();
	vi.runAllTimers();
	expect(save).toHaveBeenCalledExactlyOnceWith({ cursorSize: 1.5 });
});
