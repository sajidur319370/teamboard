import { expect, test } from '@playwright/test';
import { boardReady, card, login } from './helpers';

// J5 / FR-RBAC-04: the UI hides what a Viewer may not do (the API refuses it anyway).
test('a viewer is read-only on the board and in the drawer', async ({ page }) => {
  await login(page, 'viewer');
  await page.goto('/w/acme/p/WEB/board?sprint=all');
  await boardReady(page, 'Marketing Site');
  await expect(page.getByPlaceholder('+ Add task')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Add column/ })).toHaveCount(0);

  await card(page, 'WEB-1').click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('textbox')).toHaveCount(0); // no editable fields, no comment box
  await expect(drawer.getByRole('button', { name: 'Delete task' })).toHaveCount(0);
});

test('a viewer can open the reports (J5)', async ({ page }) => {
  await login(page, 'viewer');
  await page.goto('/w/acme/p/MOB/reports');
  await expect(page.getByRole('heading', { name: 'Burndown' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Burndown chart/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completed per member' })).toBeVisible();
});
