import { describe, expect, it } from 'vitest';
import { daysBetween, dueState, todayIn } from '@teamboard/shared';

describe('todayIn / daysBetween', () => {
  // 23:30 UTC on 12 Nov is already 13 Nov in Dhaka (UTC+6) and still 12 Nov in New York.
  const now = new Date('2026-11-12T23:30:00Z');
  it("uses the workspace's timezone, not the viewer's", () => {
    expect(todayIn('UTC', now)).toBe('2026-11-12');
    expect(todayIn('Asia/Dhaka', now)).toBe('2026-11-13');
    expect(todayIn('America/New_York', now)).toBe('2026-11-12');
  });
  it('counts whole days, across month ends', () => {
    expect(daysBetween('2026-11-30', '2026-12-02')).toBe(2);
    expect(daysBetween('2026-12-02', '2026-11-30')).toBe(-2);
  });
});

describe('dueState (FR-TSK-08, FR-BRD-08)', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  it.each([
    ['2026-11-11', false, 'overdue'],
    ['2026-11-12', false, 'soon'], // due today is not overdue yet
    ['2026-11-14', false, 'soon'], // within 2 days → amber
    ['2026-11-15', false, 'later'],
    ['2026-11-01', true, 'none'], // a completed task is never overdue
    [null, false, 'none'],
  ] as const)('%s (completed: %s) → %s', (due, completed, expected) => {
    expect(dueState(due, completed, 'UTC', now)).toBe(expected);
  });

  it('the same task can be overdue in one timezone and not in another', () => {
    const late = new Date('2026-11-12T23:30:00Z');
    expect(dueState('2026-11-12', false, 'Asia/Dhaka', late)).toBe('overdue');
    expect(dueState('2026-11-12', false, 'America/New_York', late)).toBe('soon');
  });
});
