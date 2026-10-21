import { LibrarySkeleton } from "./LibrarySkeleton";
import { CloudLibrary } from "../cloud/CloudLibrary";
import { RecordNewButton } from "./RecordNewButton";
import { RawPreview } from "./RawRecordings";
import { ImageSquare } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";

import { Button } from "@/components/ui/button";

import { DashboardSettings } from "./DashboardSettings";

import { ProjectCard } from "./ProjectCard";
import type { DashboardProps } from "./types";

import type { DashboardModel } from "./useDashboardModel";

export function DashboardGrid({
	onImportFile,
	loading,
	isRaw,
	rawPreview,
	setRawPreview,
	rawLoading,
	rawError,
	refreshRaw,
	error,
	section,
	accountLabel,
	authToken,
	onSignIn,
	onShareProject,
	cloudTimelineTarget,
	visible,
	busy,
	selecting,
	toggleSelected,
	onRenameProject,
	folders,
	save,
	assignFolder,
	selected,
	openEntry,
	query,
	hasActiveFilters,
	setQuery,
	run,
	deleteEntries,
}: Pick<
	DashboardProps & DashboardModel,
	| "loading"
	| "onImportFile"
	| "isRaw"
	| "rawPreview"
	| "setRawPreview"
	| "rawLoading"
	| "rawError"
	| "refreshRaw"
	| "error"
	| "section"
	| "accountLabel"
	| "authToken"
	| "onSignIn"
	| "onShareProject"
	| "cloudTimelineTarget"
	| "visible"
	| "busy"
	| "selecting"
	| "toggleSelected"
	| "onRenameProject"
	| "folders"
	| "save"
	| "assignFolder"
	| "selected"
	| "openEntry"
	| "query"
	| "hasActiveFilters"
	| "setQuery"
	| "deleteEntries"
	| "run"
>) {
	const t = useScopedT("common");
	return (
		<>
			<main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-7 pb-10 lg:px-10">
				{error && (
					<p role="alert" className="mb-4 text-sm text-danger">
						{error}
					</p>
				)}
				{section === "settings" ? (
					<DashboardSettings onImportFile={onImportFile} />
				) : section === "shared" ? (
					<CloudLibrary
						token={authToken}
						accountLabel={accountLabel}
						onSignIn={onSignIn}
						timelineTarget={cloudTimelineTarget}
					/>
				) : (isRaw ? rawLoading : loading) ? (
					<LibrarySkeleton />
				) : visible.length ? (
					<ul
						aria-label={
							isRaw
								? t("dashboard.grid.rawFiles", "Raw files")
								: t("dashboard.grid.yourProjects", "Your projects")
						}
						className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-x-7 gap-y-10 lg:gap-x-9"
					>
						{visible.map((entry) => (
							<ProjectCard
								key={entry.path}
								onDelete={() => void deleteEntries([entry.path])}
								{...{
									accountLabel,
									entry,
									busy,
									selecting,
									selected,
									toggleSelected,
									openEntry,
									run,
									onShareProject,
									onRenameProject,
									folders,
									save,
									assignFolder,
								}}
							/>
						))}
					</ul>
				) : (
					<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
						{!isRaw && !hasActiveFilters ? (
							<span aria-hidden="true" className="text-4xl">
								🦗
							</span>
						) : (
							<ImageSquare weight="fill" className="size-8 opacity-30" />
						)}
						<p>
							{isRaw
								? rawLoading
									? t("dashboard.grid.loadingRecordings", "Loading recordings…")
									: rawError ||
										(hasActiveFilters
											? t(
													"dashboard.grid.noMatchingRaw",
													"No matching raw files",
												)
											: t(
													"dashboard.grid.noRawRecordings",
													"No raw recordings yet",
												))
								: hasActiveFilters
									? t("dashboard.grid.noMatchingProjects", "No matching projects")
									: t(
											"dashboard.grid.emptyProjects",
											"It's looking empty in here...",
										)}
						</p>
						{!isRaw && !hasActiveFilters && (
							<RecordNewButton busy={busy} run={run} first className="mt-2" />
						)}
						{isRaw && rawError && (
							<Button onClick={() => void refreshRaw()}>
								{t("dashboard.grid.retry", "Retry")}
							</Button>
						)}
						{query && (
							<Button variant="ghost" size="sm" onClick={() => setQuery("")}>
								{t("dashboard.grid.clearSearch", "Clear search")}
							</Button>
						)}
					</div>
				)}
				<RawPreview entry={rawPreview} onClose={() => setRawPreview(null)} />
			</main>
		</>
	);
}
