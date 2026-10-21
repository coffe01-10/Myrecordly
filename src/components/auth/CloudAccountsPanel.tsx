import { useState } from "react";
import { Cloud, ArrowSquareOut, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/contexts/I18nContext";
import { cloudProviders, type CloudAccount, type CloudProvider } from "@/types/cloudStorage";
import { cloudRequest, useCloudStorage } from "@/lib/drive/cloudStorage";
import { useGoogleDesktopAuth } from "./useGoogleDesktopAuth";
import { signInGoogleDesktop, signOutGoogleDesktop } from "@/lib/auth/googleDesktop";

export function CloudAccountsPanel({
	onSelect,
	onSelectGoogle,
}: {
	onSelect?: (account: CloudAccount) => void;
	onSelectGoogle?: () => void;
}) {
	const { t } = useI18n();
	const cloud = useCloudStorage();
	const google = useGoogleDesktopAuth();
	const [busy, setBusy] = useState<string>();
	const [error, setError] = useState<string>();
	const [renaming, setRenaming] = useState<string>();
	const [name, setName] = useState("");
	const run = async (id: string, operation: () => Promise<unknown>) => {
		setBusy(id);
		setError(undefined);
		try {
			await operation();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(undefined);
		}
	};
	const connect = (provider: CloudProvider, newSession = false) =>
		run(provider, async () => {
			const account = await cloudRequest<CloudAccount>("connect", {
				provider,
				newSession: String(newSession),
			});
			onSelect?.(account);
		});
	return (
		<div className="space-y-4">
			<p className="text-xs leading-5 text-muted-foreground">
				{t("editor.cloudAccounts.description", "连接自己的网盘，集中管理素材与成片。")}
			</p>
			<div className="grid grid-cols-2 gap-2">
				{cloudProviders.map((provider) => (
					<Button
						key={provider.id}
						variant="secondary"
						className="h-auto min-h-14 w-full justify-start gap-3 px-3 py-2 text-left"
						disabled={
							Boolean(busy) ||
							Boolean(cloud.authorizing) ||
							google.authorizing ||
							(provider.mode === "oauth" && !cloud.runtimeAvailable)
						}
						onClick={() => void connect(provider.id)}
					>
						<Cloud className="size-5 shrink-0" />
						<span className="min-w-0">
							<span className="block text-sm">{provider.name}</span>
							<span className="block text-xs font-normal text-muted-foreground">
								{provider.mode === "oauth"
									? t("editor.cloudAccounts.browserAuth", "浏览器授权")
									: t("editor.cloudAccounts.websiteSession", "官方网页会话")}
							</span>
						</span>
					</Button>
				))}
			</div>
			<div className="flex items-center justify-between gap-3 rounded-xl border border-separator p-3">
				<div className="min-w-0 text-xs">
					<strong className="block text-sm">Google Drive</strong>
					<span className="text-muted-foreground">
						{google.user?.email ??
							(google.configured
								? t("editor.cloudAccounts.googleReady", "浏览器登录并连接网盘")
								: t(
										"editor.cloudAccounts.googleUnavailable",
										"此版本尚未内置 Google 授权，请先使用其他网盘。",
									))}
					</span>
				</div>
				{google.user && onSelectGoogle && (
					<Button size="sm" variant="secondary" onClick={onSelectGoogle}>
						<ArrowSquareOut />
						{t("editor.cloudAccounts.browse", "浏览文件")}
					</Button>
				)}
				{(google.configured || google.user) && (
					<Button
						size="sm"
						variant="secondary"
						disabled={Boolean(busy) || Boolean(cloud.authorizing) || google.authorizing}
						onClick={() =>
							void run("google", () =>
								google.user ? signOutGoogleDesktop() : signInGoogleDesktop(),
							)
						}
					>
						{google.user
							? t("editor.cloudAccounts.disconnect", "断开")
							: t("editor.cloudAccounts.signIn", "登录")}
					</Button>
				)}
			</div>
			{(cloud.authorizing || google.authorizing) && (
				<div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
					<span>
						{cloud.authorizingStage === "drive"
							? t("editor.cloudAccounts.connectingDrive", "登录已完成，正在连接网盘…")
							: t("editor.cloudAccounts.signingIn", "请在打开的窗口中完成登录…")}
					</span>
					<Button
						size="sm"
						variant="ghost"
						onClick={() =>
							void run("cancel", () =>
								google.authorizing
									? window.electronAPI.googleAuthCancel()
									: cloudRequest("cancel"),
							)
						}
					>
						{t("common.actions.cancel", "取消")}
					</Button>
				</div>
			)}
			{!cloud.runtimeAvailable && (
				<p className="text-xs text-muted-foreground">
					{t(
						"editor.cloudAccounts.runtimeMissing",
						"此构建未附带直连组件，网页登录仍可使用。",
					)}
				</p>
			)}
			{cloud.sessionOnly && (
				<p className="text-xs text-muted-foreground">
					{t(
						"editor.cloudAccounts.sessionOnly",
						"系统密钥环不可用，直连授权仅保留至本次退出。",
					)}
				</p>
			)}
			{cloud.accounts.length > 0 && (
				<div className="space-y-2">
					<h3 className="text-xs font-semibold text-muted-foreground">
						{t("editor.cloudAccounts.saved", "已保存的账号与网页会话")}
					</h3>
					{cloud.accounts.map((account) => (
						<div
							key={account.id}
							className="flex items-center gap-2 rounded-xl border border-separator p-3"
						>
							<div className="min-w-0 flex-1">
								{renaming === account.id ? (
									<form
										className="flex min-w-0 items-center gap-2"
										onSubmit={(event) => {
											event.preventDefault();
											void run(account.id, async () => {
												await cloudRequest("rename", {
													id: account.id,
													name,
												});
												setRenaming(undefined);
											});
										}}
									>
										<Input
											className="min-w-0 flex-1"
											aria-label={t(
												"editor.cloudAccounts.accountName",
												"账号备注名",
											)}
											value={name}
											autoFocus
											onChange={(event) => setName(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Escape") setRenaming(undefined);
											}}
										/>
										<Button type="submit" size="sm" variant="ghost">
											{t("common.actions.save", "保存")}
										</Button>
									</form>
								) : (
									<>
										<p className="truncate text-sm font-medium">
											{account.name}
										</p>
										<p className="text-xs text-muted-foreground">
											{account.mode === "web"
												? t(
														"editor.cloudAccounts.webSaved",
														"独立网页会话 · 登录状态请在官网确认",
													)
												: t(
														"editor.cloudAccounts.connected",
														"已授权 · 可在应用内浏览与传输文件",
													)}
										</p>
									</>
								)}
							</div>
							{account.mode === "web" && (
								<Button
									size="icon"
									variant="ghost"
									title={t("editor.cloudAccounts.newSession", "新建独立网页会话")}
									disabled={Boolean(busy)}
									onClick={() => void connect(account.provider, true)}
								>
									<Plus />
								</Button>
							)}
							{(account.mode === "web" || onSelect) && (
								<Button
									size={account.mode === "web" ? "icon" : "sm"}
									variant={account.mode === "web" ? "ghost" : "secondary"}
									title={
										account.mode === "web"
											? t("editor.cloudAccounts.open", "打开网盘")
											: t("editor.cloudAccounts.browse", "浏览文件")
									}
									onClick={() =>
										account.mode === "web"
											? void run(account.id, () =>
													cloudRequest("open", { id: account.id }),
												)
											: onSelect?.(account)
									}
								>
									<ArrowSquareOut />
									{account.mode === "oauth" &&
										t("editor.cloudAccounts.browse", "浏览文件")}
								</Button>
							)}
							<Button
								size="icon"
								variant="ghost"
								title={t("editor.cloudAccounts.rename", "修改备注名")}
								onClick={() => {
									setRenaming(account.id);
									setName(account.name);
								}}
							>
								<PencilSimple />
							</Button>
							<Button
								size="icon"
								variant="ghost"
								title={t("editor.cloudAccounts.remove", "移除本机会话")}
								disabled={Boolean(busy)}
								onClick={() =>
									void run(account.id, () =>
										cloudRequest("remove", { id: account.id }),
									)
								}
							>
								<Trash />
							</Button>
						</div>
					))}
				</div>
			)}
			{(error || cloud.error) && (
				<p role="alert" className="break-words text-xs text-danger">
					{error || cloud.error}
				</p>
			)}
			<p className="text-xs leading-5 text-muted-foreground">
				{t(
					"editor.cloudAccounts.webNotice",
					"网页登录由网盘官网处理，Recordly 不读取密码，也不会仅凭打开网页就标记为授权成功。移除会话只清除此应用的本机登录，不删除云端文件。",
				)}
			</p>
		</div>
	);
}
