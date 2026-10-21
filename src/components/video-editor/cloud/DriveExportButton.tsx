import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ProgressBar } from "@heroui/react";
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
import { CloudAccountsPanel } from "@/components/auth/CloudAccountsPanel";
import { useGoogleDesktopAuth } from "@/components/auth/useGoogleDesktopAuth";
import { useI18n } from "@/contexts/I18nContext";
import { cloudRequest, useCloudStorage } from "@/lib/drive/cloudStorage";
import { GoogleDriveExportButton } from "./GoogleDriveExportButton";

export function DriveExportButton(props: ComponentProps<typeof GoogleDriveExportButton>) {
	const { t } = useI18n();
	const cloud = useCloudStorage();
	const google = useGoogleDesktopAuth();
	const direct = cloud.accounts.filter((account) => account.mode === "oauth");
	const [selection, setSelection] = useState("");
	const [accountsExpanded, setAccountsExpanded] = useState<boolean>();
	const selected = direct.find((account) => account.id === selection) ?? direct[0];
	const value =
		selection === "google" && google.user
			? "google"
			: (selected?.id ?? (google.user ? "google" : ""));
	const [busy, setBusy] = useState(false);
	const [phase, setPhase] = useState("prepare");
	const [error, setError] = useState<string>();
	const [saved, setSaved] = useState(false);
	const canceled = useRef(false);
	const activeId = useRef<string | undefined>(undefined);
	useEffect(() => {
		props.onBusyChange(busy);
		return () => props.onBusyChange(false);
	}, [busy, props.onBusyChange]);
	const cancel = () => {
		canceled.current = true;
		props.onCancelPrepare();
		if (activeId.current) void cloudRequest("cancel", { id: activeId.current });
	};
	useEffect(
		() => () => {
			if (activeId.current) void cloudRequest("cancel", { id: activeId.current });
		},
		[],
	);
	const save = async () => {
		if (!selected) return;
		canceled.current = false;
		activeId.current = selected.id;
		setBusy(true);
		setSaved(false);
		setError(undefined);
		setPhase("prepare");
		let file: string | undefined;
		try {
			file = await props.prepareFile();
			if (canceled.current || !file) return;
			setPhase("upload");
			await cloudRequest("upload", {
				id: selected.id,
				filePath: file,
				directory: "Recordly",
				name: `${props.projectTitle || "Recordly"}.mp4`,
			});
			if (!canceled.current) setSaved(true);
		} catch (cause) {
			if (!canceled.current) setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (file)
				await window.electronAPI
					.discardExportedTemp(file)
					.catch((cause) =>
						console.warn("Could not remove temporary cloud export", cause),
					);
			activeId.current = undefined;
			setBusy(false);
		}
	};
	return (
		<div className="space-y-4">
			{value && (
				<Select
					aria-label={t("editor.cloudAccounts.choose", "选择网盘账号")}
					value={value}
					disabled={busy}
					onValueChange={(next) => {
						setSelection(next);
						setSaved(false);
					}}
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
				<GoogleDriveExportButton {...props} />
			) : selected ? (
				<>
					<p className="text-xs text-muted-foreground">
						{t(
							"editor.cloudAccounts.exportFolder",
							"成片会保存到所选网盘的 Recordly 文件夹。",
						)}
					</p>
					{error && (
						<p role="alert" className="break-words text-xs text-danger">
							{error}
						</p>
					)}
					{busy ? (
						<>
							<ProgressBar
								aria-label={t("editor.drive.loading", "加载中…")}
								value={props.preparationProgress}
								isIndeterminate={phase === "upload"}
							>
								<ProgressBar.Track>
									<ProgressBar.Fill />
								</ProgressBar.Track>
							</ProgressBar>
							<Button className="w-full" variant="secondary" onClick={cancel}>
								{t("common.actions.cancel", "取消")}
							</Button>
						</>
					) : (
						<>
							<Button className="w-full" onClick={() => void save()}>
								{t("editor.cloudAccounts.saveVideo", "保存成片到网盘")}
							</Button>
							{saved && (
								<p role="status" className="text-sm">
									{t(
										"editor.cloudAccounts.videoSaved",
										"成片已保存到网盘 Recordly 文件夹",
									)}
								</p>
							)}
						</>
					)}
				</>
			) : null}
			<Accordion
				expandedKeys={(accountsExpanded ?? !value) ? ["accounts"] : []}
				onExpandedChange={(keys) => setAccountsExpanded(keys.has("accounts"))}
			>
				<AccordionItem id="accounts">
					<AccordionTrigger className="px-0 py-2 text-xs text-muted-foreground">
						{t("editor.cloudAccounts.manage", "管理网盘账号")}
					</AccordionTrigger>
					<AccordionContent bodyClassName="px-0 pb-0">
						<CloudAccountsPanel
							onSelect={(account) => {
								if (account.mode === "oauth") setSelection(account.id);
							}}
						/>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</div>
	);
}
