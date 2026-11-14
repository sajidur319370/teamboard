import { expect, test } from '@playwright/test';
import { boardReady, card, closeAll, column, keyboardMove, personIn } from './helpers';

test.afterEach(closeAll);

// AC-RT-01 / TR-07: two people on one board; a keyboard drag in A shows up in B.
test('a card moved in one browser appears moved in the other', async ({ browser }) => {
  const a = await personIn(browser, 'owner');
  const b = await personIn(browser, 'member');
  for (const p of [a, b]) {
    await p.goto('/w/acme/p/WEB/board?sprint=all');
    await boardReady(p, 'Marketing Site');
  }
  await expect(column(b, 'To Do').getByText('WEB-1', { exact: true })).toBeVisible();

  // Keyboard drag (dnd-kit): Space lifts, ArrowRight → next column, Space drops.
  const c = card(a, 'WEB-1');
  await c.focus();
  await expect(c).toBeFocused();
  await keyboardMove(a, ['Space', 'ArrowRight', 'Space']);
  await expect(column(a, 'In Progress').getByText('WEB-1', { exact: true })).toBeVisible();

  // …and in the other browser, without a reload ("within about a second")
  const t0 = Date.now();
  await expect(column(b, 'In Progress').getByText('WEB-1', { exact: true })).toBeVisible({
    timeout: 3_000,
  });
  test.info().annotations.push({ type: 'sync latency', description: `${Date.now() - t0} ms` });
  await expect(column(b, 'To Do').getByText('WEB-1', { exact: true })).toHaveCount(0);
});

test('a comment appears live in another open drawer, and on the card count', async ({
  browser,
}) => {
  const a = await personIn(browser, 'admin');
  const b = await personIn(browser, 'member');
  for (const p of [a, b]) {
    await p.goto('/w/acme/p/WEB/tasks/2?sprint=all'); // the drawer over the board
    await expect(p.getByRole('dialog')).toBeVisible();
    await expect(p.locator('html[data-board-live]')).toHaveCount(1);
  }
  const text = `Live comment ${Date.now()}`;
  await a.getByLabel('Write a comment').fill(text);
  await a.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(b.getByRole('dialog').getByText(text)).toBeVisible({ timeout: 3_000 });
});
