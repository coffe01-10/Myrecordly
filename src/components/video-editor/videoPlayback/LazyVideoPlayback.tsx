import { lazy, Suspense, type ComponentProps } from "react";
import type VideoPlayback from "../VideoPlayback";

const Playback = lazy(() => import("../VideoPlayback"));

/** Opening the dashboard should not load or initialize the GPU renderer. */
export default function LazyVideoPlayback(props: ComponentProps<typeof VideoPlayback>) {
	if (!props.videoPath) return null;
	return (
		<Suspense fallback={null}>
			<Playback {...props} />
		</Suspense>
	);
}
