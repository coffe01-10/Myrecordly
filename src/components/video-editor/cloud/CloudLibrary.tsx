import { useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { DriveLibrary } from "./DriveLibrary";
import { SharedRecordings } from "./SharedRecordings";
import { CLOUD_SHARE_ENDPOINT } from "./endpoint";
import { recordlyAuthConfigured } from "@/lib/auth/client";

export function CloudLibrary({
	token,
	accountLabel,
	onSignIn,
}: {
	token?: string;
	accountLabel?: string;
	onSignIn: () => void;
}) {
	const { t } = useI18n();
	const [tab, setTab] = useState("drive");
	return (
		<div>
			<div
				className="flex gap-2 border-b border-foreground/10 py-4"
				role="tablist"
				aria-label={t("editor.drive.storage", "Cloud storage")}
			>
				<Button
					role="tab"
					aria-selected={tab === "drive"}
					variant={tab === "drive" ? "secondary" : "ghost"}
					onClick={() => setTab("drive")}
				>
					Google Drive
				</Button>
				{recordlyAuthConfigured && (
					<Button
						role="tab"
						aria-selected={tab === "share"}
						variant={tab === "share" ? "secondary" : "ghost"}
						onClick={() => setTab("share")}
					>
						Recordly Share
					</Button>
				)}
			</div>
			{tab === "drive" ? (
				<DriveLibrary />
			) : token && CLOUD_SHARE_ENDPOINT ? (
				<SharedRecordings
					token={token}
					endpoint={CLOUD_SHARE_ENDPOINT}
					accountLabel={accountLabel}
					standalone
				/>
			) : (
				<div className="flex h-64 flex-col items-center justify-center gap-4 text-sm text-muted-foreground">
					<p>
						{token
							? t(
									"editor.cloud.sharingUnavailable",
									"Cloud sharing is not available in this build yet.",
								)
							: t(
									"editor.cloud.signInRequired",
									"Sign in to manage shared recordings.",
								)}
					</p>
					{!token && (
						<Button onClick={onSignIn}>{t("editor.cloud.signIn", "Sign in")}</Button>
					)}
				</div>
			)}
		</div>
	);
}
