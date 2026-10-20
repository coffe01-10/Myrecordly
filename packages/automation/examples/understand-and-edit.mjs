import path from "node:path";
import { RecordlyClient } from "@recordly/automation";

const [source, query, outputDirectory] = process.argv.slice(2);
if (!source || !query || !outputDirectory) {
	throw new Error(
		'Usage: node understand-and-edit.mjs <video> "search phrase" <output directory>',
	);
}
const client = new RecordlyClient();
await client.openProject(path.resolve(source));
const indexed = await client.waitForJob((await client.indexVideo()).jobId);
const indexId = indexed.result.indexId;
console.log("Index:", indexed.result);
const matches = await client.searchVideo({ indexId, query, limit: 3 });
console.log("Content matches:", matches.hits);
if (!matches.hits.length) {
	console.log(
		"No text match. Ask your AI to inspect get_storyboard and annotate_video, then search again.",
	);
} else {
	const task = await client.runEditTask({
		indexId,
		goal: `保留与“${query}”有关的片段`,
		mode: "selected",
		segmentIds: matches.hits.map((hit) => hit.segmentId),
		addCaptions: true,
		zoomClicks: true,
		projectPath: path.resolve(outputDirectory, "edited.recordly"),
		previewPath: path.resolve(outputDirectory, "preview.mp4"),
		outputPath: path.resolve(outputDirectory, "final.mp4"),
	});
	const result = await client.waitForJob(task.jobId, {
		onProgress: (job) => console.log(`${job.kind}: ${job.progress.toFixed(0)}%`),
	});
	console.log(result.result);
}
