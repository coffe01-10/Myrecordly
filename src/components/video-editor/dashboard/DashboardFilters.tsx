import type { DashboardProps } from "./types";
import { Dropdown } from "@heroui/react";
import { CaretDown, Trash } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";

import { Button } from "@/components/ui/button";

import type { DashboardModel } from "./useDashboardModel";

export function DashboardFilters({
	isRaw,
	period,
	setPeriod,
	selecting,
	setSelecting,
	selected,
	setSelected,
	sort,
	setSort,
	visible,
	busy,
	deleteEntries,
	hideSelection = false,
}: Pick<
	DashboardModel & DashboardProps,
	| "isRaw"
	| "period"
	| "setPeriod"
	| "selecting"
	| "setSelecting"
	| "selected"
	| "setSelected"
	| "sort"
	| "setSort"
	| "visible"
	| "busy"
	| "deleteEntries"
> & { hideSelection?: boolean }) {
	const t = useScopedT("common");
	return (
		<>
			<div className="flex items-center gap-3 px-7 pb-7 lg:px-10">
				<div
					className="flex gap-2"
					aria-label={t("dashboard.filters.timeFilters", "Time filters")}
				>
					{[
						["all", t("dashboard.filters.all", "All")],
						["week", t("dashboard.filters.lastSevenDays", "Last 7 days")],
						["month", t("dashboard.filters.lastThirtyDays", "Last 30 days")],
					].map(([id, label]) => (
						<Button
							key={id}
							variant="ghost"
							size="sm"
							aria-pressed={period === id}
							onClick={() => setPeriod(id)}
							className={`h-7 rounded-lg px-3 text-xs ${period === id ? "bg-default/60 text-foreground" : "text-muted-foreground"}`}
						>
							{label}
						</Button>
					))}
					{!hideSelection && (
						<Button
							variant="ghost"
							size="icon"
							className="size-7 min-w-7 text-danger"
							aria-label={
								isRaw
									? t("dashboard.filters.selectRaw", "Select raw files to remove")
									: t(
											"dashboard.filters.selectProjects",
											"Select projects to delete",
										)
							}
							aria-pressed={selecting}
							onClick={() => {
								setSelecting(!selecting);
								setSelected([]);
							}}
						>
							<Trash weight="fill" className="size-4" />
						</Button>
					)}
				</div>
				<div className="ml-auto">
					<Dropdown>
						<Button
							variant="ghost"
							size="sm"
							aria-label={
								isRaw
									? t("dashboard.filters.sortRaw", "Sort raw files")
									: t("dashboard.filters.sortProjects", "Sort projects")
							}
							className="h-7 gap-2 text-xs text-muted-foreground"
						>
							{sort === "recent"
								? isRaw
									? t("dashboard.filters.lastCreated", "Last created")
									: t("dashboard.filters.lastEdited", "Last edited")
								: sort === "created"
									? t("dashboard.filters.lastCreated", "Last created")
									: t("dashboard.filters.name", "Name")}
							<CaretDown className="size-3" />
						</Button>
						<Dropdown.Popover>
							<Dropdown.Menu
								aria-label={
									isRaw
										? t("dashboard.filters.sortRaw", "Sort raw files")
										: t("dashboard.filters.sortProjects", "Sort projects")
								}
							>
								{!isRaw && (
									<Dropdown.Item id="recent" onAction={() => setSort("recent")}>
										{t("dashboard.filters.lastEdited", "Last edited")}
									</Dropdown.Item>
								)}
								<Dropdown.Item id="created" onAction={() => setSort("created")}>
									{t("dashboard.filters.lastCreated", "Last created")}
								</Dropdown.Item>
								<Dropdown.Item id="name" onAction={() => setSort("name")}>
									{t("dashboard.filters.name", "Name")}
								</Dropdown.Item>
							</Dropdown.Menu>
						</Dropdown.Popover>
					</Dropdown>
				</div>
			</div>
			{selecting && (
				<div className="flex items-center gap-3 px-7 pb-5 text-xs lg:px-10">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setSelected(visible.map((e) => e.path))}
					>
						{t("dashboard.filters.selectAll", "Select all")}
					</Button>
					<span>
						{t("dashboard.filters.selectedCount", "{{count}} selected", {
							count: selected.length,
						})}
					</span>
					<Button
						variant="destructive"
						size="sm"
						disabled={!selected.length || busy}
						onClick={() => void deleteEntries(selected)}
					>
						{isRaw
							? t("dashboard.filters.remove", "Remove")
							: t("actions.delete", "Delete")}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setSelecting(false);
							setSelected([]);
						}}
					>
						{t("actions.cancel", "Cancel")}
					</Button>
				</div>
			)}
		</>
	);
}
