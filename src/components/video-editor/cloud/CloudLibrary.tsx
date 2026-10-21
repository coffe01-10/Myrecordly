import { useState } from "react";
import {
	Accordion,
	AccordionItem,
	AccordionTrigger,
	AccordionContent,
} from "@/components/ui/accordion";
import { useI18n } from "@/contexts/I18nContext";
import { CloudAccountsPanel } from "@/components/auth/CloudAccountsPanel";
import { useCloudStorage } from "@/lib/drive/cloudStorage";
import { useGoogleDesktopAuth } from "@/components/auth/useGoogleDesktopAuth";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { DriveLibrary } from "./DriveLibrary";
import { ConnectedCloudFiles } from "./ConnectedCloudFiles";
import type { CloudTimelineTarget } from "./useCloudVideoImport";

export function CloudLibrary({
	timelineTarget,
	initialAccountId,
}: {
	token?: string;
	accountLabel?: string;
	onSignIn: () => void;
	timelineTarget?: CloudTimelineTarget;
	initialAccountId?: string;
}) {
	const { t } = useI18n();
	const cloud = useCloudStorage();
	const google = useGoogleDesktopAuth();
	const [selection, setSelection] = useState(initialAccountId ?? "");
	const [accountsExpanded, setAccountsExpanded] = useState<boolean>();
	const direct = cloud.accounts.filter((account) => account.mode === "oauth");
	const selected = direct.find((account) => account.id === selection) ?? direct[0];
	const value =
		selection === "google" && google.user
			? "google"
			: (selected?.id ?? (google.user ? "google" : ""));
	return (
		<div className="space-y-5 py-5">
			<Accordion
				expandedKeys={
					(accountsExpanded ?? (cloud.accounts.length === 0 && !google.user))
						? ["accounts"]
						: []
				}
				onExpandedChange={(keys) => setAccountsExpanded(keys.has("accounts"))}
			>
				<AccordionItem id="accounts">
					<AccordionTrigger>
						{t("editor.cloudAccounts.manage", "管理网盘账号")}
					</AccordionTrigger>
					<AccordionContent>
						<CloudAccountsPanel
							onSelect={(account) => {
								if (account.mode === "oauth") {
									setSelection(account.id);
									setAccountsExpanded(false);
								}
							}}
							onSelectGoogle={() => {
								setSelection("google");
								setAccountsExpanded(false);
							}}
						/>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
			{value && (
				<Select
					aria-label={t("editor.cloudAccounts.choose", "选择网盘账号")}
					value={value}
					onValueChange={setSelection}
				>
					<SelectTrigger className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{direct.map((account) => (
							<SelectItem key={account.id} value={account.id}>
								{account.name}
							</SelectItem>
						))}
						{google.user && (
							<SelectItem value="google">{`Google Drive · ${google.user.email}`}</SelectItem>
						)}
					</SelectContent>
				</Select>
			)}
			{value === "google" ? (
				<DriveLibrary timelineTarget={timelineTarget} />
			) : selected ? (
				<ConnectedCloudFiles
					key={selected.id}
					account={selected}
					timelineTarget={timelineTarget}
				/>
			) : (
				<p className="py-6 text-center text-sm text-muted-foreground">
					{t(
						"editor.cloudAccounts.start",
						"添加直连账号后可在这里浏览文件；网页登录会话请点击“打开网盘”。",
					)}
				</p>
			)}
		</div>
	);
}
