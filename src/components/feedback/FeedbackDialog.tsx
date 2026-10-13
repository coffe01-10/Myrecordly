import { useRef, useState } from "react";
import { Button, Description, Form, Input, Label, TextArea, TextField } from "@heroui/react";
import { useRecordlyAuth } from "@/components/auth/useRecordlyAuth";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { ChatDots, File, X } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { feedbackDiagnostics } from "@/lib/feedback/diagnostics";
import {
	attachmentIssueMessage,
	feedbackErrorMessage,
	submitFeedback,
	validateAttachments,
} from "@/lib/feedback/submitFeedback";

export function FeedbackDialog({
	className,
	showLabel = true,
	onSignIn,
}: {
	className?: string;
	showLabel?: boolean;
	onSignIn?: () => void;
}) {
	const t = useScopedT("dialogs");
	const auth = useRecordlyAuth();
	const [open, setOpen] = useState(false);
	const [subject, setSubject] = useState("");
	const [message, setMessage] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [error, setError] = useState("");
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState(false);
	const sendingRef = useRef(false);
	const picker = useRef<HTMLInputElement>(null);
	function addFiles(incoming: File[]) {
		const next = [...files, ...incoming];
		const issue = validateAttachments(next);
		if (issue) {
			setError(attachmentIssueMessage(issue, t));
			return;
		}
		setFiles(next);
		setError("");
	}
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (sendingRef.current) return;
				setOpen(value);
				if (value) setSent(false);
			}}
		>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={className}
					aria-label={t("feedback.buttonLabel", "Feedback")}
				>
					<ChatDots className="size-4" />
					{showLabel && t("feedback.buttonLabel", "Feedback")}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{sent
							? t("feedback.thanksTitle", "Thanks for your feedback")
							: t("feedback.title", "Send feedback")}
					</DialogTitle>
				</DialogHeader>
				{sent ? (
					<Button onPress={() => setOpen(false)}>{t("feedback.done", "Done")}</Button>
				) : !auth.user ? (
					<div className="flex flex-col gap-4">
						<Description>
							{t("feedback.signInToSend", "Sign in to send feedback.")}
						</Description>
						{onSignIn ? (
							<Button
								onPress={() => {
									setOpen(false);
									onSignIn();
								}}
							>
								{t("feedback.signIn", "Sign in")}
							</Button>
						) : (
							<Description>
								{t("feedback.openHomeToSignIn", "Open Home to sign in.")}
							</Description>
						)}
					</div>
				) : (
					<Form
						className="flex flex-col gap-4"
						onSubmit={async (event) => {
							event.preventDefault();
							if (sendingRef.current) return;
							if (!subject.trim() || !message.trim()) {
								setError(
									t(
										"feedback.addSubjectAndDescription",
										"Add a subject and description.",
									),
								);
								return;
							}
							sendingRef.current = true;
							setSending(true);
							setError("");
							try {
								await submitFeedback({
									title: subject,
									subject: "other",
									message,
									files,
									logs: feedbackDiagnostics(),
								});
								setSent(true);
								setSubject("");
								setMessage("");
								setFiles([]);
							} catch (error) {
								setError(feedbackErrorMessage(error, t));
							} finally {
								sendingRef.current = false;
								setSending(false);
							}
						}}
					>
						<TextField
							name="subject"
							isRequired
							isDisabled={sending}
							value={subject}
							onChange={(value) => {
								setSubject(value);
								setError("");
							}}
							className="w-full"
						>
							<Label>{t("feedback.subjectLabel", "Subject")}</Label>
							<Input
								maxLength={160}
								placeholder={t(
									"feedback.subjectPlaceholder",
									"What’s on your mind?",
								)}
							/>
						</TextField>
						<TextField
							name="description"
							isRequired
							isDisabled={sending}
							value={message}
							onChange={(value) => {
								setMessage(value);
								setError("");
							}}
							className="w-full"
						>
							<Label>{t("feedback.descriptionLabel", "Description")}</Label>
							<TextArea
								maxLength={10000}
								rows={5}
								className="resize-y"
								placeholder={t("feedback.descriptionPlaceholder", "Tell us more…")}
								onPaste={(event) => {
									const pasted = Array.from(event.clipboardData.files);
									if (pasted.length) {
										event.preventDefault();
										addFiles(pasted);
									}
								}}
							/>
						</TextField>
						<input
							ref={picker}
							type="file"
							multiple
							hidden
							disabled={sending}
							aria-label={t("feedback.attachFiles", "Attach files")}
							onChange={(event) => {
								addFiles(Array.from(event.target.files ?? []));
								event.target.value = "";
							}}
						/>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="self-start"
							isDisabled={sending}
							onPress={() => picker.current?.click()}
						>
							<File className="size-4" />
							{t("feedback.attachFiles", "Attach files")}
						</Button>
						{files.length > 0 && (
							<div className="flex flex-col gap-1">
								{files.map((file, index) => (
									<div
										key={`${file.name}-${index}`}
										className="flex items-center gap-2 text-sm"
									>
										<span className="min-w-0 flex-1 truncate">{file.name}</span>
										<Button
											type="button"
											isIconOnly
											size="sm"
											variant="ghost"
											isDisabled={sending}
											aria-label={t(
												"feedback.removeFile",
												"Remove {{name}}",
												{ name: file.name },
											)}
											onPress={() =>
												setFiles(files.filter((_, i) => i !== index))
											}
										>
											<X className="size-3" />
										</Button>
									</div>
								))}
							</div>
						)}
						<Description className="text-xs">
							{t(
								"feedback.diagnosticsNotice",
								"Diagnostics will be sent along with your feedback.",
							)}
						</Description>
						{error && (
							<Description role="alert" className="text-danger">
								{error}
							</Description>
						)}
						<Button type="submit" isDisabled={sending} className="w-full">
							{sending
								? t("feedback.sending", "Sending…")
								: t("feedback.send", "Send feedback")}
						</Button>
					</Form>
				)}
			</DialogContent>
		</Dialog>
	);
}
