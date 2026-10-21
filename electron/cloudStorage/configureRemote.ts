type ConfigReply = {
	State: string;
	Error?: string;
	Option?: {
		Name: string;
		Help: string;
		Default?: string | number | boolean;
		Required?: boolean;
		Examples?: { Value: string; Help?: string }[];
	};
};

/** Use rclone's application protocol so backend errors cannot loop through hidden CLI prompts. */
export async function configureRemote(
	command: (args: string[]) => Promise<string>,
	id: string,
	provider: "onedrive" | "dropbox",
	onAuthorized: () => void,
) {
	const defaults = ["config_is_local", "true"];
	const continueWith = (state: string, answer: string) => [
		"config",
		"update",
		id,
		...defaults,
		"--continue",
		"--non-interactive",
		"--state",
		state,
		"--result",
		answer,
	];
	let driveSelection: { state: string; remaining: string[] } | undefined;
	let args = ["config", "create", id, provider, ...defaults, "--non-interactive"];
	while (true) {
		const reply: ConfigReply | null = JSON.parse(await command(args));
		// OAuth is complete before the drive-selection questions are returned.
		onAuthorized();
		if (reply?.Error) {
			// /me/drives can include unusable entries before the actual OneDrive.
			// Only this specific root-query failure warrants trying another returned drive.
			if (
				provider === "onedrive" &&
				driveSelection?.remaining.length &&
				reply.Error.includes("Failed to query root for drive") &&
				reply.Error.includes("ObjectHandle is Invalid")
			) {
				args = continueWith(driveSelection.state, driveSelection.remaining.shift()!);
				continue;
			}
			throw new Error(reply.Error);
		}
		if (!reply?.State) return;
		const option = reply.Option;
		let answer =
			option?.Name === "config_type"
				? "onedrive"
				: String(option?.Default ?? option?.Examples?.[0]?.Value ?? "");
		if (provider === "onedrive" && option?.Name === "config_driveid") {
			const drives = [...(option.Examples ?? [])].sort(
				(a, b) =>
					Number(/^OneDrive \((personal|business)\)$/i.test(b.Help ?? "")) -
					Number(/^OneDrive \((personal|business)\)$/i.test(a.Help ?? "")),
			);
			const candidates = [...new Set(drives.map((drive) => drive.Value))];
			answer = candidates.shift() ?? answer;
			driveSelection = { state: reply.State, remaining: candidates };
		}
		if (option?.Required && !answer) throw new Error(option.Help);
		args = continueWith(reply.State, answer);
	}
}
