import { Button } from "@/components/ui/button";
import {
	Accordion,
	AccordionItem,
	AccordionTrigger,
	AccordionContent,
} from "@/components/ui/accordion";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
				<div className="flex items-center justify-between gap-2 text-sm">
					<span>{t("editor.smartCut.minimum", "Minimum pause")}</span>
					<Select
						aria-label={t("editor.smartCut.minimum", "Minimum pause")}
						className="w-20"
						value={String(cut.minPauseMs)}
						onValueChange={(value) => cut.setMinPauseMs(Number(value))}
					>
						<SelectTrigger className="h-8 w-full text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{[1000, 2000, 3000, 5000].map((value) => (
								<SelectItem key={value} value={String(value)}>
									{`${value / 1000} s`}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
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
			<div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
				{cut.analysis && (
					<>
						<Accordion className="mb-2">
							<AccordionItem id="criteria">
								<AccordionTrigger className="px-0 py-2 text-xs text-muted-foreground">
									{t("editor.smartCut.criteria", "How pauses are selected")}
								</AccordionTrigger>
								<AccordionContent bodyClassName="px-0 pb-2 text-xs leading-relaxed">
									{t(
										"editor.smartCut.safety",
										"Quiet sections with cursor activity, added audio, or no cursor data are kept by default. Each cut keeps 250 ms at both ends.",
									)}
								</AccordionContent>
							</AccordionItem>
						</Accordion>
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
									<Select
										aria-label={t("editor.smartCut.bulk", "Set all sections")}
										value=""
										className="min-w-0 w-auto"
										onValueChange={(value) =>
											cut.setAll(value as SmartCutAction)
										}
									>
										<SelectTrigger className="h-8 text-xs">
											<SelectValue
												placeholder={t(
													"editor.smartCut.bulk",
													"Set all sections",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											{choices.map(([value, label]) => (
												<SelectItem key={value} value={value}>
													{label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<ol className="space-y-3">
									{cut.candidates.map((item, index) => (
										<li
											key={item.id}
											className={`rounded-xl border p-3 ${cut.previewId === item.id ? "border-primary bg-primary/5" : "border-separator bg-surface-secondary"}`}
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
												<Select
													aria-label={t(
														"editor.smartCut.action",
														"Action for section {{index}}",
														{ index: index + 1 },
													)}
													className="min-w-0 flex-1"
													value={item.action}
													onValueChange={(value) =>
														cut.setAction(
															item.id,
															value as SmartCutAction,
														)
													}
												>
													<SelectTrigger className="h-8 w-full text-xs">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{choices.map(([value, label]) => (
															<SelectItem key={value} value={value}>
																{label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
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
