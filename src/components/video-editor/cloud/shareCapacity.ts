export const FREE_RECORDING_LIMIT = 5;

export async function checkShareCapacity(
	endpoint: string,
	token: string,
	unavailableMessage = "Could not check cloud storage. Try again.",
): Promise<boolean> {
	const result = await window.electronAPI.cloudShareManage({ endpoint, token, action: "list" });
	if (!result.success || !Array.isArray(result.videos)) {
		throw new Error(result.error || unavailableMessage);
	}
	// Pending uploads occupy slots too, matching the backend's atomic quota check.
	return result.videos.length < FREE_RECORDING_LIMIT;
}

const capacityListeners = new Set<() => void>();

/** Refresh active quota checks after a successful library mutation in this renderer. */
export function subscribeShareCapacityChanges(listener: () => void): () => void {
	capacityListeners.add(listener);
	return () => {
		capacityListeners.delete(listener);
	};
}

export function notifyShareCapacityChanged(): void {
	for (const listener of capacityListeners) listener();
}
