import { ProgressBar } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";

export function CloudTransferProgress({
	progress,
	onCancel,
}: {
	progress?: number;
	onCancel: () => void;
}) {
	const { t } = useI18n();
	const label = t("editor.drive.loading", "Loading…");
	return (
		<div role="status" className="flex items-center gap-3 text-xs text-muted-foreground">
			<ProgressBar
				aria-label={label}
				className="flex-1"
				value={progress}
				isIndeterminate={progress === undefined}
			>
				<ProgressBar.Track>
					<ProgressBar.Fill />
				</ProgressBar.Track>
			</ProgressBar>
			<span className="shrink-0 tabular-nums">
				{progress === undefined ? label : `${progress}%`}
			</span>
			<Button size="sm" variant="ghost" onClick={onCancel}>
				{t("common.actions.cancel", "Cancel")}
			</Button>
		</div>
	);
}
