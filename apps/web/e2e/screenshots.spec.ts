import path from 'node:path';
import { expect, test } from '@playwright/test';
import { boardReady, login } from './helpers';

// README screenshots from the seeded demo: SCREENSHOTS=1 npx playwright test screenshots
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to refresh docs/*.png');
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const out = (name: string) => path.resolve(import.meta.dirname, '../../../docs', name);

test('README screenshots', async ({ page }) => {
  await login(page, 'admin');

  await page.goto('/w/acme/p/MOB/board');
  await boardReady(page, 'Mobile App v2');
  await page.screenshot({ path: out('board.png') });

  await page.goto('/w/acme/p/MOB/tasks/1');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByText(/created MOB-1|moved MOB-1/)
      .first(),
  ).toBeVisible();
  await page.screenshot({ path: out('drawer.png') });

  await page.goto('/w/acme/p/MOB/reports');
  await expect(page.getByRole('img', { name: /Burndown chart/ })).toBeVisible();
  await page.waitForTimeout(500); // let the chart settle
  await page.screenshot({ path: out('reports.png'), fullPage: true });

  await page.goto('/w/acme/p/MOB/backlog');
  await expect(page.getByRole('heading', { name: /backlog/ })).toBeVisible();
  await page.screenshot({ path: out('backlog.png') });
});
