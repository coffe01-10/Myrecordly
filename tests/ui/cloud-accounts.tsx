import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/contexts/I18nContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { RecordlySignInDialog } from "@/components/auth/RecordlySignInDialog";
import { CloudLibrary } from "@/components/video-editor/cloud/CloudLibrary";
import { Button } from "@/components/ui/button";
import { cloudProviders, type CloudAccount } from "@/types/cloudStorage";
import "@/index.css";

const query = new URLSearchParams(location.search);
const locale = query.get("locale") || "en";
const accounts: CloudAccount[] = [
	{ id: "work", provider: "onedrive", name: "OneDrive · Work", mode: "oauth", connectedAt: "" },
	{ id: "baidu", provider: "baidu", name: "百度网盘", mode: "web", connectedAt: "" },
];
const listeners = new Set<() => void>();
window.electronAPI = {
	getAppSetting: (key: string) =>
		key === "recordly.locale"
			? locale
			: key === "recordly.theme"
				? query.get("theme") || "light"
				: null,
	setAppSetting: () => true,
	onCloudStorageChanged: (callback: () => void) => {
		listeners.add(callback);
		return () => listeners.delete(callback);
	},
	cloudStorageRequest: async (action: string, input: Record<string, string> = {}) => {
		if (action === "state")
			return {
				success: true,
				data: { accounts: [...accounts], runtimeAvailable: true, sessionOnly: false },
			};
		if (action === "list")
			return {
				success: true,
				data: input.directory
					? [
							{
								Path: "clip.mp4",
								Name: "clip.mp4",
								IsDir: false,
								Size: 2097152,
								ModTime: "",
							},
						]
					: [
							{ Path: "Footage", Name: "Footage", IsDir: true, Size: 0, ModTime: "" },
							{
								Path: "intro.mp4",
								Name: "intro.mp4",
								IsDir: false,
								Size: 8388608,
								ModTime: "",
							},
						],
			};
		let account = accounts.find((item) => item.id === input.id);
		if (action === "connect") {
			const provider = cloudProviders.find((item) => item.id === input.provider)!;
			account =
				input.newSession !== "true"
					? accounts.find((item) => item.provider === provider.id)
					: undefined;
			if (!account) {
				const count = accounts.filter((item) => item.provider === provider.id).length;
				account = {
					id: crypto.randomUUID(),
					provider: provider.id,
					name: count ? `${provider.name} · ${count + 1}` : provider.name,
					mode: provider.mode,
					connectedAt: "",
				};
				accounts.push(account);
			}
		}
		if (action === "rename" && account) account.name = input.name;
		if (action === "remove" && account) accounts.splice(accounts.indexOf(account), 1);
		for (const listener of listeners) listener();
		return { success: true, data: account ?? null };
	},
} as unknown as typeof window.electronAPI;
function Preview() {
	const [open, setOpen] = useState(true);
	return (
		<main className="mx-auto max-w-3xl p-6">
			<Button onClick={() => setOpen(true)}>Cloud accounts</Button>
			<CloudLibrary onSignIn={() => setOpen(true)} />
			<RecordlySignInDialog
				open={open}
				onOpenChange={setOpen}
				user={null}
				configured
				onAuthenticated={() => setOpen(false)}
			/>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<ThemeProvider>
		<I18nProvider>
			<Preview />
		</I18nProvider>
	</ThemeProvider>,
);
