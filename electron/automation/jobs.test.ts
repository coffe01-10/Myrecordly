import { expect, it } from "vitest";
import { AutomationJobs } from "./jobs";

it("cancels running work and does not publish late successful results", async () => {
	const jobs = new AutomationJobs();
	let didAbort = false;
	const { jobId } = jobs.start("analysis", async (signal) => {
		await new Promise<void>((resolve) => {
			const abort = () => {
				didAbort = true;
				resolve();
			};
			if (signal.aborted) abort();
			else signal.addEventListener("abort", abort, { once: true });
		});
		return { late: true };
	});
	expect(jobs.cancel(jobId).status).toBe("canceled");
	await jobs.close();
	expect(didAbort).toBe(true);
	expect(jobs.get(jobId).result).toBeUndefined();
});

it("records failed jobs as terminal and exposes the actual failure", async () => {
	const jobs = new AutomationJobs();
	const { jobId } = jobs.start("export", async () => {
		throw new Error("Source decode failed");
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(jobs.get(jobId)).toMatchObject({ status: "failed", error: "Source decode failed" });
	expect(jobs.cancel(jobId).status).toBe("failed");
	await jobs.close();
});
