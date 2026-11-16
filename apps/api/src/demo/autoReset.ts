import { env } from '../config/env';
import { logger } from '../lib/logger';
import { demoBuiltAt, resetDemo, seedDemo } from './seedDemo';

const HOUR = 3_600_000;
let running: Promise<boolean> | null = null;

/** Is the demo missing, or older than DEMO_RESET_HOURS? */
export async function demoIsStale(now = new Date(), hours = env.DEMO_RESET_HOURS) {
  const built = await demoBuiltAt();
  return !built || now.getTime() - built.getTime() >= hours * HOUR;
}

/**
 * Rebuilds the demo (delete the demo data, seed it again) when it is stale. Visitors who
 * are logged in as a demo user are signed out by the reset and simply log in again.
 * Only one reset runs at a time; a call during a reset waits for it.
 */
export function resetDemoIfStale(now = new Date()): Promise<boolean> {
  running ??= (async () => {
    try {
      if (!(await demoIsStale(now))) return false;
      const log = (m: string) => logger.info(`demo: ${m}`);
      const t0 = Date.now();
      await resetDemo(log);
      const counts = await seedDemo({ password: env.SEED_DEMO_PASSWORD, log });
      logger.info({ counts, ms: Date.now() - t0 }, 'demo: rebuilt');
      return true;
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * A demo login that arrives during a reset waits for it (instead of a 503): on a free host
 * the first visit of the day wakes the server AND finds the demo a day old.
 */
export async function demoResetDone() {
  if (running) await running.catch(() => undefined);
}

/**
 * DEMO_MODE: check at startup (a free host sleeps, so the server often starts fresh) and
 * then every hour. DEMO_RESET_HOURS=0 turns it off.
 */
export function startDemoAutoReset() {
  if (!env.DEMO_MODE || env.DEMO_RESET_HOURS === 0) return;
  const check = () =>
    void resetDemoIfStale().catch((err: unknown) => logger.error({ err }, 'demo: reset failed'));
  check();
  setInterval(check, HOUR).unref();
}
