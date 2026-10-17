import {
	createContext,
	Suspense,
	startTransition,
	use,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { I18nProvider as ReactAriaI18nProvider } from "react-aria";
import {
	type AppLocale,
	DEFAULT_LOCALE,
	I18N_NAMESPACES,
	type I18nNamespace,
	SUPPORTED_LOCALES,
} from "@/i18n/config";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { getLocaleMessages, loadLocaleMessages } from "@/i18n/messages";

const LOCALE_STORAGE_KEY = "recordly.locale";

interface I18nContextValue {
	locale: AppLocale;
	setLocale: (locale: AppLocale) => void;
	t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function isSupportedLocale(locale: string): locale is AppLocale {
	return SUPPORTED_LOCALES.includes(locale as AppLocale);
}

function normalizeLocale(locale: string | null | undefined): AppLocale {
	if (!locale) {
		return DEFAULT_LOCALE;
	}

	// Exact match first (e.g. "zh-CN")
	if (isSupportedLocale(locale)) return locale;

	// Canonicalize case (e.g. "zh-cn" → "zh-CN")
	const canonical = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === locale.toLowerCase());
	if (canonical) return canonical;

	// Handle extended subtags like "zh-Hans-CN" → try "zh-CN"
	const parts = locale.split("-");
	if (parts.length >= 3) {
		const langRegion = `${parts[0]}-${parts[parts.length - 1]}`;
		if (isSupportedLocale(langRegion)) {
			return langRegion;
		}
	}

	// Language-only fallback (e.g. "zh" matches "zh-CN")
	const lang = parts[0].toLowerCase();
	const byLang = SUPPORTED_LOCALES.find((l) => l.split("-")[0].toLowerCase() === lang);
	if (byLang) return byLang;

	return DEFAULT_LOCALE;
}

function getInitialLocale(): AppLocale {
	if (typeof window === "undefined") {
		return DEFAULT_LOCALE;
	}

	// Shared preference (main process) takes priority so the native surfaces
	// (application menu, tray) start in the same language as the renderer.
	const sharedLocale = loadAppSetting<unknown>(LOCALE_STORAGE_KEY);
	if (typeof sharedLocale === "string" && sharedLocale.length > 0) {
		return normalizeLocale(sharedLocale);
	}

	const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
	if (storedLocale) {
		return normalizeLocale(storedLocale);
	}

	return DEFAULT_LOCALE;
}

function notifyMainProcessLocale(locale: AppLocale) {
	const api = (globalThis as typeof globalThis & { electronAPI?: Window["electronAPI"] })
		.electronAPI;
	try {
		void api?.setLocale?.(locale);
	} catch {
		// Ignore: native surfaces will simply keep their current language.
	}
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

function interpolate(template: string, vars?: Record<string, string | number>) {
	if (!vars) return template;
	return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
		const value = vars[key];
		return value === undefined ? "" : String(value);
	});
}

function parseKey(key: string): { namespace: I18nNamespace; path: string } {
	const [first, ...rest] = key.split(".");
	if (I18N_NAMESPACES.includes(first as I18nNamespace) && rest.length > 0) {
		return { namespace: first as I18nNamespace, path: rest.join(".") };
	}
	return { namespace: "common", path: key };
}

function translateForLocale(
	locale: AppLocale,
	key: string,
	fallback?: string,
	vars?: Record<string, string | number>,
) {
	const { namespace, path } = parseKey(key);

	const rawValue =
		getMessageValue(getLocaleMessages(locale)?.[namespace], path) ??
		getMessageValue(getLocaleMessages(DEFAULT_LOCALE)?.[namespace], path) ??
		fallback ??
		key;

	return interpolate(rawValue, vars);
}

export function I18nProvider({ children }: { children: ReactNode }) {
	return (
		<Suspense
			fallback={
				<div
					className="flex h-screen items-center justify-center bg-editor-bg text-foreground"
					role="status"
				>
					正在加载语言…
				</div>
			}
		>
			<I18nProviderContent>{children}</I18nProviderContent>
		</Suspense>
	);
}

function I18nProviderContent({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<AppLocale>(getInitialLocale);
	if (!getLocaleMessages(locale)) use(loadLocaleMessages(locale));

	const setLocale = useCallback((nextLocale: AppLocale) => {
		startTransition(() => setLocaleState(nextLocale));
		if (typeof window !== "undefined") {
			window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
		}
		// Persist to the shared store so the main process reads the same value.
		saveAppSetting(LOCALE_STORAGE_KEY, nextLocale);
	}, []);

	useEffect(() => {
		document.documentElement.lang = locale;
	}, [locale]);

	// Push the initial locale to the main process so the application menu and
	// tray start localized even when the user never opens the language selector.
	useEffect(() => {
		notifyMainProcessLocale(locale);
	}, [locale]);

	const t = useCallback(
		(key: string, fallback?: string, vars?: Record<string, string | number>) => {
			return translateForLocale(locale, key, fallback, vars);
		},
		[locale],
	);

	const value = useMemo<I18nContextValue>(
		() => ({
			locale,
			setLocale,
			t,
		}),
		[locale, setLocale, t],
	);

	return (
		<I18nContext.Provider value={value}>
			<ReactAriaI18nProvider locale={locale}>{children}</ReactAriaI18nProvider>
		</I18nContext.Provider>
	);
}

export function translateAppMessage(key: string, fallback?: string) {
	return translateForLocale(getInitialLocale(), key, fallback);
}

export function useI18n() {
	const context = useContext(I18nContext);
	if (!context) {
		throw new Error("useI18n must be used within <I18nProvider>");
	}
	return context;
}

export function useScopedT(namespace: I18nNamespace) {
	const { t } = useI18n();
	return useCallback(
		(key: string, fallback?: string, vars?: Record<string, string | number>) => {
			return t(`${namespace}.${key}`, fallback, vars);
		},
		[namespace, t],
	);
}
