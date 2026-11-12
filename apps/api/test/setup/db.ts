import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { syncAllIndexes } from '../../src/db/indexes';

// Each test file gets its own in-memory single-node replica set (transactions need one).
let replSet: MongoMemoryReplSet | undefined;

export async function startTestDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri('teamboard_test'));
  await syncAllIndexes(); // unique & partial indexes must exist: tests rely on them
}

/** Raw-driver deleteMany is allowed here only (test harness). */
export async function clearTestDb() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export async function stopTestDb() {
  await mongoose.disconnect();
  await replSet?.stop();
}
