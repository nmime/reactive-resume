import { expect, test } from "../fixtures/test";

test("updates the profile name from settings and persists it", async ({ authPage: page }) => {
	await page.goto("/dashboard/settings/profile");

	const updatedName = `E2E Renamed ${Date.now()}`;
	const nameField = page.getByLabel("Name", { exact: true });
	await expect(nameField).toBeVisible();
	await nameField.fill(updatedName);
	await page.getByRole("button", { name: "Save Changes" }).click();

	// The save round-trips through the API; a reload must show the new value
	await page.reload();
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue(updatedName);
});
