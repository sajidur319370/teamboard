import { describe, expect, it } from 'vitest';
import { relativeTime } from './format';

describe('relativeTime', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  it.each([
    ['2026-11-19T12:00:00Z', 'next week'],
    ['2026-11-18T12:00:00Z', 'in 6 days'],
    ['2026-11-12T14:00:00Z', 'in 2 hours'],
    ['2026-11-11T12:00:00Z', 'yesterday'],
    ['2026-11-12T11:59:30Z', 'now'],
  ])('%s → %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });
});
