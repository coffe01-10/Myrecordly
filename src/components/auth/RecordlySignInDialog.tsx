import {
	Alert,
	Button,
	Description,
	FieldError,
	Form,
	Input,
	Label,
	Modal,
	Separator,
	TextField,
} from "@heroui/react";
import { GithubLogo } from "@phosphor-icons/react";
import type { User } from "@supabase/supabase-js";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { SignOut } from "@/components/ui/icons";
import { useI18n } from "@/contexts/I18nContext";
import { demoLoginEnabled } from "@/lib/auth/demoSession";
import {
	sendSignInLink,
	signInWithEmail,
	signInWithSocial,
	signOutRecordly,
} from "@/lib/auth/recordlyAuth";
import { OnboardingFeature } from "./OnboardingFeature";
import { AuthSetupNotice } from "./AuthSetupNotice";
import { useGoogleDesktopAuth } from "./useGoogleDesktopAuth";
import { importGoogleClient, GoogleDesktopError } from "@/lib/auth/googleDesktop";

const MotionDialog = motion.create(Modal.Dialog);

export type SignInReason = "account" | "share";

type Props = {
	variant?: "compact" | "wide";
	onboarding?: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	reason?: SignInReason;
	user: User | null;
	configured: boolean;
	callbackError?: string;
	onAuthenticated: () => void;
};

// Auth failures originate in the non-React auth module, so they carry stable
// English messages. Map the known ones to localized copy before display.
const AUTH_ERROR_KEYS: Array<[RegExp, string]> = [
	[/Recordly Auth is not configured/i, "editor.signIn.errors.notConfigured"],
	[/Incorrect email or password/i, "editor.signIn.errors.incorrectCredentials"],
	[/No user was returned after sign-in/i, "editor.signIn.errors.noUserReturned"],
	[/did not return a sign-in URL/i, "editor.signIn.errors.missingSignInUrl"],
	[/Could not open the sign-in page/i, "editor.signIn.errors.openSignInPageFailed"],
	[/Enter a valid work email address/i, "editor.signIn.errors.invalidWorkEmail"],
	[/Request a new sign-in link from Recordly/i, "editor.signIn.errors.requestNewLink"],
];

function friendlyAuthError(
	error: unknown,
	action: string,
	t: ReturnType<typeof useI18n>["t"],
): string {
	const message = error instanceof Error ? error.message : String(error);
	if (error instanceof GoogleDesktopError)
		return t(`editor.signIn.googleErrors.${error.code}`, message);
	for (const [pattern, key] of AUTH_ERROR_KEYS) {
		if (pattern.test(message)) return t(key, message);
	}
	if (/unsupported provider|provider is not enabled/i.test(message)) {
		if (action === "google") {
			return t("editor.cloud.googleUnavailable");
		}
		if (action === "azure")
			return t(
				"editor.signIn.microsoftUnavailable",
				"Microsoft sign-in is not available yet.",
			);
		if (action === "github")
			return t("editor.signIn.githubUnavailable", "GitHub sign-in is not available yet.");
		return t("editor.cloud.providerUnavailable");
	}
	return message;
}

