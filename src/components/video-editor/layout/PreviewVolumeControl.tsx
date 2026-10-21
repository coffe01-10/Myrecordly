import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { SpeakerHigh, SpeakerLow, SpeakerX } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/contexts/I18nContext";

export function PreviewVolumeControl({
	volume,
	onChange,
}: {
	volume: number;
	onChange: Dispatch<SetStateAction<number>>;
}) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const previousVolume = useRef(1);
	if (volume > 0) previousVolume.current = volume;
	useEffect(() => {
		if (!open) return;
		const wheel = (event: WheelEvent) => {
			if (
				!(event.target instanceof Element) ||
				!event.target.closest("[data-preview-volume]")
			)
				return;
			if (!event.deltaY) return;
			event.preventDefault();
			onChange((value) =>
				Math.max(
					0,
					Math.min(1, Math.round((value - Math.sign(event.deltaY) * 0.05) * 100) / 100),
				),
			);
		};
		document.addEventListener("wheel", wheel, { passive: false });
		return () => document.removeEventListener("wheel", wheel);
	}, [open, onChange]);
	const Icon = volume === 0 ? SpeakerX : volume < 0.5 ? SpeakerLow : SpeakerHigh;
	const label = t("editor.playback.volume", "Preview volume");
	return (
		<div data-preview-volume className="editor-playback-volume z-10 ml-auto flex items-center">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label={label}
						title={`${label} · ${Math.round(volume * 100)}%`}
					>
						<Icon className="size-4" />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					side="top"
					align="center"
					sideOffset={10}
					aria-label={label}
					data-preview-volume
					className="w-14 rounded-full px-2 py-3"
				>
					<div className="flex flex-col items-center gap-3">
						<span className="text-[10px] font-medium tabular-nums text-muted-foreground">
							{Math.round(volume * 100)}%
						</span>
						<Slider
							aria-label={label}
							orientation="vertical"
							min={0}
							max={1}
							step={0.01}
							value={[volume]}
							onValueChange={([value]) => onChange(value)}
							className="preview-volume-slider"
						/>
						<Button
							size="icon"
							variant="ghost"
							className="size-7 shrink-0"
							aria-label={t("editor.playback.muteUnmute", "Mute/Unmute")}
							aria-pressed={volume === 0}
							onClick={() => onChange(volume === 0 ? previousVolume.current : 0)}
						>
							<Icon className="size-4" />
						</Button>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
