import { expect, test } from '@playwright/test';
import { login } from './helpers';

// J4: the running sprint is completed (carry-over choice) → frozen report; the next starts.
test('complete the running sprint, see the frozen report, start the next one', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/w/acme/p/MOB/backlog');
  await expect(page.getByRole('heading', { name: /Mobile App v2: backlog/ })).toBeVisible();

  await page.getByRole('button', { name: 'Complete sprint' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/tasks completed/)).toBeVisible();
  await dialog.getByLabel('Sprint 4').check(); // unfinished work goes to the planned sprint
  await dialog.getByRole('button', { name: 'Complete sprint' }).click();

  await page.waitForURL(/\/reports\//);
  await expect(page.getByText(/Frozen on/)).toBeVisible();
  await expect(page.getByRole('img', { name: /Burndown chart/ })).toBeVisible();

  await page.goto('/w/acme/p/MOB/backlog');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByText('Sprint 4 started')).toBeVisible();
  await page.goto('/w/acme/p/MOB/board');
  await expect(page.getByRole('combobox', { name: 'Board view' })).toContainText('Sprint 4');
});
