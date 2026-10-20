import type { FrameImage } from "./types.js";
export function mediaToolResult(result: {
	frames: FrameImage[];
	audio?: { mimeType: "audio/wav"; data: string };
	[key: string]: unknown;
}) {
	const { frames, audio, ...metadata } = result;
	const content: Array<
		{ type: "text"; text: string } | { type: "image" | "audio"; mimeType: string; data: string }
	> = [
		{
			type: "text",
			text: JSON.stringify({
				...metadata,
				frames: frames.map(({ timeMs, mimeType }) => ({ timeMs, mimeType })),
				...(audio ? { audio: { mimeType: audio.mimeType } } : {}),
			}),
		},
	];
	for (const frame of frames) {
		content.push(
			{ type: "text", text: `SOURCE ${frame.timeMs} ms` },
			{ type: "image", mimeType: frame.mimeType, data: frame.data },
		);
	}
	if (audio) content.push({ type: "audio", mimeType: audio.mimeType, data: audio.data });
	return { content };
}