export function RecordlySignInDialog({
	variant = "compact",
	onboarding = false,
	open,
	onOpenChange,
	user,
	configured,
	callbackError,
	onAuthenticated,
}: Props) {
	const { t } = useI18n();
	const google = useGoogleDesktopAuth();
	const awaitingSignIn = useRef(false);
	const wide = onboarding || variant === "wide";
	const [featureStep, setFeatureStep] = useState(-1);
	const feature = onboarding && featureStep >= 0;
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const demoEmail = demoLoginEnabled && email.trim().toLowerCase() === "test@email.com";
	const [busy, setBusy] = useState<string>();
	const [message, setMessage] = useState<string>();
	const [linkSent, setLinkSent] = useState(false);

	useEffect(() => {
		if (!open) {
			setPassword("");
			setFeatureStep(-1);
			awaitingSignIn.current = false;
			setBusy(undefined);
			setMessage(undefined);
			setLinkSent(false);
		}
	}, [open]);

	useEffect(() => {
		if (!open) return;
		if (!user) awaitingSignIn.current = true;
		else if (awaitingSignIn.current) {
			awaitingSignIn.current = false;
			setMessage(undefined);
			if (onboarding) setFeatureStep(0);
			else onAuthenticated();
		}
	}, [open, user, onAuthenticated, onboarding]);

	const run = async (label: string, action: () => Promise<unknown>) => {
		setBusy(label);
		setMessage(undefined);
		setLinkSent(false);
		try {
			await action();
		} catch (error) {
			setMessage(friendlyAuthError(error, label, t));
		} finally {
			setBusy(undefined);
		}
	};

	const submitEmail = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy) return;
		if (!demoEmail) {
			emailSignInLink();
			return;
		}
		void run("email", async () => {
			if (!configured && email.trim().toLowerCase() !== "test@email.com") {
				throw new Error(
					t("editor.signIn.emailUnavailable", "Email sign-in is not available yet."),
				);
			}
			await signInWithEmail(email.trim(), password);
		});
	};

	const emailSignInLink = () => {
		if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
			setMessage(t("editor.cloud.enterEmail"));
			return;
		}
		void run("link", async () => {
			await sendSignInLink(email.trim());
			setMessage(
				t(
					"editor.signIn.checkInbox",
					"Check your inbox to verify your email and continue to Recordly. Open the link on this computer with Recordly running.",
				),
			);
			setLinkSent(true);
		});
	};

	const reduceMotion = useReducedMotion();
	const transition = { duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] as const };
	const reveal = {
		initial: { opacity: 0, y: reduceMotion ? 0 : 10 },
		animate: { opacity: 1, y: 0 },
		transition,
	};
	const disabled = Boolean(busy);
	const expanded = email.trim().length > 0;
	const artwork = `${import.meta.env.BASE_URL}auth/login-banner.png`;
	return (
		<Modal isOpen={open} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container size="cover" placement="center" className="p-4 sm:p-8">
					<MotionDialog
						layout={!onboarding}
						transition={transition}
						aria-label={
							onboarding
								? t("editor.signIn.welcome", "Welcome to Recordly")
								: undefined
						}
						data-onboarding-state={
							onboarding ? (feature ? "feature" : "login") : undefined
						}
						className={`h-auto min-h-0 w-full max-h-[calc(100dvh-48px)] gap-0 overflow-y-auto rounded-[32px] p-2 ${wide ? `max-w-[1120px] md:grid ${feature ? "md:grid-cols-1 md:aspect-[16/10]" : "md:grid-cols-2 md:aspect-[28/19]"}` : "max-w-[600px]"}`}
					>
						<div
							data-onboarding-artwork={onboarding || undefined}
							className={`relative shrink-0 overflow-hidden rounded-[24px] ${feature ? "h-[min(680px,calc(100dvh-96px))] min-h-[440px] md:col-span-full md:h-full" : `h-32 sm:h-36 ${wide ? "md:order-2 md:h-full md:min-h-0" : ""}`}`}
						>
							<motion.img
								layout={onboarding && !reduceMotion}
								transition={{ ...transition, duration: reduceMotion ? 0 : 0.5 }}
								src={
									wide
										? `${import.meta.env.BASE_URL}auth/login-side.png`
										: artwork
								}
								alt=""
								className="absolute inset-0 size-full object-cover object-center"
							/>
							{feature && (
								<OnboardingFeature
									step={featureStep}
									onStep={setFeatureStep}
									onFinish={onAuthenticated}
								/>
							)}
						</div>
						<Modal.CloseTrigger
							aria-label={t("common.actions.close")}
							className="z-20"
						/>

						{!feature && (
							<motion.div
								layout="position"
								transition={transition}
								className={`flex flex-1 flex-col justify-center px-5 py-6 sm:px-8 ${wide ? "md:order-1 md:min-w-0" : ""}`}
							>
								<div className="w-full max-w-[420px] self-center space-y-4 @container">
									<motion.div {...reveal}>
										<Modal.Header className="items-center gap-3 text-center">
											<div
												className="flex items-center gap-3"
												aria-label="Recordly"
											>
												<img
													src={`${import.meta.env.BASE_URL}app-icons/recordly-128.png`}
													alt=""
													className="size-12 rounded-xl"
												/>
												<span className="text-3xl font-semibold tracking-tight">
													Recordly
												</span>
											</div>
											<Modal.Heading className="whitespace-nowrap text-[clamp(12px,5cqw,22px)] font-semibold leading-tight tracking-tight">
												{user
													? t("editor.signIn.yourAccount", "Your account")
													: t(
															"editor.signIn.tagline",
															"Beautiful, shareable screen recordings",
														)}
											</Modal.Heading>
											<Description className="text-sm">
												{user
													? user.email
													: t(
															"editor.signIn.signInToStart",
															"Sign in to get started",
														)}
											</Description>
										</Modal.Header>
									</motion.div>
									{user && busy === "google" && (
										<Button
											variant="ghost"
											onPress={() =>
												void window.electronAPI.googleAuthCancel()
											}
										>
											{t(
												"editor.signIn.cancelGoogle",
												"Cancel browser sign-in",
											)}
										</Button>
									)}
									{user && google.reconnect && (
										<Button
											isDisabled={disabled}
											onPress={() =>
												void run("google", () => signInWithSocial("google"))
											}
										>
											{t(
												"editor.drive.connect",
												"Sign in with Google and connect Drive",
											)}
										</Button>
									)}
									{user && onboarding ? (
										<Button
											variant="primary"
											className="w-full"
											onPress={() => setFeatureStep(0)}
										>
											{t("editor.signIn.continue", "Continue")}
										</Button>
									) : user ? (
										<Button
											variant="secondary"
											className="w-full"
											isDisabled={disabled}
											onPress={() => void run("signout", signOutRecordly)}
										>
											<SignOut className="size-4" />
											{busy === "signout"
												? t("editor.cloud.signingOut")
												: t("editor.cloud.signOut")}
										</Button>
									) : (
										<>
											{!google.configured && (
												<AuthSetupNotice
													busy={disabled}
													onUseDemo={
														demoLoginEnabled && !configured
															? () =>
																	void run("demo", () =>
																		signInWithEmail(
																			"test@email.com",
																			"1234",
																		),
																	)
															: undefined
													}
												/>
											)}
											<motion.div
												{...reveal}
												transition={{
													...transition,
													delay: reduceMotion ? 0 : 0.05,
												}}
												className="grid grid-cols-3 gap-2"
											>
												{(
													[
														{
															provider: "google",
															label: "Google",
															image: "google-logo.png",
														},
														{
															provider: "azure",
															label: "Microsoft",
															image: "microsoft-logo.svg",
														},
														{
															provider: "github",
															label: "GitHub",
															image: null,
														},
													] as const
												).map(({ provider, label, image }) => (
													<Button
														key={provider}
														variant="secondary"
														aria-label={t(
															"editor.signIn.continueWith",
															"Continue with {{provider}}",
															{ provider: label },
														)}
														className="h-11 w-full min-w-0 gap-2 rounded-xl px-2 text-xs font-medium text-foreground @[360px]:text-sm"
														isDisabled={disabled}
														onPress={() =>
															void run(provider, () =>
																signInWithSocial(provider),
															)
														}
													>
														{image ? (
															<img
																src={`${import.meta.env.BASE_URL}auth/${image}`}
																alt=""
																className="size-4 shrink-0"
															/>
														) : (
															<GithubLogo
																aria-hidden="true"
																weight="fill"
																className="size-4 shrink-0"
															/>
														)}
														{label}
													</Button>
												))}
											</motion.div>
											{busy === "google" && (
												<Button
													variant="ghost"
													onPress={() =>
														void window.electronAPI.googleAuthCancel()
													}
												>
													{t(
														"editor.signIn.cancelGoogle",
														"Cancel browser sign-in",
													)}
												</Button>
											)}
											{google.configured && (
												<Button
													variant="ghost"
													size="sm"
													isDisabled={disabled}
													onPress={() =>
														void run("import", importGoogleClient)
													}
												>
													{t(
														"editor.signIn.replaceClient",
														"Change Google client configuration",
													)}
												</Button>
											)}
											<p className="text-xs leading-5 text-muted">
												{t(
													"editor.drive.googleNotice",
													"Google sign-in also connects Drive for file storage and sharing.",
												)}
											</p>
											<div className="flex items-center gap-4">
												<Separator className="flex-1" />
												<span className="text-xs text-muted">
													{t(
														"editor.signIn.orContinueWithEmail",
														"or continue with email",
													)}
												</span>
												<Separator className="flex-1" />
											</div>
											<Form className="flex flex-col" onSubmit={submitEmail}>
												<TextField
													name="email"
													type="email"
													value={email}
													onChange={(value) => {
														setEmail(value);
														setLinkSent(false);
														setMessage(undefined);
														if (!value.trim()) setPassword("");
													}}
													isRequired
													isDisabled={disabled}
												>
													<Label>{t("editor.cloud.email")}</Label>
													<Input
														className="h-12"
														placeholder={t(
															"editor.signIn.emailPlaceholder",
															"you@example.com",
														)}
														autoComplete="email"
													/>
													<FieldError />
												</TextField>
												{!demoEmail && (
													<Button
														type="submit"
														variant="primary"
														className="mt-3 h-12 w-full"
														isDisabled={disabled}
													>
														{busy === "link"
															? t(
																	"editor.signIn.sendingLink",
																	"Sending sign-in link…",
																)
															: t(
																	"editor.signIn.emailMagicLink",
																	"Email me a magic link",
																)}
													</Button>
												)}
												<AnimatePresence initial={false}>
													{expanded && demoEmail && (
														<motion.div
															key="password-fields"
															initial={{ height: 0, opacity: 0 }}
															animate={{ height: "auto", opacity: 1 }}
															exit={{ height: 0, opacity: 0 }}
															transition={transition}
															className="overflow-hidden"
															inert={!expanded}
														>
															<motion.div
																initial={{
																	y: reduceMotion ? 0 : -8,
																}}
																animate={{ y: 0 }}
																exit={{ y: reduceMotion ? 0 : -8 }}
																transition={transition}
																className="flex flex-col gap-5 px-1 pb-1 pt-5"
															>
																<TextField
																	name="password"
																	type="password"
																	value={password}
																	onChange={setPassword}
																	isRequired
																	isDisabled={disabled}
																>
																	<Label>
																		{t("editor.cloud.password")}
																	</Label>
																	<Input
																		className="h-12"
																		autoComplete="current-password"
																	/>
																	<FieldError />
																</TextField>
																<Button
																	type="submit"
																	size="lg"
																	className="w-full"
																	isDisabled={
																		disabled ||
																		(!configured &&
																			!demoLoginEnabled)
																	}
																>
																	{busy === "email"
																		? t(
																				"editor.cloud.signingIn",
																			)
																		: t("editor.cloud.signIn")}
																</Button>
															</motion.div>
														</motion.div>
													)}
												</AnimatePresence>
											</Form>
										</>
									)}
									{onboarding && !user && (
										<Button
											variant="ghost"
											className="w-full"
											onPress={() => setFeatureStep(0)}
										>
											{t(
												"editor.signIn.continueWithout",
												"Continue without signing in",
											)}
										</Button>
									)}
									{message || callbackError ? (
										<Alert
											status={
												linkSent && !callbackError ? "success" : "danger"
											}
										>
											<Alert.Indicator />
											<Alert.Content>
												<Alert.Description>
													{message || callbackError}
												</Alert.Description>
											</Alert.Content>
										</Alert>
									) : null}
								</div>
							</motion.div>
						)}
					</MotionDialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
