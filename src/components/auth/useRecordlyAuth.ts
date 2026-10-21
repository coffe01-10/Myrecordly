import type { User } from "@supabase/supabase-js";
import { useGoogleDesktopAuth } from "./useGoogleDesktopAuth";
import { googleAccountUser } from "@/lib/auth/googleDesktop";
import { useCloudStorage } from "@/lib/drive/cloudStorage";

/** Local account presentation only; cloud authorization belongs to each provider. */
export function useRecordlyAuth() {
	const google = useGoogleDesktopAuth();
	const cloud = useCloudStorage();
	const account = cloud.accounts.find((item) => item.mode === "oauth");
	const user: User | null =
		googleAccountUser(google) ??
		(account
			? {
					id: account.id,
					aud: "cloud-storage",
					app_metadata: { provider: account.provider },
					user_metadata: { full_name: account.name },
					created_at: account.connectedAt,
				}
			: null);
	return {
		user,
		accessToken: undefined as string | undefined,
		loading: google.loading,
		configured: true,
		callbackError: cloud.error,
	};
}
