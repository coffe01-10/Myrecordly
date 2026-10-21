import { expect, test } from "@playwright/test";

test("cloud accounts separates browser authorization from website sessions", async ({ page }) => {
	await page.goto("/tests/ui/cloud-accounts.html");
	const dialog = page.getByRole("dialog", { name: "Cloud accounts", exact: true });
	await expect(
		dialog.getByRole("button", { name: "OneDrive Browser authorization" }),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "百度网盘 Official website session" }),
	).toBeVisible();
	await expect(
		dialog.locator('input[type="email"], input[type="password"], input[type="file"]'),
	).toHaveCount(0);
	await dialog.getByRole("button", { name: "百度网盘 Official website session" }).click();
	await expect(
		dialog.getByText("Independent website session · check sign-in on the official site"),
	).toHaveCount(1);
	await dialog.getByRole("button", { name: "Add separate website session" }).click();
	await expect(
		dialog.getByText("Independent website session · check sign-in on the official site"),
	).toHaveCount(2);
	await dialog.getByRole("button", { name: "Edit account label" }).last().click();
	await dialog.getByRole("textbox", { name: "Account label" }).fill("Personal files");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog.getByText("Personal files", { exact: true })).toBeVisible();
	await dialog.getByRole("button", { name: "Remove local session" }).last().click();
	await expect(dialog.getByText("Personal files", { exact: true })).toHaveCount(0);
});

test("cloud account dialog fits a compact window and reduced motion", async ({ page }) => {
	await page.setViewportSize({ width: 620, height: 740 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/tests/ui/cloud-accounts.html");
	const dialog = page.getByRole("dialog", { name: "Cloud accounts", exact: true });
	await dialog.getByRole("button", { name: "Done", exact: true }).scrollIntoViewIfNeeded();
	await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
	await dialog.getByRole("button", { name: "Done", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByRole("button", { name: "Footage", exact: true })).toBeVisible();
});
