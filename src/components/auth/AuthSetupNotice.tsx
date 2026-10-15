import { useI18n } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { importGoogleClient } from "@/lib/auth/googleDesktop";
import { useGoogleDesktopAuth } from "./useGoogleDesktopAuth";

export function AuthSetupNotice({
	onUseDemo,
	busy = false,
}: {
	onUseDemo?: () => void;
	busy?: boolean;
}) {
	const { t } = useI18n();
	const google = useGoogleDesktopAuth();
	const [importing, setImporting] = useState(false);
	const [error, setError] = useState<string>();
	return (
		<div
			role="status"
			className="space-y-2 rounded-xl border border-foreground/10 bg-foreground/5 p-4 text-left text-sm"
		>
			<p className="font-medium">
				{t("editor.signIn.setupTitle", "Set up Google desktop sign-in")}
			</p>
			<p className="text-xs leading-5 text-muted">
				{t(
					"editor.signIn.setupDescription",
					"Import the JSON for a Google Desktop app OAuth client once. Then sign in in your browser; no Supabase server is needed.",
				)}
			</p>
			<Button
				className="w-full"
				disabled={busy || importing || google.authorizing}
				onClick={() => {
					setImporting(true);
					setError(undefined);
					void importGoogleClient()
						.catch(() =>
							setError(
								t(
									"editor.signIn.importClientFailed",
									"Choose a valid Google Desktop app OAuth client JSON, then try again.",
								),
							),
						)
						.finally(() => setImporting(false));
				}}
			>
				{importing
					? t("editor.drive.loading", "Loading…")
					: t("editor.signIn.importClient", "Import Google Desktop client JSON")}
			</Button>
			{error && (
				<p role="alert" className="text-xs text-danger">
					{error}
				</p>
			)}
			<Button
				variant="ghost"
				size="sm"
				disabled={busy || importing}
				onClick={() =>
					void window.electronAPI.openExternalUrl(
						"https://console.cloud.google.com/auth/clients",
					)
				}
			>
				{t("editor.signIn.openGoogleConsole", "Open Google Cloud configuration")}
			</Button>
			{onUseDemo && (
				<Button variant="secondary" className="w-full" disabled={busy} onClick={onUseDemo}>
					{t("editor.signIn.tryLocal", "Use local demo (no Drive access)")}
				</Button>
			)}
		</div>
	);
}
