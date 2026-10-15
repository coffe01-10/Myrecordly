import { useCallback, useEffect, useRef, useState } from "react";
import { useRecordlyAuth } from "@/components/auth/useRecordlyAuth";
import { driveApi, GoogleDriveError, subscribeDriveChanges } from "@/lib/drive/googleDrive";
import type { DriveStatus } from "@/types/googleDrive";

export function useGoogleDrive() {
	const auth = useRecordlyAuth();
	const [status, setStatus] = useState<DriveStatus>({ connected: false });
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const generation = useRef(0);
	const refresh = useCallback(async () => {
		const request = ++generation.current;
		setError(undefined);
		if (!auth.accessToken) {
			setStatus({ connected: false });
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const next = await driveApi.status();
			if (request === generation.current) setStatus(next);
		} catch (cause) {
			if (request !== generation.current) return;
			setError(cause instanceof Error ? cause.message : String(cause));
			setStatus({
				connected: false,
				reconnect: cause instanceof GoogleDriveError && cause.code === "RECONNECT_REQUIRED",
			});
		} finally {
			if (request === generation.current) setLoading(false);
		}
	}, [auth.accessToken]);
	useEffect(() => {
		void refresh();
		const changed = () => void refresh();
		const unsubscribe = subscribeDriveChanges(changed);
		return () => {
			generation.current++;
			unsubscribe();
		};
	}, [refresh]);
	return { ...auth, status, driveLoading: loading, driveError: error, refresh };
}
