import { Tag, TagGroup } from "@heroui/react";
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react";
import { LayoutGroup } from "motion/react";
import { SelectionHighlight } from "./selection-highlight";

const SelectedChoice = createContext<string | undefined>(undefined);

/** Mutually exclusive settings, with HeroUI's keyboard-accessible tag selection. */
export function ChoiceGroup({
	value,
	onValueChange,
	children,
	className,
	...props
}: {
	value?: string;
	onValueChange?: (value: string) => void;
	children: ReactNode;
	className?: string;
	type?: "single";
	size?: "sm" | "md" | "lg";
	fullWidth?: boolean;
	"aria-label"?: string;
}) {
	const scope = useId();
	return (
		<LayoutGroup id={scope}>
			<SelectedChoice.Provider value={value}>
				<TagGroup
					size={props.size ?? "md"}
					aria-label={props["aria-label"]}
					selectionMode="single"
					disallowEmptySelection
					selectedKeys={value ? [value] : []}
					onSelectionChange={(keys) => {
						if (keys !== "all") {
							const key = Array.from(keys)[0];
							if (key !== undefined) onValueChange?.(String(key));
						}
					}}
				>
					<TagGroup.List
						className={`settings-choice-list ${className ?? "flex flex-wrap gap-2"}`}
					>
						{children}
					</TagGroup.List>
				</TagGroup>
			</SelectedChoice.Provider>
		</LayoutGroup>
	);
}
export function ChoiceItem({
	value,
	title,
	children,
	className,
	...props
}: Omit<ComponentProps<typeof Tag>, "id"> & {
	value: string;
	title?: string;
	"aria-label"?: string;
}) {
	const selected = useContext(SelectedChoice) === value;
	return (
		<Tag
			{...props}
			id={value}
			textValue={
				props.textValue ??
				title ??
				(typeof children === "string" ? children : props["aria-label"])
			}
			className={`min-h-8 justify-center ${className ?? ""}`}
		>
			{(state) => (
				<>
					{selected && <SelectionHighlight id="choice" />}
					{typeof children === "function" ? children(state) : children}
				</>
			)}
		</Tag>
	);
}
