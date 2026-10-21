import { useEffect, useState } from "react";
import { ProgressBar } from "@heroui/react";
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

export function ConnectedCloudFiles({ account }: { account: CloudAccount }) {
	const { t } = useI18n();
	const [directory, setDirectory] = useState("");
	const [entries, setEntries] = useState<CloudEntry[]>([]);
	const [busy, setBusy] = useState<string>();
	const [error, setError] = useState<string>();
	const [refresh, setRefresh] = useState(0);
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
					disabled={!directory || Boolean(busy)}
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
					disabled={Boolean(busy)}
					title={t("editor.drive.refresh", "刷新")}
					onClick={() => setRefresh((value) => value + 1)}
				>
					<ArrowClockwise />
				</Button>
				<Button size="sm" disabled={Boolean(busy)} onClick={() => void transfer("upload")}>
					<CloudArrowUp />
					{t("editor.drive.upload", "上传文件")}
				</Button>
			</div>
			{busy && (
				<div className="flex items-center gap-3">
					<ProgressBar
						className="flex-1"
						aria-label={t("editor.drive.loading", "加载中…")}
						isIndeterminate
					>
						<ProgressBar.Track>
							<ProgressBar.Fill />
						</ProgressBar.Track>
					</ProgressBar>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => void cloudRequest("cancel", { id: account.id })}
					>
						{t("common.actions.cancel", "取消")}
					</Button>
				</div>
			)}
			{error && (
				<p role="alert" className="break-words text-xs text-danger">
					{error}
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
								disabled={Boolean(busy)}
								onClick={() =>
									setDirectory([directory, entry.Name].filter(Boolean).join("/"))
								}
							>
								{entry.Name}
							</Button>
						) : (
							<p className="min-w-0 flex-1 truncate text-sm">{entry.Name}</p>
						)}
						{!entry.IsDir && (
							<>
								<span className="text-xs text-muted-foreground">
									{(entry.Size / 1048576).toFixed(1)} MB
								</span>
								<Button
									size="icon"
									variant="ghost"
									disabled={Boolean(busy)}
									title={t("editor.drive.download", "下载")}
									onClick={() => void transfer("download", entry)}
								>
									<DownloadSimple />
								</Button>
							</>
						)}
					</div>
				))}
				{!busy && !entries.length && !error && (
					<p className="p-8 text-center text-sm text-muted-foreground">
						{t("editor.cloudAccounts.empty", "此文件夹暂无文件")}
					</p>
				)}
			</div>
		</section>
	);
}
