import { useEffect, useRef, useState } from "react";
import { GoogleDriveLogo } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import { signInWithSocial } from "@/lib/auth/recordlyAuth";
import { driveApi, notifyDriveChanged } from "@/lib/drive/googleDrive";
import type { DriveFile } from "@/types/googleDrive";
import { useGoogleDrive } from "./useGoogleDrive";
import { AuthSetupNotice } from "@/components/auth/AuthSetupNotice";

export function DriveExportButton({
	prepareFile,
	projectTitle,
	preparationProgress,
	onCancelPrepare,
	onBusyChange,
}: {
	prepareFile: () => Promise<string | undefined>;
	projectTitle: string;
	preparationProgress: number;
	onCancelPrepare: () => void;
	onBusyChange: (busy: boolean) => void;
}) {
	const { t } = useI18n();
	const drive = useGoogleDrive();
	const [busy, setBusy] = useState(false);
	const [phase, setPhase] = useState<"prepare" | "upload">("prepare");
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string>();
	const [result, setResult] = useState<DriveFile>();
	const active = useRef<{ id: string; canceled: boolean; accountId?: string } | undefined>(
		undefined,
	);
	const currentAccount = useRef(drive.user?.id);
	currentAccount.current = drive.user?.id;
	const cancelPrepare = useRef(onCancelPrepare);
	cancelPrepare.current = onCancelPrepare;
	useEffect(() => {
		onBusyChange(busy);
		return () => onBusyChange(false);
	}, [busy, onBusyChange]);
	useEffect(
		() =>
			window.electronAPI.onDriveProgress?.((event) => {
				if (event.id === active.current?.id)
					setProgress(Math.min(99, Math.round((event.transferred / event.total) * 100)));
			}),
		[],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Account switches clear success links and cancel the previous account's transfer.
	useEffect(() => {
		setResult(undefined);
		setError(undefined);
		return () => {
			if (active.current) {
				active.current.canceled = true;
				void window.electronAPI.driveCancel(active.current.id);
				cancelPrepare.current();
			}
		};
	}, [drive.user?.id]);
	const save = async () => {
		const operation = {
			id: crypto.randomUUID(),
			canceled: false,
			accountId: currentAccount.current,
		};
		active.current = operation;
		let filePath: string | undefined;
		setBusy(true);
		setPhase("prepare");
		setProgress(0);
		setError(undefined);
		setResult(undefined);
		try {
			filePath = await prepareFile();
			if (operation.canceled || currentAccount.current !== operation.accountId) return;
			if (!filePath)
				throw new Error(t("editor.cloud.prepareFailed", "Could not prepare the export."));
			setPhase("upload");
			const response = await driveApi.upload(
				filePath,
				operation,
				undefined,
				`${projectTitle || "Recordly"}.mp4`,
			);
			if (operation.canceled || currentAccount.current !== operation.accountId) return;
			if (!response.success && !response.canceled) throw new Error(response.error);
			if (response.file) {
				setResult(response.file);
				notifyDriveChanged();
			}
		} catch (cause) {
			if (!operation.canceled)
				setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			try {
				if (filePath) await window.electronAPI.discardExportedTemp(filePath);
			} catch (cause) {
				console.warn("Could not remove temporary Drive export", cause);
			} finally {
				active.current = undefined;
				setBusy(false);
			}
		}
	};
	return (
		<div className="space-y-4">
			{drive.status.reconnect && (
				<p role="status" className="text-sm text-muted">
					{t(
						"editor.signIn.googleErrors.RECONNECT_REQUIRED",
						"Google authorization expired or was revoked. Sign in again.",
					)}
				</p>
			)}
			{!drive.configured && <AuthSetupNotice />}
			{drive.authorizing && (
				<Button variant="ghost" onClick={() => void window.electronAPI.googleAuthCancel()}>
					{t("editor.signIn.cancelGoogle", "Cancel browser sign-in")}
				</Button>
			)}
			<div className="flex items-center gap-3 rounded-xl bg-foreground/5 p-4">
				<GoogleDriveLogo className="size-7" />
				<div>
					<p className="text-sm font-medium">
						{drive.status.connected ? drive.status.email : "Google Drive"}
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{t(
							"editor.drive.exportDescription",
							"Save the finished video in your Recordly folder. Folder access permissions also apply.",
						)}
					</p>
				</div>
			</div>
			{(error || drive.driveError) && (
				<p role="alert" className="text-sm text-danger">
					{error || drive.driveError}
				</p>
			)}
			{busy ? (
				<div role="status" className="space-y-3">
					<p className="text-sm">
						{phase === "prepare"
							? t("editor.drive.preparing", "Preparing your video…")
							: t("editor.drive.uploading", "Uploading to Google Drive…")}
					</p>
					<progress
						className="w-full"
						max={100}
						value={phase === "prepare" ? preparationProgress : progress}
					/>
					<Button
						className="w-full"
						variant="secondary"
						onClick={() => {
							if (active.current) {
								active.current.canceled = true;
								void window.electronAPI.driveCancel(active.current.id);
							}
							if (phase === "prepare") onCancelPrepare();
						}}
					>
						{t("editor.drive.cancel", "Cancel")}
					</Button>
				</div>
			) : result ? (
				<div className="space-y-3">
					<p role="status" className="text-sm">
						{t("editor.drive.saved", "Saved to Google Drive")}
					</p>
					<Button
						className="w-full"
						onClick={() =>
							void window.electronAPI.openExternalUrl(
								result.webViewLink ||
									`https://drive.google.com/file/d/${result.id}/view`,
							)
						}
					>
						{t("editor.drive.openDrive", "Open in Drive")}
					</Button>
				</div>
			) : drive.status.connected ? (
				<Button className="w-full" onClick={() => void save()}>
					{t("editor.drive.saveToDrive", "Save to Google Drive")}
				</Button>
			) : (
				<Button
					className="w-full"
					disabled={drive.driveLoading}
					onClick={() =>
						void signInWithSocial("google").catch((cause) => setError(String(cause)))
					}
				>
					{drive.driveLoading
						? t("editor.drive.loading", "Loading…")
						: t("editor.drive.connect", "Sign in with Google and connect Drive")}
				</Button>
			)}
		</div>
	);
}
