import { useEffect, useState } from "react";
import {
	Folder,
	File,
	DownloadSimple,
	ArrowUp,
	ArrowClockwise,
	CloudArrowUp,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import { cloudRequest } from "@/lib/drive/cloudStorage";
import type { CloudAccount, CloudEntry } from "@/types/cloudStorage";
import { isLibraryVideo, type RecordingLibraryEntry } from "@/types/recordingLibrary";
import { CloudVideoActions } from "./CloudVideoActions";
import { CloudTransferProgress } from "./CloudTransferProgress";
import { useCloudVideoImport, type CloudTimelineTarget } from "./useCloudVideoImport";

export function ConnectedCloudFiles({
	account,
	timelineTarget,
}: {
	account: CloudAccount;
	timelineTarget?: CloudTimelineTarget;
}) {
	const { t } = useI18n();
	const [directory, setDirectory] = useState("");
	const [entries, setEntries] = useState<CloudEntry[]>([]);
	const [busy, setBusy] = useState<string>();
	const [error, setError] = useState<string>();
	const [refresh, setRefresh] = useState(0);
	const importer = useCloudVideoImport({
		accountId: account.id,
		timelineTarget,
		download: (remotePath, operation) =>
			cloudRequest<RecordingLibraryEntry>("import", {
				id: account.id,
				path: remotePath,
				operationId: operation.id,
			}),
		cancel: (id) => cloudRequest("cancel", { id }),
	});
	const blocked = Boolean(busy) || importer.busy;
	useEffect(() => {
		let active = true;
		setBusy("list");
		setError(undefined);
		setEntries([]);
		void cloudRequest<CloudEntry[]>("list", { id: account.id, directory })
			.then(
				(result) => {
					if (active)
						setEntries(
							result.sort(
								(a, b) =>
									Number(b.IsDir) - Number(a.IsDir) ||
									a.Name.localeCompare(b.Name),
							),
						);
				},
				(cause) => {
					if (active) setError(cause.message);
				},
			)
			.finally(() => {
				if (active) setBusy(undefined);
			});
		return () => {
			active = false;
		};
	}, [account.id, directory, refresh]);
	const transfer = async (action: "upload" | "download", file?: CloudEntry) => {
		setBusy(action);
		setError(undefined);
		try {
			await cloudRequest(action, {
				id: account.id,
				directory,
				path: [directory, file?.Name].filter(Boolean).join("/"),
			});
			if (action === "upload") setRefresh((value) => value + 1);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(undefined);
		}
	};
	return (
		<section className="space-y-3 py-5" aria-label={account.name}>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					size="icon"
					variant="ghost"
					disabled={!directory || blocked}
					title={t("editor.cloudAccounts.parent", "上一级")}
					onClick={() => setDirectory(directory.split("/").slice(0, -1).join("/"))}
				>
					<ArrowUp />
				</Button>
				<p className="min-w-0 flex-1 truncate text-sm">
					{account.name} / {directory}
				</p>
				<Button
					size="icon"
					variant="ghost"
					disabled={blocked}
					title={t("editor.drive.refresh", "刷新")}
					onClick={() => setRefresh((value) => value + 1)}
				>
					<ArrowClockwise />
				</Button>
				<Button disabled={blocked} onClick={() => void transfer("upload")}>
					<CloudArrowUp />
					{t("editor.drive.upload", "上传文件")}
				</Button>
			</div>
			{blocked && (
				<CloudTransferProgress
					onCancel={() =>
						void (importer.busy
							? importer.cancel()
							: cloudRequest("cancel", { id: account.id }))
					}
				/>
			)}
			{(error || importer.error) && (
				<p role="alert" className="break-words text-xs text-danger">
					{error || importer.error}
				</p>
			)}
			{importer.status && (
				<p role="status" className="text-xs text-muted-foreground">
					{importer.status}
				</p>
			)}
			<div className="divide-y divide-separator rounded-2xl border border-separator">
				{entries.map((entry) => (
					<div key={entry.Path} className="flex items-center gap-3 px-3 py-2">
						{entry.IsDir ? (
							<Folder className="size-5 shrink-0 text-muted-foreground" />
						) : (
							<File className="size-5 shrink-0 text-muted-foreground" />
						)}
						{entry.IsDir ? (
							<Button
								variant="ghost"
								className="min-w-0 flex-1 justify-start truncate text-left text-sm"
								disabled={blocked}
								onClick={() =>
									setDirectory([directory, entry.Name].filter(Boolean).join("/"))
								}
							>
								{entry.Name}
							</Button>
						) : (
							<p title={entry.Name} className="min-w-0 flex-1 truncate text-sm">
								{entry.Name}
							</p>
						)}
						{!entry.IsDir && (
							<>
								<span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
									{(entry.Size / 1048576).toFixed(1)} MB
								</span>
								{isLibraryVideo(entry.Name) ? (
									<CloudVideoActions
										name={entry.Name}
										imported={Boolean(
											importer.entries[
												[directory, entry.Name].filter(Boolean).join("/")
											],
										)}
										disabled={blocked}
										canAdd={Boolean(timelineTarget)}
										onImport={(add) =>
											void importer.start(
												[directory, entry.Name].filter(Boolean).join("/"),
												add,
											)
										}
									/>
								) : (
									<Button
										size="icon"
										variant="ghost"
										disabled={blocked}
										title={t("editor.drive.download", "下载")}
										onClick={() => void transfer("download", entry)}
									>
										<DownloadSimple />
									</Button>
								)}
							</>
						)}
					</div>
				))}
				{!blocked && !entries.length && !error && (
					<p className="p-8 text-center text-sm text-muted-foreground">
						{t("editor.cloudAccounts.empty", "此文件夹暂无文件")}
					</p>
				)}
			</div>
		</section>
	);
}
