import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { describe, expect, it } from 'vitest';
import { uniqueKeyAfter } from '../src/lib/rank';

describe('uniqueKeyAfter', () => {
  it('50 callers that read the same "last" all get distinct keys above it', () => {
    for (const last of [null, 'a0', 'a4', 'Zz', 'a3XV']) {
      const keys = Array.from({ length: 50 }, (_, i) => uniqueKeyAfter(last, i + 1));
      expect(new Set(keys).size).toBe(50);
      if (last) for (const k of keys) expect(k > last).toBe(true);
    }
  });

  it('produces valid fractional-indexing keys: you can insert between and after them', () => {
    const keys = Array.from({ length: 20 }, (_, i) => uniqueKeyAfter('a7', i + 1)).sort();
    for (let i = 0; i < keys.length - 1; i++) {
      const mid = generateKeyBetween(keys[i]!, keys[i + 1]!);
      expect(mid > keys[i]! && mid < keys[i + 1]!).toBe(true);
    }
    expect(generateNKeysBetween(keys.at(-1)!, null, 3)).toHaveLength(3); // column delete appends
  });

  it('stays short when appending one after another (the suffix is dropped each time)', () => {
    let last: string | null = null;
    for (let n = 1; n <= 500; n++) last = uniqueKeyAfter(last, n * 7919);
    expect(last!.length).toBeLessThan(10);
  });

  it('numbers ending in base-62 "0" still give valid keys (fractions may not end in 0)', () => {
    for (const n of [62, 124, 3844])
      expect(() => generateKeyBetween(uniqueKeyAfter('a1', n), null)).not.toThrow();
  });
});
