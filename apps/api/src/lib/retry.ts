import { AppError } from './errors';

/** A compare-and-set write matched nothing because the data changed under us. */
export const retryable = () => new AppError(409, 'RETRY', 'The item changed. Please try again.');

/**
 * Re-runs fn (which must re-read its data) when it throws a RETRY conflict.
 * After `attempts` tries the 409 RETRY reaches the client, which refetches.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof AppError && err.code === 'RETRY') || i >= attempts) throw err;
    }
  }
}
