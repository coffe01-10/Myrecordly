import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("settings button replays login and the expanding feature tour", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("button", { name: "Show onboarding" }).click();
	const tour = page.getByRole("dialog", { name: "Cloud accounts" });
	await expect(tour).toHaveAttribute("data-onboarding-state", "login");
	await expect(tour.getByRole("button", { name: "Dropbox Browser authorization" })).toBeVisible();
	await expect
		.poll(() => tour.evaluate((element) => getComputedStyle(element).opacity))
		.toBe("1");
	await page.screenshot({ path: "test-results/onboarding-login.png", animations: "disabled" });
	const artwork = tour.locator("[data-onboarding-artwork]");
	const loginWidth = (await artwork.boundingBox())!.width;
	await tour.getByRole("button", { name: "Continue to Recordly" }).click();
	await expect(tour).toHaveAttribute("data-onboarding-state", "feature");
	await expect(tour.getByRole("heading", { name: "Start with a moment." })).toBeVisible();
	await expect
		.poll(async () => (await artwork.boundingBox())!.width)
		.toBeGreaterThan(loginWidth * 1.7);
	await expect(artwork).toHaveCSS("transform", "none");
	await expect(artwork.locator(":scope > img")).toHaveCSS("transform", "none");
	await page.screenshot({ path: "test-results/onboarding-record.png", animations: "disabled" });
	await tour.getByRole("button", { name: "Next", exact: true }).click();
	await expect(tour.getByRole("heading", { name: "Make it yours." })).toBeVisible();
	await tour.getByRole("button", { name: "Next", exact: true }).click();
	await expect(tour.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
	await tour.getByRole("button", { name: "Get started" }).click();
	await expect(tour).not.toBeVisible();
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("button", { name: "Show onboarding" }).click();
	await expect(tour).toHaveAttribute("data-onboarding-state", "login");
});

test("first launch persists completion without requiring an account", async ({ page }) => {
	await installDesktopBridge(page);
	await page.addInitScript(() => {
		window.electronAPI.getAppSetting = (key) => JSON.parse(localStorage.getItem(key) || "null");
		window.electronAPI.setAppSetting = (key, value) => {
			localStorage.setItem(key, JSON.stringify(value));
			return true;
		};
	});
	await page.goto("/?windowType=editor");
	const tour = page.getByRole("dialog", { name: "Cloud accounts" });
	await tour.getByRole("button", { name: "Continue to Recordly", exact: true }).click();
	await tour.getByRole("button", { name: "Next", exact: true }).click();
	await tour.getByRole("button", { name: "Next", exact: true }).click();
	await tour.getByRole("button", { name: "Get started" }).click();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem("recordly.onboarding.v1.seen")))
		.toBe("true");
	await page.reload();
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await expect(tour).not.toBeVisible();
});

test("feature banner fits a compact window with reduced motion", async ({ page }) => {
	await installDesktopBridge(page);
	await page.setViewportSize({ width: 620, height: 740 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await page.getByRole("button", { name: "Show onboarding" }).click();
	const tour = page.getByRole("dialog", { name: "Cloud accounts" });
	await tour.getByRole("button", { name: "Continue to Recordly" }).click();
	await expect(tour.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
	await page.screenshot({ path: "test-results/onboarding-compact.png" });
	await tour.getByRole("button", { name: "Back to sign in" }).click();
	await expect(tour).toHaveAttribute("data-onboarding-state", "login");
});
