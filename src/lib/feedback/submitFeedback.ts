import { recordlyAuth } from "@/lib/auth/recordlyAuth";

type Translate = (
	key: string,
	fallback?: string,
	vars?: Record<string, string | number>,
) => string;

const passthrough: Translate = (_key, fallback) => fallback ?? _key;

export type FeedbackErrorCode =
	| "UNAVAILABLE"
	| "SIGN_IN_REQUIRED"
	| "INVALID_FEEDBACK"
	| "INVALID_ATTACHMENTS"
	| "FEEDBACK_LIMIT"
	| "UNCONFIRMED"
	| "UNKNOWN";

export type AttachmentIssue = "TOO_MANY_FILES" | "EMPTY_FILE" | "TOTAL_TOO_LARGE";

const FEEDBACK_ERROR_KEYS: Record<FeedbackErrorCode | AttachmentIssue, string> = {
	UNAVAILABLE: "feedback.errorUnavailable",
	SIGN_IN_REQUIRED: "feedback.errorSignInRequired",
	INVALID_FEEDBACK: "feedback.errorInvalidFeedback",
	INVALID_ATTACHMENTS: "feedback.errorInvalidAttachments",
	FEEDBACK_LIMIT: "feedback.errorLimitReached",
	UNCONFIRMED: "feedback.errorUnconfirmed",
	UNKNOWN: "feedback.errorGeneric",
	TOO_MANY_FILES: "feedback.errorTooManyFiles",
	EMPTY_FILE: "feedback.errorEmptyFile",
	TOTAL_TOO_LARGE: "feedback.errorTotalTooLarge",
};

const FEEDBACK_ERROR_MESSAGES: Record<FeedbackErrorCode | AttachmentIssue, string> = {
	UNAVAILABLE: "Feedback is unavailable until account services are configured.",
	SIGN_IN_REQUIRED: "Please sign in again to send feedback.",
	INVALID_FEEDBACK: "Check your subject and description, then try again.",
	INVALID_ATTACHMENTS: "Attach up to 5 nonempty files totaling 10 MB or less.",
	FEEDBACK_LIMIT: "You’ve reached today’s feedback limit. Please try again tomorrow.",
	UNCONFIRMED: "Feedback submission was not confirmed",
	UNKNOWN: "Could not send feedback. Please try again.",
	TOO_MANY_FILES: "Attach up to 5 files.",
	EMPTY_FILE: "Empty files cannot be attached.",
	TOTAL_TOO_LARGE: "Attachments must total 10 MB or less.",
};

export class FeedbackError extends Error {
	readonly code: FeedbackErrorCode | AttachmentIssue;

	constructor(code: FeedbackErrorCode | AttachmentIssue) {
		super(FEEDBACK_ERROR_MESSAGES[code]);
		this.code = code;
	}
}

/** Resolve a user-facing message for a submission error. Pass the scoped `t` to localize. */
export function feedbackErrorMessage(error: unknown, t: Translate = passthrough) {
	const code = error instanceof FeedbackError ? error.code : "UNKNOWN";
	return t(FEEDBACK_ERROR_KEYS[code], FEEDBACK_ERROR_MESSAGES[code]);
}

/** Resolve a user-facing message for an attachment validation issue. */
export function attachmentIssueMessage(issue: AttachmentIssue, t: Translate = passthrough) {
	return t(FEEDBACK_ERROR_KEYS[issue], FEEDBACK_ERROR_MESSAGES[issue]);
}

const SUBMISSION_CODES = new Set<string>([
	"SIGN_IN_REQUIRED",
	"INVALID_FEEDBACK",
	"INVALID_ATTACHMENTS",
	"FEEDBACK_LIMIT",
]);

export const MAX_FILES = 5;
export const MAX_BYTES = 10 * 1024 * 1024;
export function validateAttachments(files: File[]): AttachmentIssue | null {
	if (files.length > MAX_FILES) return "TOO_MANY_FILES";
	if (files.some((file) => file.size === 0)) return "EMPTY_FILE";
	if (files.reduce((total, file) => total + file.size, 0) > MAX_BYTES) return "TOTAL_TOO_LARGE";
	return null;
}
export async function submitFeedback(input: {
	title: string;
	subject: string;
	message: string;
	files: File[];
	logs: string | null;
}) {
	const client = recordlyAuth;
	if (!client) throw new FeedbackError("UNAVAILABLE");
	const { data, error } = await client.auth.getUser();
	if (error || !data.user) throw new FeedbackError("SIGN_IN_REQUIRED");
	const validation = validateAttachments(input.files);
	if (validation) throw new FeedbackError(validation);
	const body = new FormData();
	body.set("title", input.title.trim());
	body.set("subject", input.subject);
	body.set("message", input.message.trim());
	if (input.logs !== null) body.set("logs", input.logs);
	for (const file of input.files) body.append("files", file);
	const result = await client.functions.invoke("submit-feedback", { body, timeout: 60_000 });
	if (result.error) {
		const response = result.error.context;
		if (response instanceof Response) {
			if (response.status === 401) throw new FeedbackError("SIGN_IN_REQUIRED");
			const payload = await response.json().catch(() => null);
			if (payload?.code && SUBMISSION_CODES.has(payload.code)) {
				throw new FeedbackError(payload.code as FeedbackErrorCode);
			}
		}
		throw result.error;
	}
	if (result.data?.success !== true) throw new FeedbackError("UNCONFIRMED");
}
