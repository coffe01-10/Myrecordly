import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/contexts/I18nContext";
import { DashboardAnnouncements } from "./DashboardAnnouncements";

const banner = { src: "/banner.svg", alt: "Product news", href: "https://example.com/news" };

function renderAnnouncements(config: Parameters<typeof DashboardAnnouncements>[0]["config"]) {
	return renderToStaticMarkup(
		<I18nProvider>
			<DashboardAnnouncements config={config} />
		</I18nProvider>,
	);
}

// Pin the locale to English so the localized navigation labels stay stable.
function stubEnglishLocale() {
	const store = new Map([["recordly.locale", "en"]]);
	vi.stubGlobal("window", {
		localStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => store.set(key, value),
		},
	});
}

describe("announcement configuration", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});
	it("hides disabled or empty announcements", () => {
		expect(renderAnnouncements({ enabled: false, banners: [banner] })).toBe("");
		expect(renderAnnouncements({ enabled: true, banners: [] })).toBe("");
	});
	it("renders a linked single image without navigation", () => {
		stubEnglishLocale();
		const html = renderAnnouncements({ enabled: true, banners: [banner] });
		expect(html).toContain('href="https://example.com/news"');
		expect(html).toContain('alt="Product news"');
		expect(html).not.toContain("Next announcement");
		expect(html).not.toContain("Previous announcement");
	});
	it("renders navigation for multiple banners and does not activate non-web links", () => {
		stubEnglishLocale();
		const html = renderAnnouncements({
			enabled: true,
			banners: [
				{ ...banner, src: "/banner-1.svg", href: "javascript:alert(1)" },
				{ ...banner, src: "/banner-2.svg" },
			],
		});
		expect(html).toContain("Next announcement");
		expect(html).not.toContain("javascript:");
	});
});
