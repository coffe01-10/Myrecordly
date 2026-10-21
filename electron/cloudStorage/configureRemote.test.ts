import { expect, it, vi } from "vitest";
import { configureRemote } from "./configureRemote";

it("finishes the OneDrive questions after browser login using their returned state", async () => {
	const command = vi
		.fn()
		.mockResolvedValueOnce(
			JSON.stringify({
				State: "choose_type_done",
				Option: { Name: "config_type", Default: "onedrive" },
			}),
		)
		.mockResolvedValueOnce(
			JSON.stringify({
				State: "driveid_final",
				Option: { Name: "config_driveid", Default: "personal-drive", Required: true },
			}),
		)
		.mockResolvedValueOnce(
			JSON.stringify({
				State: "driveid_final_end",
				Option: { Name: "config_drive_ok", Default: true },
			}),
		)
		.mockResolvedValueOnce(JSON.stringify({ State: "", Error: "", Option: null }));
	const authorized = vi.fn();
	await configureRemote(command, "account", "onedrive", authorized);
	expect(command.mock.calls[0][0]).toContain("--non-interactive");
	expect(command.mock.calls[1][0]).toEqual(
		expect.arrayContaining([
			"update",
			"account",
			"--continue",
			"--state",
			"choose_type_done",
			"--result",
			"onedrive",
		]),
	);
	expect(command.mock.calls[2][0]).toEqual(
		expect.arrayContaining(["--result", "personal-drive"]),
	);
	expect(command.mock.calls[3][0]).toEqual(expect.arrayContaining(["--result", "true"]));
	expect(authorized).toHaveBeenCalled();
});

it("reports a post-login drive error instead of retrying the hidden config menu forever", async () => {
	const command = vi.fn().mockResolvedValue(
		JSON.stringify({
			State: "choose_type",
			Error: "Failed to query available drives: accessDenied",
		}),
	);
	await expect(configureRemote(command, "account", "onedrive", () => {})).rejects.toThrow(
		"Failed to query available drives: accessDenied",
	);
	expect(command).toHaveBeenCalledTimes(1);
});

it("accepts Dropbox finishing without OneDrive selection questions", async () => {
	const command = vi
		.fn()
		.mockResolvedValue(JSON.stringify({ State: "", Error: "", Option: null }));
	await configureRemote(command, "account", "dropbox", () => {});
	expect(command).toHaveBeenCalledTimes(1);
});

it("chooses the actual OneDrive ahead of a default stale drive entry", async () => {
	const command = vi
		.fn()
		.mockResolvedValueOnce(
			JSON.stringify({
				State: "driveid_final",
				Option: {
					Name: "config_driveid",
					Default: "b!invalid-root",
					Examples: [
						{ Value: "b!invalid-root", Help: "stale-entry (personal)" },
						{ Value: "actual-drive", Help: "OneDrive (personal)" },
					],
				},
			}),
		)
		.mockResolvedValueOnce(JSON.stringify({ State: "" }));
	await configureRemote(command, "account", "onedrive", () => {});
	expect(command.mock.calls[1][0]).toEqual(expect.arrayContaining(["--result", "actual-drive"]));
});

it("continues with the next returned drive on ObjectHandle Invalid without repeating OAuth", async () => {
	const command = vi
		.fn()
		.mockResolvedValueOnce(
			JSON.stringify({
				State: "driveid_final",
				Option: {
					Name: "config_driveid",
					Default: "b!invalid-root",
					Examples: [
						{ Value: "b!invalid-root", Help: "first (personal)" },
						{ Value: "working-drive", Help: "second (personal)" },
					],
				},
			}),
		)
		.mockResolvedValueOnce(
			JSON.stringify({
				State: "choose_type",
				Error: 'Failed to query root for drive "b!invalid-root": HTTP error 400: ObjectHandle is Invalid',
			}),
		)
		.mockResolvedValueOnce(JSON.stringify({ State: "" }));
	await configureRemote(command, "account", "onedrive", () => {});
	expect(command.mock.calls[2][0]).toEqual(
		expect.arrayContaining([
			"update",
			"--continue",
			"--state",
			"driveid_final",
			"--result",
			"working-drive",
		]),
	);
	expect(command.mock.calls.filter(([args]) => args.includes("create"))).toHaveLength(1);
});

it("stops after each candidate returned an invalid root, rather than looping the drive menu", async () => {
	const error =
		'Failed to query root for drive "b!invalid-root": HTTP error 400: ObjectHandle is Invalid';
	const command = vi
		.fn()
		.mockResolvedValueOnce(
			JSON.stringify({
				State: "driveid_final",
				Option: {
					Name: "config_driveid",
					Default: "b!invalid-root",
					Examples: [{ Value: "b!invalid-root" }, { Value: "another-invalid-root" }],
				},
			}),
		)
		.mockResolvedValue(JSON.stringify({ State: "choose_type", Error: error }));
	await expect(configureRemote(command, "account", "onedrive", () => {})).rejects.toThrow(error);
	expect(command).toHaveBeenCalledTimes(3);
});
