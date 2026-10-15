import { useSyncExternalStore } from "react";
import { getGoogleSnapshot, subscribeGoogleAuth } from "@/lib/auth/googleDesktop";

export function useGoogleDesktopAuth() {
	return useSyncExternalStore(subscribeGoogleAuth, getGoogleSnapshot, getGoogleSnapshot);
}
