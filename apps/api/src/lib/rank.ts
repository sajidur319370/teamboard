import { generateKeyBetween } from 'fractional-indexing';

// Card order uses fractional-indexing keys (data-model.md §11). Day 12 adds move/rebalance here.

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
