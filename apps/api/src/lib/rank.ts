import { generateKeyBetween } from 'fractional-indexing';
import { isDuplicateKey } from './ids';

// Card order uses fractional-indexing keys (data-model.md §11). A column's ranks are UNIQUE
// (index uniq_column_rank), so there is always room to drop a card between two neighbours.

/** The unique index that keeps two cards in one column from sharing a rank. */
export const RANK_INDEX = 'uniq_column_rank';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'; // same digits, same order

function toBase62(n: number): string {
  let s = '';
  do {
    s = BASE62[n % 62] + s;
    n = Math.floor(n / 62);
  } while (n > 0);
  return s;
}

/**
 * A key strictly after `last` that is UNIQUE even when many requests compute it from the
 * same `last` at the same time (50 parallel creates all read the same bottom card).
 *
 * generateKeyBetween(last, null) always returns an integer-only key (e.g. "a4"), so we
 * append a fraction made from a number that is unique per caller (the task number from the
 * atomic counter). The trailing "V" keeps the fraction from ending in "0", which
 * fractional-indexing forbids. The next append drops the fraction again, so keys stay short.
 */
export function uniqueKeyAfter(last: string | null, uniqueNumber: number): string {
  const key = `${generateKeyBetween(last, null)}${toBase62(uniqueNumber)}V`;
  generateKeyBetween(key, null); // throws if the key were invalid (it never is; belt and braces)
  return key;
}

/**
 * Runs fn again (it must re-read its neighbours) when its write hit uniq_column_rank,
 * i.e. a concurrent write took the exact same key. The retry sees that card and picks a
 * key next to it, so both cards end up where their users dropped them (AC-ORD-02).
 */
export async function retryOnRankCollision<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isDuplicateKey(err, RANK_INDEX) || i >= attempts) throw err;
    }
  }
}
