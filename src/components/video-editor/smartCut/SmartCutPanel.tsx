import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import type { SmartCutAction } from "./smartCutPlan";
import type { useSmartCut } from "./useSmartCut";

function time(ms: number) {
	const seconds = Math.round(ms / 100) / 10;
	return `${Math.floor(seconds / 60)
		.toString()
		.padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

export default function SmartCutPanel({ cut }: { cut: ReturnType<typeof useSmartCut> }) {
	const { t } = useI18n();
	const choices = [
		["keep", t("editor.smartCut.keep", "Keep")],
		["delete", t("editor.smartCut.delete", "Delete")],
		["speed", t("editor.smartCut.speed", "Speed up to 4×")],
	] as const;
	return (
		<section
			className="flex h-full min-h-0 flex-col"
			aria-label={t("editor.smartCut.title", "Smart cut")}
		>
			<div className="shrink-0 space-y-2 border-b border-separator p-3">
				<div className="flex items-center justify-between gap-2">
					<h2 className="font-semibold">{t("editor.smartCut.title", "Smart cut")}</h2>
					{cut.analysis && (
						<Button size="sm" variant="ghost" onClick={() => void cut.analyze()}>
							{t("editor.smartCut.again", "Analyze again")}
						</Button>
					)}
					<Button size="sm" variant="ghost" onClick={cut.close}>
						{t("common.actions.close", "Close")}
					</Button>
				</div>
				{!cut.analysis && (
					<p className="text-xs leading-relaxed text-muted-foreground">
						{t(
							"editor.smartCut.description",
							"Find long pauses, review them in the preview, then shorten your recording in one edit.",
						)}
					</p>
				)}
				<label className="flex items-center justify-between gap-2 text-sm">
					{t("editor.smartCut.minimum", "Minimum pause")}
					<select
						className="rounded-md border border-separator bg-background p-1.5"
						value={cut.minPauseMs}
						onChange={(event) => cut.setMinPauseMs(Number(event.target.value))}
					>
						{[1000, 2000, 3000, 5000].map((value) => (
							<option key={value} value={value}>
								{value / 1000} s
							</option>
						))}
					</select>
				</label>
				{!cut.analysis && (
					<Button
						className="w-full"
						size="sm"
						disabled={cut.busy}
						onClick={() => void cut.analyze()}
					>
						{cut.busy
							? t("editor.smartCut.analyzing", "Analyzing audio…")
							: t("editor.smartCut.analyze", "Find pauses")}
					</Button>
				)}
				{cut.busy && (
					<Button className="w-full" variant="ghost" size="sm" onClick={cut.cancel}>
						{t("common.actions.cancel", "Cancel")}
					</Button>
				)}
				{cut.busy && (
					<p role="status" className="text-xs text-muted-foreground">
						{t(
							"editor.smartCut.local",
							"Analyzing locally. No model download or upload required.",
						)}
					</p>
				)}
				{cut.error && (
					<p role="alert" className="break-words text-xs text-destructive">
						{cut.error}
					</p>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{cut.analysis && (
					<>
						<details className="mb-2 text-xs leading-relaxed text-muted-foreground">
							<summary className="cursor-pointer">
								{t("editor.smartCut.criteria", "How pauses are selected")}
							</summary>
							{t(
								"editor.smartCut.safety",
								"Quiet sections with cursor activity, added audio, or no cursor data are kept by default. Each cut keeps 250 ms at both ends.",
							)}
						</details>
						{!cut.analysis.hasAudio && (
							<p role="status" className="mb-3 text-xs text-muted-foreground">
								{t(
									"editor.smartCut.noAudio",
									"No recorded audio found. Review these silent sections visually; they are kept by default.",
								)}
							</p>
						)}
						{cut.candidates.length === 0 ? (
							<p
								role="status"
								className="py-6 text-center text-sm text-muted-foreground"
							>
								{t(
									"editor.smartCut.empty",
									"No pauses match this duration. Try a shorter minimum.",
								)}
							</p>
						) : (
							<>
								<div className="mb-2 flex flex-wrap items-center gap-2">
									<span className="text-xs">
										{t("editor.smartCut.count", "{{count}} sections", {
											count: cut.candidates.length,
										})}
									</span>
									<select
										aria-label={t("editor.smartCut.bulk", "Set all sections")}
										value=""
										className="min-w-0 rounded-md border border-separator bg-background p-1 text-xs"
										onChange={(event) =>
											cut.setAll(event.target.value as SmartCutAction)
										}
									>
										<option value="" disabled>
											{t("editor.smartCut.bulk", "Set all sections")}
										</option>
										{choices.map(([value, label]) => (
											<option key={value} value={value}>
												{label}
											</option>
										))}
									</select>
								</div>
								<ol className="space-y-3">
									{cut.candidates.map((item, index) => (
										<li
											key={item.id}
											className={`rounded-xl border p-3 ${cut.previewId === item.id ? "border-primary bg-primary/5" : "border-separator bg-content1/50"}`}
										>
											<div className="mb-2 flex items-center justify-between gap-2">
												<span className="font-mono text-xs">
													{index + 1}. {time(item.startMs)}–
													{time(item.endMs)}
												</span>
												<span className="text-xs text-muted-foreground">
													{((item.endMs - item.startMs) / 1000).toFixed(
														1,
													)}{" "}
													s
												</span>
											</div>
											<p className="mb-2 text-xs text-muted-foreground">
												{item.hasAddedAudio
													? t(
															"editor.smartCut.addedAudio",
															"Added audio overlaps",
														)
													: item.activity === "active"
														? t(
																"editor.smartCut.active",
																"Cursor activity detected",
															)
														: item.activity === "idle"
															? t(
																	"editor.smartCut.idle",
																	"Quiet · no cursor activity",
																)
															: t(
																	"editor.smartCut.unknown",
																	"Quiet · no cursor data",
																)}
											</p>
											<div className="flex items-center gap-2">
												<Button
													variant="secondary"
													size="sm"
													onClick={() => cut.preview(item)}
												>
													{cut.previewId === item.id
														? t("editor.smartCut.stop", "Stop")
														: t("editor.smartCut.preview", "Preview")}
												</Button>
												<select
													aria-label={t(
														"editor.smartCut.action",
														"Action for section {{index}}",
														{ index: index + 1 },
													)}
													className="min-w-0 flex-1 rounded-md border border-separator bg-background p-2 text-xs"
													value={item.action}
													onChange={(event) =>
														cut.setAction(
															item.id,
															event.target.value as SmartCutAction,
														)
													}
												>
													{choices.map(([value, label]) => (
														<option key={value} value={value}>
															{label}
														</option>
													))}
												</select>
											</div>
										</li>
									))}
								</ol>
							</>
						)}
					</>
				)}
			</div>
			{cut.analysis && (
				<div className="shrink-0 space-y-2 border-t border-separator p-3">
					<div className="flex items-center justify-between gap-3">
						<div aria-live="polite" className="text-xs">
							<span className="text-muted-foreground">
								{t("editor.smartCut.saving", "Time saved")}
							</span>
							<strong className="block font-mono text-sm">{time(cut.savedMs)}</strong>
						</div>
						<Button disabled={cut.savedMs <= 0 || cut.busy} onClick={cut.apply}>
							{t("editor.smartCut.apply", "Apply edits")}
						</Button>
					</div>
					<p className="text-center text-xs text-muted-foreground">
						{t("editor.smartCut.undo", "One undo restores all changes.")}
					</p>
				</div>
			)}
		</section>
	);
}
