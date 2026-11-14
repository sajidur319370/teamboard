import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';
export type Who = 'owner' | 'admin' | 'member' | 'viewer';

export async function login(page: Page, who: Who) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@demo.teamboard.dev`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/w\/acme\//);
}

/**
 * A separate browser context = a separate person (own cookies, own socket).
 * Close them at the end of the test (`closeAll`), or they leak into the next tests.
 */
const opened: BrowserContext[] = [];
export async function personIn(browser: Browser, who: Who) {
  const context = await browser.newContext();
  opened.push(context);
  const page = await context.newPage();
  await login(page, who);
  return page;
}
export async function closeAll() {
  await Promise.all(opened.splice(0).map((c) => c.close()));
}

/** dnd-kit measures layout between key presses: give each step a moment. */
export async function keyboardMove(page: Page, keys: string[]) {
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
}

/** The draggable card: the sortable wrapper is labelled "WEB-1: <title>". */
export const card = (page: Page, key: string) =>
  page.getByRole('button', { name: new RegExp(`^${key}:`) });

export const column = (page: Page, name: string) => page.getByTestId(`column-${name}`);

/** Wait until the board is live (the socket joined), so we don't race the first event. */
export async function boardReady(page: Page, projectName: string) {
  await expect(page.getByRole('region', { name: `${projectName} board` })).toBeVisible();
  await expect(page.locator('html[data-board-live]')).toHaveCount(1); // socket joined the board
}
