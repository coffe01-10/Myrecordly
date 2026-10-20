import { ModernVideoExporter } from "@/lib/exporter/modernVideoExporter";
import {
	normalizeProjectEditor,
	resolveVideoUrl,
} from "@/components/video-editor/projectPersistence";
import { buildExportRenderOptions } from "@/components/video-editor/export/buildExportRenderOptions";
import { saveExportBlob } from "@/components/video-editor/export/exportPersistence";
import {
	calculateMp4ExportDimensions,
	calculateMp4SourceDimensions,
} from "@/components/video-editor/exportDimensions";
import { DEFAULT_MP4_CODEC, probeSupportedMp4Dimensions } from "@/lib/exporter/mp4Support";
import { getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { previewEditor } from "./editCommands";
import type { RenderRequest } from "./renderTypes";

let exporter: ModernVideoExporter | null = null;
let canceled = false;
async function render(request: RenderRequest) {
	const { snapshot } = request;
	const videoUrl = await resolveVideoUrl(snapshot.sourcePath!);
	const video = document.createElement("video");
	video.preload = "metadata";
	await new Promise<void>((resolve, reject) => {
		video.onloadedmetadata = () => resolve();
		video.onerror = () => reject(new Error("Render source could not be loaded"));
		video.src = videoUrl;
	});
	let editor = normalizeProjectEditor(snapshot.editor);
	if (request.startMs !== undefined && request.endMs !== undefined)
		editor = previewEditor(editor, request.startMs, request.endMs, snapshot.sourceDurationMs);
	if (editor.clipRegions.length === 0) throw new Error("There is no footage to export");
	const sourceDimensions = calculateMp4SourceDimensions(
		video.videoWidth,
		video.videoHeight,
		editor.aspectRatio,
		editor.cropRegion,
	);
	const aspect = getAspectRatioValue(
		editor.aspectRatio,
		sourceDimensions.width / sourceDimensions.height,
	);
	const dimensions = calculateMp4ExportDimensions(
		sourceDimensions.width,
		sourceDimensions.height,
		"good",
	);
	const width =
		request.width ??
		(request.height ? Math.round((request.height * aspect) / 2) * 2 : dimensions.width);
	const height =
		request.height ??
		(request.width ? Math.round(request.width / aspect / 2) * 2 : dimensions.height);
	const supported = await probeSupportedMp4Dimensions({
		width,
		height,
		frameRate: request.fps ?? 30,
		getBitrate: (w, h) => Math.round(w * h * (request.fps ?? 30) * 0.16),
	});
	if (!supported) throw new Error(`No MP4 encoder supports ${width} × ${height}`);
	const webcamUrl = editor.webcam.sourcePath
		? await resolveVideoUrl(editor.webcam.sourcePath)
		: null;
	const options = buildExportRenderOptions({
		appearance: { ...editor, resolvedWebcamVideoUrl: webcamUrl },
		timeline: editor,
		effectiveSpeedRegions: editor.speedRegions,
		effectiveZoomRegions: editor.zoomRegions,
		effectiveCursorTelemetry: snapshot.cursorTelemetry,
		effectiveShowCursor: snapshot.effectiveShowCursor,
		previewWidth: video.videoWidth,
		previewHeight: video.videoHeight,
		shadowIntensity: editor.shadowIntensity,
		onProgress: (progress) => window.electronAPI.automationProgress(progress),
	});
	if (canceled) throw new Error("Render canceled");
	exporter = new ModernVideoExporter({
		...options,
		videoUrl,
		width: supported.width,
		height: supported.height,
		frameRate: request.fps ?? 30,
		bitrate: Math.round(supported.width * supported.height * (request.fps ?? 30) * 0.16),
		codec: DEFAULT_MP4_CODEC,
		encodingMode: "quality",
		backendPreference: "webcodecs",
		preferredEncoderPath: supported.encoderPath,
		audioRegions: editor.audioRegions,
		sourceAudioFallbackPaths: snapshot.sourceAudioFallbackPaths,
		sourceAudioFallbackStartDelayMsByPath: snapshot.sourceAudioFallbackStartDelayMsByPath,
		sourceAudioTrackSettings: snapshot.sourceAudioTrackSettings,
	});
	try {
		const result = await exporter.export();
		if (canceled) {
			if (result.tempFilePath)
				await window.electronAPI.discardExportedTemp(result.tempFilePath);
			throw new Error("Render canceled");
		}
		if (!result.success) throw new Error(result.error ?? "Video export failed");
		const save = result.tempFilePath
			? await window.electronAPI.finalizeExportedVideo({
					tempPath: result.tempFilePath,
					fileName: "export.mp4",
					outputPath: request.outputPath,
				})
			: result.blob
				? (await saveExportBlob(result.blob, "export.mp4", request.outputPath)).saveResult
				: null;
		if (!save?.success) throw new Error(save?.message ?? "Could not save exported video");
		return {
			path: save.path,
			width: supported.width,
			height: supported.height,
			metrics: result.metrics,
		};
	} finally {
		exporter = null;
		video.removeAttribute("src");
		video.load();
	}
}

window.electronAPI.onAutomationRequest((request) => {
	if (request.command === "cancel") {
		canceled = true;
		exporter?.cancel();
		window.electronAPI.automationResponse({ id: request.id, result: { canceled: true } });
		return;
	}
	if (request.command !== "render") return;
	void render(request.args as unknown as RenderRequest).then(
		(result) => window.electronAPI.automationResponse({ id: request.id, result }),
		(error) =>
			window.electronAPI.automationResponse({
				id: request.id,
				error: error instanceof Error ? error.message : String(error),
			}),
	);
});
window.electronAPI.automationReady();
