import { expect, test } from '@playwright/test';
import { INVOICER_API, ORG } from './mock';

// Desk workspace setup against the mock server (MSW in the page): edit and save a version, then test the script in a
// throwaway workspace and end it. The mock plays a short setup (about 4 s) once the test's event stream opens.

test('save a setup script version, test it, then end the test', async ({ page }) => {
  await page.goto(`/o/${ORG}/p/${INVOICER_API}/desk/setup`);
  await expect(page.getByText('Version 1, saved by kim-hale')).toBeVisible();
  await expect(page.getByText('superpowers')).toBeVisible();
  await expect(page.getByText('Not tested yet')).toBeVisible();

  // Save version 2 with a note.
  await page.getByRole('textbox', { name: 'Setup script' }).press('Control+End');
  await page.getByRole('textbox', { name: 'Setup script' }).pressSequentially('\ndotnet build');
  await page.getByRole('textbox', { name: /Change note/ }).fill('Build once');
  await page.getByRole('button', { name: 'Save version 2' }).click();
  await expect(page.getByText(/Version 2, saved by alice/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Setup script versions' })).toContainText('Build once');

  // Test the saved text: the workspace goes through the phases and passes.
  await page.getByRole('button', { name: 'Test setup' }).click();
  await expect(page.getByText('Setting up')).toBeVisible();
  await expect(page.getByText('Setup passed')).toBeVisible({ timeout: 15_000 });
  const phases = page.getByRole('list', { name: 'Setup phases' });
  await expect(phases).toContainText('a91c3e2');
  await expect(phases).toContainText('2 installed, 1 blocked');
  await expect(phases).toContainText('ready for you');

  // End it: the page shows the last test, matching the saved script.
  await page.getByRole('button', { name: 'End test' }).click();
  await expect(page.getByText('Last test passed, matches the saved script')).toBeVisible();
});
