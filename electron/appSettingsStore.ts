import { readFileSync, writeFileSync } from "node:fs";
import { APP_SETTINGS_FILE } from "./ipc/constants";
import { parseJsonWithByteOrderMark } from "./ipc/utils";

// The main process owns settings for every window. Read the file once instead
// of blocking both processes on disk for every synchronous settings IPC.
let cachedStore: Record<string, unknown> | undefined;
let cachedJson: string | undefined;

function getAppSettingsStore(): Record<string, unknown> {
	if (cachedStore) return cachedStore;
	try {
		const content = readFileSync(APP_SETTINGS_FILE, "utf-8");
		const parsed = parseJsonWithByteOrderMark<unknown>(content);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			cachedStore = {};
		} else {
			cachedStore = parsed as Record<string, unknown>;
			cachedJson = JSON.stringify(cachedStore, null, 2);
		}
	} catch {
		cachedStore = {};
	}
	return cachedStore;
}

export function readAppSettingsStore(): Record<string, unknown> {
	// Callers edit a snapshot; a failed save must not change the shared cache.
	return structuredClone(getAppSettingsStore());
}

export function writeAppSettingsStore(store: Record<string, unknown>) {
	const json = JSON.stringify(store, null, 2);
	if (json === cachedJson) return;
	writeFileSync(APP_SETTINGS_FILE, json, "utf-8");
	cachedStore = JSON.parse(json) as Record<string, unknown>;
	cachedJson = json;
}

export function hasAppSetting(store: Record<string, unknown>, key: string): boolean {
	return Reflect.getOwnPropertyDescriptor(store, key) !== undefined;
}

export function readAppSetting(key: string): unknown {
	const store = getAppSettingsStore();
	return hasAppSetting(store, key) ? structuredClone(store[key]) : null;
}

export function writeAppSetting(key: string, value: unknown) {
	const store = readAppSettingsStore();
	store[key] = value;
	writeAppSettingsStore(store);
}
