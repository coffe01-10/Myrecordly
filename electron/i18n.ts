import en from "./i18nMessages/en.json";
import zhCN from "./i18nMessages/zh-CN.json";
import zhTW from "./i18nMessages/zh-TW.json";

/**
 * Main-process localization.
 *
 * The renderer drives its own i18n bundle; the main process only needs a small
 * set of strings for native surfaces (application menu, tray, dialogs, update
 * prompts, auth callback page). Those live in `electron/i18nMessages/*.json` and
 * are inlined into the main-process bundle at build time so no runtime file
 * lookup is required after packaging.
 *
 * The active locale is stored in the shared `app-settings.json` under the
 * `recordly.locale` key, which the renderer writes whenever the user changes the
 * language. This keeps native surfaces in sync without a dedicated IPC channel.
 */

export const APP_SETTING_LOCALE_KEY = "recordly.locale";

const SUPPORTED_LOCALES = [
	"en",
	"es",
	"fr",
	"de",
	"it",
	"nl",
	"ko",
	"pt-BR",
	"zh-CN",
	"zh-TW",
] as const;

export type MainLocale = (typeof SUPPORTED_LOCALES)[number];

const FALLBACK_LOCALE: MainLocale = "en";

// Locales without an entry here fall back to English. Add a matching
// `electron/i18nMessages/<locale>.json` and register it below to extend coverage.
const MESSAGES: Partial<Record<MainLocale, Record<string, unknown>>> = {
	en,
	"zh-CN": zhCN,
	"zh-TW": zhTW,
};

let currentLocale: MainLocale = FALLBACK_LOCALE;

function isSupportedLocale(locale: string): locale is MainLocale {
	return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

export function normalizeLocale(locale: string | null | undefined): MainLocale {
	if (!locale) {
		return FALLBACK_LOCALE;
	}

	if (isSupportedLocale(locale)) {
		return locale;
	}

	const canonical = SUPPORTED_LOCALES.find(
		(candidate) => candidate.toLowerCase() === locale.toLowerCase(),
	);
	if (canonical) {
		return canonical;
	}

	// Handle extended subtags like "zh-Hans-CN" → "zh-CN".
	const parts = locale.split("-");
	if (parts.length >= 3) {
		const languageRegion = `${parts[0]}-${parts[parts.length - 1]}`;
		if (isSupportedLocale(languageRegion)) {
			return languageRegion;
		}
	}

	// Language-only fallback (e.g. "zh" matches "zh-CN").
	const language = parts[0].toLowerCase();
	const byLanguage = SUPPORTED_LOCALES.find(
		(candidate) => candidate.split("-")[0].toLowerCase() === language,
	);
	if (byLanguage) {
		return byLanguage;
	}

	return FALLBACK_LOCALE;
}

function readStoredLocale(): MainLocale | null {
	try {
		// Required lazily: `appSettingsStore` pulls in `ipc/constants`, which reads
		// `app.getPath()` at import time. Loading it eagerly here would break any
		// unit test that imports a module calling `t()` without Electron present.
		const { readAppSetting } = require("./appSettingsStore") as {
			readAppSetting: (key: string) => unknown;
		};
		const stored = readAppSetting(APP_SETTING_LOCALE_KEY);
		if (typeof stored === "string" && stored.length > 0) {
			return normalizeLocale(stored);
		}
	} catch {
		// Fall through to the default application language.
	}
	return null;
}

/** Applies the stored preference, defaulting to Simplified Chinese. */
export function initializeMainLocale(): MainLocale {
	currentLocale = readStoredLocale() ?? "zh-CN";
	return currentLocale;
}

/** Called when the renderer reports a language change. */
export function setMainLocale(locale: string): MainLocale {
	currentLocale = normalizeLocale(locale);
	return currentLocale;
}

export function getMainLocale(): MainLocale {
	return currentLocale;
}

function getMessageValue(source: unknown, key: string): string | undefined {
	const parts = key.split(".");
	let current: unknown = source;

	for (const part of parts) {
		if (!current || typeof current !== "object" || !(part in current)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}

	return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
	if (!vars) return template;
	return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
		const value = vars[key];
		return value === undefined ? "" : String(value);
	});
}

/**
 * Translate a dot-separated key for the active main-process locale.
 * Falls back to English, then to the provided fallback string, then to the key.
 */
export function t(key: string, fallback?: string, vars?: Record<string, string | number>): string {
	const rawValue =
		getMessageValue(MESSAGES[currentLocale], key) ??
		getMessageValue(MESSAGES[FALLBACK_LOCALE], key) ??
		fallback ??
		key;

	return interpolate(rawValue, vars);
}
