import { beforeEach, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("node:fs", () => ({ readFileSync: disk.read, writeFileSync: disk.write }));
vi.mock("./ipc/constants", () => ({ APP_SETTINGS_FILE: "app-settings.json" }));
vi.mock("./ipc/utils", () => ({
	parseJsonWithByteOrderMark: (value: string) => JSON.parse(value.replace(/^\uFEFF/, "")),
}));

beforeEach(() => {
	vi.resetModules();
	disk.read.mockReset().mockReturnValue('{"theme":"dark","editor":{"padding":20}}');
	disk.write.mockReset();
});

it("reads the settings file only once across repeated window settings requests", async () => {
	const store = await import("./appSettingsStore");
	for (let i = 0; i < 100; i++) {
		expect(store.readAppSetting("theme")).toBe("dark");
		expect(store.readAppSetting("missing")).toBeNull();
	}
	expect(disk.read).toHaveBeenCalledTimes(1);
});

it("shares saved changes without rereading disk and skips identical writes", async () => {
	const store = await import("./appSettingsStore");
	store.writeAppSetting("theme", "dark");
	expect(disk.write).not.toHaveBeenCalled();
	store.writeAppSetting("theme", "light");
	expect(store.readAppSetting("theme")).toBe("light");
	store.writeAppSetting("theme", "light");
	expect(disk.write).toHaveBeenCalledTimes(1);
	expect(disk.read).toHaveBeenCalledTimes(1);
	expect(JSON.parse(disk.write.mock.calls[0][1])).toEqual({
		theme: "light",
		editor: { padding: 20 },
	});
});

it("does not publish an unsaved mutation or failed write to other readers", async () => {
	const store = await import("./appSettingsStore");
	const snapshot = store.readAppSettingsStore();
	(snapshot.editor as { padding: number }).padding = 99;
	disk.write.mockImplementationOnce(() => {
		throw new Error("disk full");
	});
	expect(() => store.writeAppSettingsStore(snapshot)).toThrow("disk full");
	expect(store.readAppSetting("editor")).toEqual({ padding: 20 });
	const value = store.readAppSetting("editor") as { padding: number };
	value.padding = 50;
	expect(store.readAppSetting("editor")).toEqual({ padding: 20 });
	store.writeAppSettingsStore(snapshot);
	expect(store.readAppSetting("editor")).toEqual({ padding: 99 });
});

it("creates a missing store and normalizes cached values to the persisted JSON", async () => {
	disk.read.mockImplementationOnce(() => {
		throw new Error("ENOENT");
	});
	const store = await import("./appSettingsStore");
	expect(store.readAppSettingsStore()).toEqual({});
	store.writeAppSettingsStore({});
	expect(disk.write).toHaveBeenCalledTimes(1);
	store.writeAppSetting("editor", { padding: 30, unused: undefined });
	expect(store.readAppSetting("editor")).toEqual({ padding: 30 });
});
