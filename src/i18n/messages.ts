import { I18N_NAMESPACES, type AppLocale, type I18nNamespace } from "./config";
import enCommon from "@/i18n/locales/en/common.json";
import enDialogs from "@/i18n/locales/en/dialogs.json";
import enEditor from "@/i18n/locales/en/editor.json";
import enLaunch from "@/i18n/locales/en/launch.json";
import enSettings from "@/i18n/locales/en/settings.json";
import enShortcuts from "@/i18n/locales/en/shortcuts.json";
import enTimeline from "@/i18n/locales/en/timeline.json";
import zhCNCommon from "@/i18n/locales/zh-CN/common.json";
import zhCNDialogs from "@/i18n/locales/zh-CN/dialogs.json";
import zhCNEditor from "@/i18n/locales/zh-CN/editor.json";
import zhCNLaunch from "@/i18n/locales/zh-CN/launch.json";
import zhCNSettings from "@/i18n/locales/zh-CN/settings.json";
import zhCNShortcuts from "@/i18n/locales/zh-CN/shortcuts.json";
import zhCNTimeline from "@/i18n/locales/zh-CN/timeline.json";

export type LocaleBundle = Record<I18nNamespace, Record<string, unknown>>;
const messages: Partial<Record<AppLocale, LocaleBundle>> = {
	en: {
		common: enCommon,
		dialogs: enDialogs,
		editor: enEditor,
		launch: enLaunch,
		settings: enSettings,
		shortcuts: enShortcuts,
		timeline: enTimeline,
	},
	"zh-CN": {
		common: zhCNCommon,
		dialogs: zhCNDialogs,
		editor: zhCNEditor,
		launch: zhCNLaunch,
		settings: zhCNSettings,
		shortcuts: zhCNShortcuts,
		timeline: zhCNTimeline,
	},
};

const loaders = import.meta.glob<{ default: Record<string, unknown> }>(
	"./locales/{de,es,fr,it,ko,nl,pt-BR,zh-TW}/*.json",
);
const pendingLoads = new Map<AppLocale, Promise<LocaleBundle>>();

export function getLocaleMessages(locale: AppLocale) {
	return messages[locale];
}

export function loadLocaleMessages(locale: AppLocale): Promise<LocaleBundle> {
	const loaded = messages[locale];
	if (loaded) return Promise.resolve(loaded);
	const pending = pendingLoads.get(locale);
	if (pending) return pending;
	const request = Promise.all(
		I18N_NAMESPACES.map(async (namespace) => {
			const module = await loaders[`./locales/${locale}/${namespace}.json`]();
			return [namespace, module.default] as const;
		}),
	)
		.then((entries) => {
			const bundle = Object.fromEntries(entries) as LocaleBundle;
			messages[locale] = bundle;
			return bundle;
		})
		.catch((error) => {
			pendingLoads.delete(locale);
			throw error;
		});
	pendingLoads.set(locale, request);
	return request;
}
