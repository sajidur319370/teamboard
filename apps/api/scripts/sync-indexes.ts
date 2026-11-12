// Production builds don't auto-create indexes (autoIndex is off), so unique indexes must be
// created by this script BEFORE real traffic, or duplicate emails/slugs become possible.
//
//   npm run db:diff-indexes -w @teamboard/api    # look first: what would change?
//   npm run db:sync-indexes -w @teamboard/api    # apply
//
// Reads apps/api/.env.atlas (git-ignored). Re-run after adding a model or index.
import { connectDb, disconnectDb } from '../src/db/connection';
import { diffAllIndexes, syncAllIndexes } from '../src/db/indexes';

const apply = process.argv.includes('--apply');
const target = process.env.MONGODB_URI?.replace(/\/\/[^@]*@/, '//***@') ?? '(unset)'; // hide the password
console.log(`Target: ${target}`);

await connectDb();
// ALWAYS look at the diff first: syncIndexes DROPS indexes the models don't declare.
await diffAllIndexes();
if (apply) {
  await syncAllIndexes();
  console.log('✅ Indexes synced');
} else {
  console.log('Dry run. Re-run with --apply (npm run db:sync-indexes) to create them.');
}
await disconnectDb();
