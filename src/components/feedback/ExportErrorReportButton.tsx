import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Accordion,
	AccordionItem,
	AccordionTrigger,
	AccordionContent,
} from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useScopedT } from "@/contexts/I18nContext";
import {
	buildExportErrorReport,
	submitExportErrorReport,
} from "@/lib/feedback/exportErrorReporting";
import type { CloudPlan } from "../../../services/supabase/functions/_shared/exportErrorReport";

export function ExportErrorReportButton({
	error,
	format,
}: {
	error: string;
	format: "mp4" | "gif";
}) {
	const t = useScopedT("dialogs");
	const [open, setOpen] = useState(false);
	const [plan, setPlan] = useState<CloudPlan>("unknown");
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState(false);
	const [sendError, setSendError] = useState("");
	const sendingRef = useRef(false);
	const report = buildExportErrorReport(error, plan, format);
	return (
		<>
			<Button
				type="button"
				variant="outline"
				className="h-8 text-xs"
				onClick={() => setOpen(true)}
			>
				{sent
					? t("errorReport.reportSent", "Report sent")
					: t("errorReport.reportError", "Report error")}
			</Button>
			<Dialog
				open={open}
				onOpenChange={(value) => {
					if (!sendingRef.current) setOpen(value);
				}}
			>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>
							{sent
								? t("errorReport.reportSent", "Report sent")
								: t("errorReport.title", "Report export error")}
						</DialogTitle>
					</DialogHeader>
					{sent ? (
						<p className="text-sm">
							{t(
								"errorReport.sentMessage",
								"Thanks. The technical report was sent to Recordly support.",
							)}
						</p>
					) : (
						<>
							<p className="text-sm text-muted-foreground">
								{t(
									"errorReport.privacyNotice",
									"Send technical details to Recordly support through Supabase. No account ID, email, recording, file path, attachments or console logs are included. Supabase may keep connection logs separately.",
								)}
							</p>
							<div className="flex flex-col gap-2 text-sm">
								<span>
									{t(
										"errorReport.cloudPlanLabel",
										"Cloud plan (optional, self-reported)",
									)}
								</span>
								<Select
									aria-label={t(
										"errorReport.cloudPlanLabel",
										"Cloud plan (optional, self-reported)",
									)}
									value={plan}
									onValueChange={(value) => setPlan(value as CloudPlan)}
									disabled={sending}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="unknown">
											{t(
												"errorReport.cloudPlanUnknown",
												"Unknown / prefer not to say",
											)}
										</SelectItem>
										<SelectItem value="paid">
											{t("errorReport.cloudPlanPaid", "Paid cloud plan")}
										</SelectItem>
										<SelectItem value="not_paid">
											{t(
												"errorReport.cloudPlanNotPaid",
												"No paid cloud plan",
											)}
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<Accordion>
								<AccordionItem id="report-data">
									<AccordionTrigger className="px-0 py-2">
										{t("errorReport.viewData", "View data to be sent")}
									</AccordionTrigger>
									<AccordionContent bodyClassName="px-0 pb-0">
										<pre className="custom-scrollbar max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
											{JSON.stringify(report, null, 2)}
										</pre>
									</AccordionContent>
								</AccordionItem>
							</Accordion>
							<p className="text-xs text-muted-foreground">
								{t(
									"errorReport.retentionNotice",
									"Reports are kept for 30 days, then removed by daily cleanup.",
								)}
							</p>
							{sendError && (
								<p role="alert" className="text-sm text-destructive">
									{sendError}
								</p>
							)}
							<Button
								disabled={sending}
								onClick={async () => {
									if (sendingRef.current) return;
									sendingRef.current = true;
									setSending(true);
									setSendError("");
									try {
										await submitExportErrorReport(report);
										setSent(true);
									} catch {
										setSendError(
											t(
												"errorReport.sendFailed",
												"Could not send the report. Please try again.",
											),
										);
									} finally {
										sendingRef.current = false;
										setSending(false);
									}
								}}
							>
								{sending
									? t("errorReport.sending", "Sending…")
									: t("errorReport.sendReport", "Send report")}
							</Button>
						</>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
