import { useEffect, useState } from "react";
import type { CloudStorageState } from "@/types/cloudStorage";

export async function cloudRequest<T = null>(
	action: string,
	input: Record<string, string> = {},
): Promise<T> {
	const result = await window.electronAPI.cloudStorageRequest(action, input);
	if (!result.success) throw new Error(result.error);
	return result.data as T;
}
const empty: CloudStorageState = { accounts: [], runtimeAvailable: false, sessionOnly: false };
export function useCloudStorage() {
	const [state, setState] = useState(empty);
	const [error, setError] = useState<string>();
	useEffect(() => {
		let active = true;
		const refresh = () =>
			void cloudRequest<CloudStorageState>("state").then(
				(value) => {
					if (active) {
						setState(value);
						setError(undefined);
					}
				},
				(cause) => {
					if (active) setError(String(cause.message ?? cause));
				},
			);
		if (!window.electronAPI?.cloudStorageRequest) return;
		refresh();
		const unsubscribe = window.electronAPI.onCloudStorageChanged(refresh);
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);
	return { ...state, error };
}
