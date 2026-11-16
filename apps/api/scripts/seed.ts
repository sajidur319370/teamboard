/**
 * Builds the public demo (see src/demo/seedDemo.ts for what it contains).
 *
 *   npm run seed -w @teamboard/api                 # local (apps/api/.env)
 *   npm run seed -w @teamboard/api -- --reset      # delete the demo data first
 *   npm run seed -w @teamboard/api -- --perf       # + project PRF with 500 tasks (NFR-PERF)
 *   npm run seed:atlas -w @teamboard/api -- --reset   # production: see the guard below
 *
 * --reset deletes ONLY the demo: the demo users and the workspaces they own. It never
 * drops the database, so it is safe on a database that real people use.
 * In DEMO_MODE the server also does this by itself once a day (src/demo/autoReset.ts).
 */
import { isProd } from '../src/config/env';
import { connectDb, disconnectDb } from '../src/db/connection';
import { syncAllIndexes } from '../src/db/indexes';
import { startNotifier } from '../src/notifications/fromEvents';
import { resetDemo, seedDemo } from '../src/demo/seedDemo';

const args = new Set(process.argv.slice(2));
const password = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!';

if (isProd && process.env.SEED_ALLOW_PROD !== 'yes') {
  console.error('Refusing to seed a production database without SEED_ALLOW_PROD=yes.');
  process.exit(1);
}

const log = (m: string) => console.log(`  ${m}`);
await connectDb();
try {
  await syncAllIndexes();
  startNotifier(); // createApp() does this for the server; the seed needs it too
  if (args.has('--reset')) await resetDemo(log);
  const counts = await seedDemo({ password, perf: args.has('--perf'), log });
  console.log('✅ Seeded /w/acme:', counts);
  console.log(
    `   Log in as owner@ / admin@ / member@ / viewer@demo.teamboard.dev with "${password}"`,
  );
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
