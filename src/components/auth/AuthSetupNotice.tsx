import { useI18n } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";

export function AuthSetupNotice({
	onUseDemo,
	busy = false,
}: {
	onUseDemo?: () => void;
	busy?: boolean;
}) {
	const { t } = useI18n();
	return (
		<div
			role="status"
			className="space-y-2 rounded-xl border border-foreground/10 bg-foreground/5 p-4 text-left text-sm"
		>
			<p className="font-medium">
				{t("editor.signIn.setupTitle", "Sign-in service is not connected yet")}
			</p>
			<p className="text-xs leading-5 text-muted">
				{t(
					"editor.signIn.setupDescription",
					"Real Google and email sign-in require Google OAuth and Supabase configuration. Google Drive is not connected yet.",
				)}
			</p>
			{onUseDemo && (
				<Button variant="secondary" className="w-full" disabled={busy} onClick={onUseDemo}>
					{t("editor.signIn.tryLocal", "Use local demo (no Drive access)")}
				</Button>
			)}
		</div>
	);
}
