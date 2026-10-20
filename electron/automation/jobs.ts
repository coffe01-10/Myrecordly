import { randomUUID } from "node:crypto";
import type { Job } from "../../packages/automation/src/types";

export class AutomationJobs {
	private jobs = new Map<
		string,
		{ job: Job; controller: AbortController; done: Promise<void> }
	>();

	start(
		kind: Job["kind"],
		run: (signal: AbortSignal, progress: (percentage: number) => void) => Promise<unknown>,
	) {
		const id = randomUUID();
		const controller = new AbortController();
		const job: Job = { id, kind, status: "running", progress: 0, cancellable: true };
		const done = Promise.resolve()
			.then(() =>
				run(controller.signal, (percentage) => {
					if (!controller.signal.aborted) job.progress = percentage;
				}),
			)
			.then((result) => {
				if (!controller.signal.aborted) {
					job.result = result;
					job.progress = 100;
					job.status = "completed";
				}
			})
			.catch((error) => {
				if (!controller.signal.aborted) {
					job.status = "failed";
					job.error = error instanceof Error ? error.message : String(error);
				}
			});
		this.jobs.set(id, { job, controller, done });
		return { jobId: id };
	}

	get(id: string): Job {
		const entry = this.jobs.get(id);
		if (!entry) throw new Error(`Unknown job: ${id}`);
		return structuredClone(entry.job);
	}

	cancel(id: string) {
		const entry = this.jobs.get(id);
		if (!entry) throw new Error(`Unknown job: ${id}`);
		if (entry.job.status === "running") {
			entry.job.status = "canceled";
			entry.controller.abort();
		}
		return this.get(id);
	}

	async close() {
		for (const id of this.jobs.keys()) this.cancel(id);
		await Promise.all([...this.jobs.values()].map((entry) => entry.done));
	}
}
