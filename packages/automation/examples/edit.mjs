import { RecordlyClient } from "@recordly/automation";

const [source, projectPath, outputPath] = process.argv.slice(2);
if (!source || !projectPath || !outputPath) {
	throw new Error(
		"Usage: node edit.mjs <absolute-video-path> <absolute-project.recordly> <absolute-output.mp4>",
	);
}
const recordly = new RecordlyClient();
const project = await recordly.openProject(source);
await recordly.applyEdits(
	[
		{
			type: "text",
			startMs: 0,
			endMs: Math.min(1500, project.durationMs),
			text: "Recordly Automation",
			y: 20,
		},
	],
	project.revision,
);
await recordly.saveProject({ path: projectPath });
const job = await recordly.exportVideo({ outputPath });
const result = await recordly.waitForJob(job.jobId, {
	onProgress: (current) =>
		process.stderr.write(`${current.status}: ${current.progress.toFixed(0)}%\n`),
});
console.log(result.result);
