import mongoose, { type ClientSession } from 'mongoose';

/**
 * Runs fn inside a transaction. The driver retries fn on transient errors
 * (write conflicts), so fn must be safe to run more than once:
 * no socket emits, no emails, no HTTP calls inside it.
 *
 * Rules (database.md §6.2):
 * 1. Pass `{ session }` to EVERY operation inside fn, or it won't roll back.
 * 2. Collect domain events and publish them after this resolves.
 * 3. Keep it short; never await network calls inside.
 * 4. E11000 inside aborts the transaction; map it after the promise rejects.
 * 5. Unique constraints are checked per statement, so statement order matters.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      },
    );
    return result;
  } finally {
    await session.endSession();
  }
}
