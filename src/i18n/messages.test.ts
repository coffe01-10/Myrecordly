import { expect, it } from "vitest";
import { I18N_NAMESPACES } from "./config";
import { getLocaleMessages, loadLocaleMessages } from "./messages";

it("keeps Chinese and English ready without loading other languages", () => {
	expect(getLocaleMessages("zh-CN")?.common.actions).toMatchObject({ cancel: "取消" });
	expect(getLocaleMessages("en")?.common.actions).toMatchObject({ cancel: "Cancel" });
	expect(getLocaleMessages("fr")).toBeUndefined();
});

it("shares a language load and publishes its complete bundle before switching", async () => {
	const first = loadLocaleMessages("fr");
	expect(loadLocaleMessages("fr")).toBe(first);
	const bundle = await first;
	expect(Object.keys(bundle).sort()).toEqual([...I18N_NAMESPACES].sort());
	expect(bundle.common.actions).toMatchObject({ cancel: "Annuler" });
	expect(getLocaleMessages("fr")).toBe(bundle);
	expect(await loadLocaleMessages("fr")).toBe(bundle);
});
