import { createContext, useContext, useState, type ReactNode } from "react";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { useScopedT } from "@/contexts/I18nContext";

type Category = "general" | "motion" | "recording" | "files" | "advanced";
const labelKeys: Record<Category, string> = {
	general: "settingsSections.general",
	motion: "settingsSections.motion",
	recording: "settingsSections.recording",
	files: "settingsSections.files",
	advanced: "settingsSections.advanced",
};
const SettingsCategoryContext = createContext<Category | null>(null);

/** Dashboard and editor share the same controls and category selection. */
export function SettingsSections({
	children,
	categories,
}: {
	children: ReactNode;
	categories: Category[];
}) {
	const t = useScopedT("settings");
	const parent = useContext(SettingsCategoryContext);
	const [selected, setSelected] = useState<Category>("general");
	if (parent) return <div className="space-y-6">{children}</div>;
	const active = categories.includes(selected) ? selected : categories[0];
	const activeLabel = t(labelKeys[active]);
	return (
		<SettingsCategoryContext.Provider value={active}>
			<div className="space-y-6">
				<ChoiceGroup
					aria-label={t("settingsSections.aria", "Settings sections")}
					value={active}
					onValueChange={(value) => setSelected(value as Category)}
					size="sm"
				>
					{categories.map((category) => (
						<ChoiceItem key={category} value={category}>
							{t(labelKeys[category])}
						</ChoiceItem>
					))}
				</ChoiceGroup>
				<div
					role="region"
					aria-label={t("settingsSections.regionAria", "{{section}} settings", {
						section: activeLabel,
					})}
					className="space-y-6"
				>
					{children}
				</div>
			</div>
		</SettingsCategoryContext.Provider>
	);
}

export function SettingsCategory({
	category,
	children,
}: {
	category: Category | Category[];
	children: ReactNode;
}) {
	const active = useContext(SettingsCategoryContext);
	const visible = Array.isArray(category)
		? active !== null && category.includes(active)
		: active === category;
	return visible ? <div className="space-y-6">{children}</div> : null;
}
