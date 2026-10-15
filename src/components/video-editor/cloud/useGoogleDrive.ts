import { useCallback, useEffect, useRef, useState } from "react";
import { useRecordlyAuth } from "@/components/auth/useRecordlyAuth";
import { driveApi, GoogleDriveError, subscribeDriveChanges } from "@/lib/drive/googleDrive";
import type { DriveStatus } from "@/types/googleDrive";
import { useGoogleDesktopAuth } from "@/components/auth/useGoogleDesktopAuth";

export function useGoogleDrive() {
	const auth = useRecordlyAuth();
	const google = useGoogleDesktopAuth();
	const [status, setStatus] = useState<DriveStatus>({ connected: false });
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const generation = useRef(0);
	const refresh = useCallback(async () => {
		const request = ++generation.current;
		setError(undefined);
		if (!google.user || google.reconnect) {
			setStatus({ connected: false, reconnect: google.reconnect, email: google.user?.email });
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
	}, [google.user, google.reconnect]);
	useEffect(() => {
		void refresh();
		const changed = () => void refresh();
		const unsubscribe = subscribeDriveChanges(changed);
		return () => {
			generation.current++;
			unsubscribe();
		};
	}, [refresh]);
	return {
		...auth,
		configured: google.configured,
		authorizing: google.authorizing,
		sessionOnly: google.sessionOnly,
		status,
		driveLoading: loading || google.loading || google.authorizing,
		driveError: error || google.error,
		refresh,
	};
}
