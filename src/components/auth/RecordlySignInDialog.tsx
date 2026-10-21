import { Button, Description, Modal } from "@heroui/react";
import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { CloudAccountsPanel } from "./CloudAccountsPanel";
import { OnboardingFeature } from "./OnboardingFeature";

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

export function RecordlySignInDialog({
	variant = "compact",
	onboarding = false,
	open,
	onOpenChange,
	onAuthenticated,
}: Props) {
	const { t } = useI18n();
	const [featureStep, setFeatureStep] = useState(-1);
	const feature = onboarding && featureStep >= 0;
	const wide = onboarding || variant === "wide";
	useEffect(() => {
		if (!open) setFeatureStep(-1);
	}, [open]);
	return (
		<Modal isOpen={open} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container size="cover" placement="center" className="p-4 sm:p-8">
					<Modal.Dialog
						aria-label={t("editor.cloudAccounts.title", "网盘账号")}
						data-onboarding-state={
							onboarding ? (feature ? "feature" : "login") : undefined
						}
						className={`custom-scrollbar h-auto min-h-0 w-full max-h-[calc(100dvh-48px)] gap-0 overflow-y-auto rounded-[32px] p-2 ${wide ? `max-w-[1120px] md:grid ${feature ? "md:grid-cols-1 md:aspect-[16/10]" : "md:grid-cols-2"}` : "max-w-[600px]"}`}
					>
						<div
							data-onboarding-artwork={onboarding || undefined}
							className={`relative shrink-0 overflow-hidden rounded-[24px] ${feature ? "h-[min(680px,calc(100dvh-96px))] min-h-[440px] md:col-span-full" : `h-32 sm:h-36 ${wide ? "md:order-2 md:h-full md:min-h-0" : ""}`}`}
						>
							<img
								src={`${import.meta.env.BASE_URL}auth/${wide ? "login-side.png" : "login-banner.png"}`}
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
							aria-label={t("common.actions.close", "关闭")}
							className="z-20"
						/>
						{!feature && (
							<div
								className={`flex flex-col px-5 py-6 sm:px-8 ${wide ? "md:order-1" : ""}`}
							>
								<Modal.Header className="mb-5">
									<div className="mb-3 flex items-center gap-3">
										<img
											src={`${import.meta.env.BASE_URL}app-icons/recordly-128.png`}
											alt=""
											className="size-10 rounded-xl"
										/>
										<span className="text-2xl font-semibold">Recordly</span>
									</div>
									<Modal.Heading>
										{t("editor.cloudAccounts.title", "网盘账号")}
									</Modal.Heading>
									<Description>
										{t(
											"editor.cloudAccounts.optional",
											"录制与剪辑可直接使用，登录仅用于自己的网盘。",
										)}
									</Description>
								</Modal.Header>
								<CloudAccountsPanel />
								<Button
									className="mt-5 w-full"
									variant="secondary"
									onPress={() =>
										onboarding ? setFeatureStep(0) : onAuthenticated()
									}
								>
									{onboarding
										? t(
												"editor.cloudAccounts.continueLocal",
												"继续使用 Recordly",
											)
										: t("common.actions.done", "完成")}
								</Button>
							</div>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
