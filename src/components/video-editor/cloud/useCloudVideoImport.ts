import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import type { RecordingLibraryEntry } from "@/types/recordingLibrary";
import type { DriveOperation } from "@/lib/drive/googleDrive";

export type CloudTimelineTarget = {
	projectKey: string | null;
	add: (path: string) => Promise<boolean>;
	cancel: () => Promise<void>;
};

export function useCloudVideoImport({
	accountId,
	download,
	cancel,
	timelineTarget,
}: {
	accountId?: string;
	download: (
		key: string,
		operation: DriveOperation,
	) => Promise<RecordingLibraryEntry | undefined>;
	cancel: (id: string) => Promise<unknown>;
	timelineTarget?: CloudTimelineTarget;
}) {
	const { t } = useI18n();
	const [entries, setEntries] = useState<Record<string, RecordingLibraryEntry>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [status, setStatus] = useState<string>();
	const active = useRef<(DriveOperation & { adding?: boolean }) | undefined>(undefined);
	const cancelRef = useRef(cancel);
	cancelRef.current = cancel;
	const targetRef = useRef(timelineTarget);
	targetRef.current = timelineTarget;
	useEffect(() => {
		setEntries({});
		setError(undefined);
		setStatus(undefined);
		setBusy(false);
		return () => {
			const operation = active.current;
			if (operation) {
				operation.canceled = true;
				if (operation.adding) void targetRef.current?.cancel();
				else void cancelRef.current(operation.id);
				active.current = undefined;
			}
		};
	}, [accountId]);
	const stop = async () => {
		const operation = active.current;
		if (!operation) return;
		operation.canceled = true;
		try {
			if (operation.adding) await timelineTarget?.cancel();
			else await cancelRef.current(operation.id);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};
	const start = async (key: string, addToTimeline: boolean) => {
		if (active.current) return;
		const operation = { id: crypto.randomUUID(), accountId, canceled: false, adding: false };
		active.current = operation;
		setBusy(true);
		setError(undefined);
		setStatus(undefined);
		try {
			const entry = entries[key] ?? (await download(key, operation));
			if (active.current !== operation || !entry) return;
			setEntries((previous) => ({ ...previous, [key]: entry }));
			setStatus(
				t("editor.cloudImport.importedFile", "已加入素材库：{{name}}", {
					name: entry.name,
				}),
			);
			if (addToTimeline && !operation.canceled && timelineTarget) {
				if (timelineTarget.projectKey !== targetRef.current?.projectKey) {
					setError(
						t(
							"editor.cloudImport.projectChanged",
							"视频已加入素材库。当前项目已切换，请重新点击加入时间轴。",
						),
					);
					return;
				}
				operation.adding = true;
				await timelineTarget.add(entry.path);
			}
		} catch (cause) {
			if (active.current === operation && !operation.canceled)
				setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (active.current === operation) {
				active.current = undefined;
				setBusy(false);
			}
		}
	};
	return { entries, busy, error, status, start, cancel: stop };
}
