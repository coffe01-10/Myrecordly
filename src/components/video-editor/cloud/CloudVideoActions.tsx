import { Check, DownloadSimple, Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";

export function CloudVideoActions({
	name,
	imported,
	disabled,
	canAdd,
	onImport,
}: {
	name: string;
	imported: boolean;
	disabled: boolean;
	canAdd: boolean;
	onImport: (addToTimeline: boolean) => void;
}) {
	const { t } = useI18n();
	return (
		<>
			<Button
				size="sm"
				variant="secondary"
				disabled={disabled || imported}
				onClick={() => onImport(false)}
			>
				{imported ? <Check /> : <DownloadSimple />}
				{imported
					? t("editor.cloudImport.imported", "已导入")
					: t("editor.cloudImport.import", "导入素材库")}
			</Button>
			{canAdd && (
				<Button
					size="icon"
					variant="ghost"
					disabled={disabled}
					title={t("editor.clips.addToTimeline", "Add {{name}} to timeline", {
						name,
					})}
					onClick={() => onImport(true)}
				>
					<Plus />
				</Button>
			)}
		</>
	);
}
