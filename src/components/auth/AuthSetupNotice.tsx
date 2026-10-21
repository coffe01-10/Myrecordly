import { useI18n } from "@/contexts/I18nContext";

export function AuthSetupNotice(_props: { onUseDemo?: () => void; busy?: boolean }) {
	const { t } = useI18n();
	return (
		<p
			role="status"
			className="rounded-xl bg-foreground/5 p-4 text-xs leading-5 text-muted-foreground"
		>
			{t(
				"editor.cloudAccounts.googleUnavailable",
				"此版本尚未内置 Google 授权，请先使用其他网盘。",
			)}
		</p>
	);
}
